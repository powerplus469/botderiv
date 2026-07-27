require('dotenv').config();
const WebSocket = require('ws');
const DerivAPI = require('@deriv/deriv-api/dist/DerivAPI');

// Import Firebase
const {
    initFirebase,
    saveTrade,
    saveSignal,
    savePosition,
    updatePosition,
    saveIndicators,
    saveMetrics,
    saveDailySummary,
    getTradeStats,
    isFirebaseReady
} = require('./firebase');

// ============ INIT FIREBASE ============
initFirebase();

// ============ CONFIGURATION ============
const CONFIG = {
    appId: process.env.DERIV_APP_ID || '1089',
    token: process.env.DERIV_TOKEN,
    symbol: process.env.SYMBOL || 'R_100',
    maPeriods: {
        short: 15,
        medium: 100,
        long: 200
    },
    atrPeriod: 14,
    atrMultiplier: 1.5,
    tradeSize: parseFloat(process.env.TRADE_SIZE) || 1,
    maxOpenTrades: 1,
    logInterval: parseInt(process.env.LOG_INTERVAL) || 300000
};

// ============ ÉTAT DU BOT ============
const state = {
    candles: [],
    currentPosition: null,
    isRunning: true,
    lastSignal: null,
    isProcessing: false,
    dailyStats: {
        trades: 0,
        wins: 0,
        losses: 0,
        profit: 0,
        startOfDay: new Date().toISOString().split('T')[0]
    }
};

// ============ CONNEXION DERIV ============
let api;
let connection;

function connectDeriv() {
    console.log(`🔄 Connexion à Deriv (App ID: ${CONFIG.appId})...`);
    
    connection = new WebSocket(
        `wss://ws.derivws.com/websockets/v3?app_id=${CONFIG.appId}`
    );

    api = new DerivAPI({ connection });
    const basic = api.basic;

    connection.onopen = async () => {
        console.log('✅ WebSocket connecté');
        try {
            await basic.authorize(CONFIG.token);
            console.log('✅ Authentifié avec succès');
            
            startCandleStream();
            await checkExistingPositions();
            
            setInterval(saveMetricsToFirebase, CONFIG.logInterval);
            scheduleDailySummary();
            
            setInterval(runStrategy, 10000);
            console.log('🚀 Bot démarré, en attente de signaux...');
            
        } catch (err) {
            console.error('❌ Erreur d\'authentification:', err.message);
            setTimeout(connectDeriv, 5000);
        }
    };

    connection.onclose = () => {
        console.log('🔌 WebSocket fermé, reconnexion dans 5s...');
        setTimeout(connectDeriv, 5000);
    };

    connection.onerror = (err) => {
        console.error('⚠️ Erreur WebSocket:', err.message);
    };
}

// ============ STREAMING DES BOUGIES ============
function startCandleStream() {
    api.subscribe({
        ticks: CONFIG.symbol,
        subscribe: 1
    });

    api.events.on('data', async (data) => {
        if (data.msg_type === 'tick') {
            await fetchCandles();
        }
    });

    setTimeout(fetchCandles, 2000);
}

// ============ RÉCUPÉRATION DE L'HISTORIQUE ============
async function fetchCandles() {
    try {
        const response = await api.send({
            ticks_history: CONFIG.symbol,
            start: Math.floor(Date.now() / 1000) - 7200,
            end: 'latest',
            adjust_start_time: 1,
            count: 500,
            style: 'candles',
            granularity: 60
        });

        if (response.candles) {
            state.candles = response.candles.map(c => ({
                open: parseFloat(c.open),
                high: parseFloat(c.high),
                low: parseFloat(c.low),
                close: parseFloat(c.close),
                epoch: c.epoch
            }));
        }
    } catch (err) {
        console.error('❌ Erreur chargement bougies:', err.message);
    }
}

// ============ CALCUL DES INDICATEURS ============
function calculateMA(period) {
    const closes = state.candles.map(c => c.close);
    if (closes.length < period) return null;
    const recent = closes.slice(-period);
    const sum = recent.reduce((a, b) => a + b, 0);
    return sum / period;
}

function calculateATR(period) {
    if (state.candles.length < period + 1) return null;
    const trueRanges = [];
    const prices = state.candles.slice(-period - 1);
    
    for (let i = 1; i < prices.length; i++) {
        const high = prices[i].high;
        const low = prices[i].low;
        const prevClose = prices[i - 1].close;
        const tr = Math.max(
            high - low,
            Math.abs(high - prevClose),
            Math.abs(low - prevClose)
        );
        trueRanges.push(tr);
    }
    
    const sum = trueRanges.reduce((a, b) => a + b, 0);
    return sum / trueRanges.length;
}

function getLastCandles(count = 2) {
    if (state.candles.length < count) return null;
    return state.candles.slice(-count);
}

