require('dotenv').config();
const WebSocket = require('ws');
const DerivAPI = require('@deriv/deriv-api/dist/DerivAPI');

// ============ GESTION DES ERREURS ============
process.on('uncaughtException', (err) => {
    console.error('💥 Erreur:', err.message);
});

process.on('unhandledRejection', (reason) => {
    console.error('💥 Rejet:', reason);
});

// ============ KEEP-ALIVE ============
process.stdin.resume();

// ============ FIREBASE ============
const { initFirebase } = require('./firebase');
initFirebase();

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
let isConnecting = false;

function connectDeriv() {
    if (isConnecting) return;
    isConnecting = true;
    
    console.log(`🔄 Connexion à Deriv...`);
    
    try {
        connection = new WebSocket(
            `wss://ws.derivws.com/websockets/v3?app_id=${CONFIG.appId}`
        );

        api = new DerivAPI({ connection });
        const basic = api.basic;

        connection.onopen = async () => {
            console.log('✅ WebSocket connecté');
            
            try {
                console.log('🔑 Auth...');
                
                // ⚠️ TIMEOUT RAPIDE (3 secondes)
                const timeout = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Timeout')), 3000)
                );
                
                const auth = await Promise.race([
                    basic.authorize(CONFIG.token),
                    timeout
                ]);
                
                console.log(`✅ Auth OK | ${auth.authorize.loginid}`);
                console.log(`💰 ${auth.authorize.balance} USD`);
                console.log('🚀 Bot prêt !');
                
                isConnecting = false;
                
                // Démarrer en arrière-plan
                setTimeout(() => {
                    startCandleStream();
                    setInterval(runStrategy, 10000);
                }, 1000);
                
                // Log de statut toutes les 30s
                setInterval(() => {
                    console.log(`⏳ Actif | ${new Date().toISOString()}`);
                }, 30000);
                
            } catch (err) {
                isConnecting = false;
                console.error('❌ Auth error:', err.message);
                setTimeout(connectDeriv, 5000);
            }
        };

        connection.onclose = () => {
            isConnecting = false;
            console.log('🔌 Fermé, reconnexion...');
            setTimeout(connectDeriv, 5000);
        };

        connection.onerror = (err) => {
            isConnecting = false;
            console.error('⚠️ Erreur:', err.message);
        };
        
    } catch (err) {
        isConnecting = false;
        console.error('❌ Erreur:', err.message);
        setTimeout(connectDeriv, 5000);
    }
}

// ============ STREAMING ============
async function startCandleStream() {
    try {
        console.log('📊 Streaming...');
        api.subscribe({ ticks: CONFIG.symbol, subscribe: 1 });
        
        api.events.on('data', async (data) => {
            if (data.msg_type === 'tick') {
                await fetchCandles();
            }
        });
        
        setTimeout(fetchCandles, 2000);
    } catch (err) {
        console.error('❌ Streaming error:', err.message);
    }
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
            console.log(`📊 ${state.candles.length} bougies`);
        }
    } catch (err) {
        console.error('❌ Erreur bougies:', err.message);
    }
}

// ============ CALCULS ============
function calculateMA(period) {
    const closes = state.candles.map(c => c.close);
    if (closes.length < period) return null;
    const sum = closes.slice(-period).reduce((a, b) => a + b, 0);
    return sum / period;
}

function calculateATR(period) {
    if (state.candles.length < period + 1) return null;
    const prices = state.candles.slice(-period - 1);
    const tr = [];
    for (let i = 1; i < prices.length; i++) {
        tr.push(Math.max(
            prices[i].high - prices[i].low,
            Math.abs(prices[i].high - prices[i - 1].close),
            Math.abs(prices[i].low - prices[i - 1].close)
        ));
    }
    return tr.reduce((a, b) => a + b, 0) / tr.length;
}

function getLastCandles(count = 2) {
    if (state.candles.length < count) return null;
    return state.candles.slice(-count);
}

// ============ STRATÉGIE ============
async function runStrategy() {
    if (state.isProcessing || state.candles.length < 202) return;
    state.isProcessing = true;

    try {
        const ma15 = calculateMA(15);
        const ma100 = calculateMA(100);
        const ma200 = calculateMA(200);
        const atr = calculateATR(14);
        
        if (!ma15 || !ma100 || !ma200 || !atr) {
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
        const threshold = atr * 1.5;
        const distance = Math.abs(currentClose - ma200);

        const buySignal = ma100 < ma200 && prevClose < ma200 && currentClose > ma200 && distance >= threshold;
        const sellSignal = ma100 > ma200 && prevClose > ma200 && currentClose < ma200 && distance >= threshold;

        if (buySignal && !state.currentPosition) {
            console.log(`📈 BUY | ${currentClose.toFixed(2)}`);
            state.lastSignal = 'BUY';
        } else if (sellSignal && !state.currentPosition) {
            console.log(`📉 SELL | ${currentClose.toFixed(2)}`);
            state.lastSignal = 'SELL';
        }

    } catch (err) {
        console.error('❌ Stratégie:', err.message);
    }

    state.isProcessing = false;
}

// ============ DÉMARRAGE ============
console.log('🤖 Deriv Bot v3.0');
console.log(`📊 ${CONFIG.symbol}`);
console.log(`🔑 ${CONFIG.token ? 'Token OK' : '❌ TOKEN MANQUANT'}`);

if (!CONFIG.token) {
    console.error('❌ DERIV_TOKEN manquant !');
    process.exit(1);
}

connectDeriv();
