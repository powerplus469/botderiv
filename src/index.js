require('dotenv').config();
const WebSocket = require('ws');
const DerivAPI = require('@deriv/deriv-api/dist/DerivAPI');

// ============ GESTION DES ERREURS GLOBALES ============
process.on('uncaughtException', (err) => {
    console.error('💥 Exception non catchée:', err.message);
    console.error('📚 Stack:', err.stack);
});

process.on('unhandledRejection', (reason) => {
    console.error('💥 Rejet non géré:', reason);
});

// ============ KEEP-ALIVE ============
process.stdin.resume();

// ============ FIREBASE ============
const { initFirebase } = require('./firebase');
const firebaseReady = initFirebase();

// ============ CONFIGURATION ============
const CONFIG = {
    appId: process.env.DERIV_APP_ID || '1089',
    token: process.env.DERIV_TOKEN,
    symbol: process.env.SYMBOL || 'R_100',
    maPeriods: { short: 15, medium: 100, long: 200 },
    atrPeriod: 14,
    atrMultiplier: 1.5,
    tradeSize: parseFloat(process.env.TRADE_SIZE) || 1,
};

// ============ ÉTAT ============
const state = {
    candles: [],
    currentPosition: null,
    isRunning: true,
    lastSignal: null,
    isProcessing: false,
};

// ============ CONNEXION DERIV ============
let api;
let connection;

function connectDeriv() {
    console.log(`🔄 Connexion à Deriv (App ID: ${CONFIG.appId})...`);
    console.log(`🔑 Token présent: ${CONFIG.token ? '✅ Oui' : '❌ Non'}`);
    
    if (!CONFIG.token) {
        console.error('❌ DERIV_TOKEN non défini dans les variables d\'environnement');
        console.log('🔄 Nouvelle tentative dans 10s...');
        setTimeout(connectDeriv, 10000);
        return;
    }
    
    connection = new WebSocket(
        `wss://ws.derivws.com/websockets/v3?app_id=${CONFIG.appId}`
    );

    api = new DerivAPI({ connection });
    const basic = api.basic;

    connection.onopen = async () => {
        console.log('✅ WebSocket connecté');
        
        // Timeout de 15 secondes pour l'auth
        const authTimeout = setTimeout(() => {
            console.error('⏰ Timeout authentification (15s)');
            connection.close();
        }, 15000);
        
        try {
            console.log('🔑 Authentification en cours...');
            console.log(`🔑 Token: ${CONFIG.token.substring(0, 8)}...`);
            
            const authResponse = await basic.authorize(CONFIG.token);
            clearTimeout(authTimeout);
            
            console.log('✅ Authentifié avec succès');
            console.log(`👤 Compte: ${authResponse.authorize.loginid}`);
            console.log(`🏷️ Type: ${authResponse.authorize.is_virtual ? 'DÉMO' : 'RÉEL'}`);
            console.log(`💰 Solde: ${authResponse.authorize.balance} USD`);
            
            // Démarrer le streaming
            startCandleStream();
            await checkExistingPositions();
            setInterval(runStrategy, 10000);
            
            // Log de statut toutes les minutes
            setInterval(() => {
                console.log(`⏳ Bot actif | ${new Date().toISOString()}`);
            }, 60000);
            
            console.log('🚀 Bot démarré, en attente de signaux...');
            
        } catch (err) {
            clearTimeout(authTimeout);
            console.error('❌ Erreur d\'authentification:', err.message);
            console.error('📚 Stack:', err.stack);
            console.log('🔄 Nouvelle tentative dans 5s...');
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

// ============ STREAMING ============
function startCandleStream() {
    console.log('📊 Démarrage du streaming...');
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

// ============ RÉCUPÉRATION DES BOUGIES ============
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
            console.log(`📊 ${state.candles.length} bougies chargées`);
        }
    } catch (err) {
        console.error('❌ Erreur chargement bougies:', err.message);
    }
}

// ============ CALCULS ============
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

// ============ STRATÉGIE ============
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

        // Signal BUY
        const buyCross = prevClose < ma200 && currentClose > ma200;
        const isValidBuy = isBullishTrend && buyCross && distanceFromMA200 >= threshold;

        // Signal SELL
        const sellCross = prevClose > ma200 && currentClose < ma200;
        const isValidSell = isBearishTrend && sellCross && distanceFromMA200 >= threshold;

        // Exécution
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

    } catch (err) {
        console.error('❌ Erreur stratégie:', err.message);
    }

    state.isProcessing = false;
}

// ============ EXÉCUTION DES ORDRES ============
async function executeTrade(type, price) {
    // ... À implémenter
    console.log(`📊 Trade ${type} à ${price}`);
}

async function checkExistingPositions() {
    // ... À implémenter
    console.log('🔍 Vérification positions existantes...');
}

// ============ DÉMARRAGE ============
console.log('🤖 Deriv MA Bot v2.0 - Firebase');
console.log(`📊 Symbole: ${CONFIG.symbol}`);
connectDeriv();