// ============ LOGIQUE DE LA STRATÉGIE ============
async function runStrategy() {
    if (state.isProcessing) return;
    state.isProcessing = true;

    try {
        if (state.candles.length < CONFIG.maPeriods.long + 2) {
            state.isProcessing = false;
            return;
        }

        const ma15 = calculateMA(CONFIG.maPeriods.short);
        const ma100 = calculateMA(CONFIG.maPeriods.medium);
        const ma200 = calculateMA(CONFIG.maPeriods.long);
        const atr = calculateATR(CONFIG.atrPeriod);
        
        if (ma15 === null || ma100 === null || ma200 === null || atr === null) {
            state.isProcessing = false;
            return;
        }

        const lastCandles = getLastCandles(2);
        if (!lastCandles) {
            state.isProcessing = false;
            return;
        }

        const prevClose = lastCandles[0].close;
        const currentClose = lastCandles[1].close;
        const threshold = atr * CONFIG.atrMultiplier;
        const distanceFromMA200 = Math.abs(currentClose - ma200);

        const isBullishTrend = ma100 < ma200;
        const isBearishTrend = ma100 > ma200;

        // ===== ENREGISTRER LES INDICATEURS =====
        await saveIndicators({
            symbol: CONFIG.symbol,
            ma15: ma15,
            ma100: ma100,
            ma200: ma200,
            atr: atr,
            price: currentClose,
            distanceFromMA200: distanceFromMA200,
            threshold: threshold,
            trend: isBullishTrend ? 'bullish' : (isBearishTrend ? 'bearish' : 'neutral')
        });

        // ===== SIGNAL BUY =====
        const buyCross = prevClose < ma200 && currentClose > ma200;
        const isValidBuy = isBullishTrend && buyCross && distanceFromMA200 >= threshold;

        // ===== SIGNAL SELL =====
        const sellCross = prevClose > ma200 && currentClose < ma200;
        const isValidSell = isBearishTrend && sellCross && distanceFromMA200 >= threshold;

        // ===== ENREGISTRER LE SIGNAL =====
        if (isValidBuy || isValidSell) {
            await saveSignal({
                symbol: CONFIG.symbol,
                type: isValidBuy ? 'BUY' : 'SELL',
                price: currentClose,
                ma200: ma200,
                atr: atr,
                distanceFromMA200: distanceFromMA200,
                threshold: threshold,
                status: 'signal_detected'
            });
        }

        // ===== EXÉCUTION =====
        if (isValidBuy && state.lastSignal !== 'BUY' && !state.currentPosition) {
            console.log(`📈 SIGNAL BUY | Prix: ${currentClose.toFixed(2)}`);
            await executeTrade('BUY', currentClose);
            state.lastSignal = 'BUY';
        } 
        else if (isValidSell && state.lastSignal !== 'SELL' && !state.currentPosition) {
            console.log(`📉 SIGNAL SELL | Prix: ${currentClose.toFixed(2)}`);
            await executeTrade('SELL', currentClose);
            state.lastSignal = 'SELL';
        }

        // ===== GESTION DES SORTIES =====
        if (state.currentPosition) {
            await checkExitConditions(currentClose, ma200);
        }

    } catch (err) {
        console.error('❌ Erreur runStrategy:', err.message);
    }

    state.isProcessing = false;
}

// ============ EXÉCUTION DES ORDRES ============
async function executeTrade(type, price) {
    try {
        const contractType = type === 'BUY' ? 'CALL' : 'PUT';
        
        const proposal = await api.send({
            proposal: 1,
            amount: CONFIG.tradeSize,
            basis: 'stake',
            contract_type: contractType,
            currency: 'USD',
            duration: 60,
            duration_unit: 's',
            symbol: CONFIG.symbol
        });

        if (!proposal.proposal) {
            console.error('❌ Proposition invalide');
            return;
        }

        const contractId = proposal.proposal.id;
        
        const buyResponse = await api.send({
            buy: contractId,
            price: CONFIG.tradeSize
        });

        if (buyResponse.error) {
            console.error('❌ Erreur achat:', buyResponse.error.message);
            return;
        }

        // ===== ENREGISTRER DANS FIREBASE =====
        const positionId = await savePosition({
            symbol: CONFIG.symbol,
            type: type,
            entryPrice: price,
            contractId: buyResponse.buy.contract_id,
            tradeSize: CONFIG.tradeSize,
            contractType: contractType,
            ma200: calculateMA(CONFIG.maPeriods.long)
        });

        state.currentPosition = {
            id: positionId,
            type: type,
            entryPrice: price,
            contractId: buyResponse.buy.contract_id,
            timestamp: Date.now()
        };

        console.log(`✅ ${type} exécuté | ID: ${buyResponse.buy.contract_id}`);

    } catch (err) {
        console.error('❌ Erreur exécution trade:', err.message);
    }
}

// ============ SORTIES ============
async function checkExitConditions(currentPrice, ma200) {
    if (!state.currentPosition) return;

    let shouldExit = false;
    const pos = state.currentPosition;

    if (pos.type === 'BUY' && currentPrice < ma200) {
        shouldExit = true;
    } else if (pos.type === 'SELL' && currentPrice > ma200) {
        shouldExit = true;
    }

    if (shouldExit) {
        console.log(`🚪 Fermeture ${pos.type} | Prix: ${currentPrice.toFixed(2)}`);
        await closeTrade(pos.contractId, pos.id, pos.entryPrice, currentPrice);
        state.currentPosition = null;
    }
}

async function closeTrade(contractId, positionId, entryPrice, exitPrice) {
    try {
        const sellResponse = await api.send({
            sell: contractId,
            price: 0
        });

        if (sellResponse.error) {
            console.error('❌ Erreur fermeture:', sellResponse.error.message);
            return;
        }

        const profit = sellResponse.sell?.profit_amount || 0;

        // ===== ENREGISTRER LE TRADE =====
        await saveTrade({
            symbol: CONFIG.symbol,
            type: state.currentPosition.type,
            entryPrice: entryPrice,
            exitPrice: exitPrice,
            profit: profit,
            contractId: contractId,
            positionId: positionId,
            tradeSize: CONFIG.tradeSize,
            result: profit > 0 ? 'win' : 'loss'
        });

        // ===== METTRE À JOUR LA POSITION =====
        await updatePosition(positionId, {
            status: 'closed',
            exitPrice: exitPrice,
            profit: profit,
            closedAt: new Date().toISOString()
        });

        // ===== STATS JOURNALIÈRES =====
        state.dailyStats.trades++;
        if (profit > 0) state.dailyStats.wins++;
        else state.dailyStats.losses++;
        state.dailyStats.profit += profit;

        console.log(`✅ Position fermée | Profit: ${profit.toFixed(2)} USD`);

    } catch (err) {
        console.error('❌ Erreur closeTrade:', err.message);
    }
}

// ============ VÉRIFICATION DES POSITIONS EXISTANTES ============
async function checkExistingPositions() {
    try {
        const portfolio = await api.send({ portfolio: 1 });
        if (portfolio.portfolio && portfolio.portfolio.contracts.length > 0) {
            const active = portfolio.portfolio.contracts.find(c => c.status === 'open');
            if (active) {
                state.currentPosition = {
                    type: active.contract_type.includes('CALL') ? 'BUY' : 'SELL',
                    entryPrice: active.buy_price,
                    contractId: active.contract_id,
                    timestamp: Date.now()
                };
                console.log(`🔄 Position existante: ${state.currentPosition.type}`);
            }
        }
    } catch (err) {
        console.error('❌ Erreur vérification positions:', err.message);
    }
}

// ============ SAUVEGARDE DES MÉTRIQUES ============
async function saveMetricsToFirebase() {
    try {
        const stats = await getTradeStats();
        if (stats) {
            await saveMetrics({
                symbol: CONFIG.symbol,
                ...stats,
                currentPrice: state.candles.length > 0 ? state.candles[state.candles.length - 1].close : null,
                activePosition: state.currentPosition ? 'yes' : 'no'
            });
        }
    } catch (err) {
        console.error('❌ Erreur saveMetrics:', err.message);
    }
}

// ============ PLANIFICATION DU RÉSUMÉ JOURNALIER ============
function scheduleDailySummary() {
    setInterval(async () => {
        const now = new Date();
        if (now.getHours() === 0 && now.getMinutes() === 0) {
            await saveDailySummary({
                symbol: CONFIG.symbol,
                trades: state.dailyStats.trades,
                wins: state.dailyStats.wins,
                losses: state.dailyStats.losses,
                profit: state.dailyStats.profit,
                winRate: state.dailyStats.trades > 0 
                    ? (state.dailyStats.wins / state.dailyStats.trades) * 100 
                    : 0
            });
            
            state.dailyStats = {
                trades: 0,
                wins: 0,
                losses: 0,
                profit: 0,
                startOfDay: new Date().toISOString().split('T')[0]
            };
        }
    }, 60000);
}

// ============ GESTION DES ERREURS ============
process.on('SIGINT', () => {
    console.log('🛑 Arrêt demandé');
    state.isRunning = false;
    if (connection) connection.close();
    process.exit(0);
});

process.on('uncaughtException', (err) => {
    console.error('💥 Exception non capturée:', err.message);
    setTimeout(connectDeriv, 5000);
});

// ============ DÉMARRAGE ============
console.log('🤖 Deriv MA Bot v2.0 - Firebase');
console.log(`📊 Symbole: ${CONFIG.symbol}`);
connectDeriv();