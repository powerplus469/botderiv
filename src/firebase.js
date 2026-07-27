const admin = require('firebase-admin');

let db = null;
let initialized = false;

// ============ INITIALISATION ============
function initFirebase() {
    if (initialized) return true;
    
    try {
        // Récupère les credentials depuis la variable d'environnement
        const credentialsJson = process.env.FIREBASE_CREDENTIALS_JSON;
        
        if (!credentialsJson) {
            console.log("⚠️ Firebase non configuré (FIREBASE_CREDENTIALS_JSON manquant)");
            return false;
        }
        
        const serviceAccount = JSON.parse(credentialsJson);
        
        // Vérifie que les champs requis sont présents
        if (!serviceAccount.project_id || !serviceAccount.private_key) {
            console.log("❌ Firebase: Credentials invalides");
            return false;
        }
        
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        
        db = admin.firestore();
        initialized = true;
        console.log(`✅ Firebase connecté (Projet: ${serviceAccount.project_id})`);
        return true;
        
    } catch (err) {
        console.log("❌ Firebase erreur d'initialisation:", err.message);
        return false;
    }
}

// ============ VÉRIFICATION DE CONNEXION ============
function isFirebaseReady() {
    return initialized && db !== null;
}

// ============ TRADES ============
async function saveTrade(trade) {
    if (!isFirebaseReady()) return false;
    
    try {
        const docRef = await db.collection('trades').add({
            ...trade,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`💾 Trade sauvegardé (${trade.type}) | ID: ${docRef.id}`);
        return docRef.id;
    } catch (err) {
        console.log("❌ Erreur saveTrade:", err.message);
        return null;
    }
}

// ============ SIGNALS ============
async function saveSignal(signal) {
    if (!isFirebaseReady()) return false;
    
    try {
        const docRef = await db.collection('signals').add({
            ...signal,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`📊 Signal sauvegardé (${signal.type})`);
        return docRef.id;
    } catch (err) {
        console.log("❌ Erreur saveSignal:", err.message);
        return null;
    }
}

// ============ POSITIONS ============
async function savePosition(position) {
    if (!isFirebaseReady()) return false;
    
    try {
        const docRef = await db.collection('positions').add({
            ...position,
            status: 'open',
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`📌 Position ouverte | ID: ${docRef.id}`);
        return docRef.id;
    } catch (err) {
        console.log("❌ Erreur savePosition:", err.message);
        return null;
    }
}

async function updatePosition(positionId, updateData) {
    if (!isFirebaseReady() || !positionId) return false;
    
    try {
        await db.collection('positions').doc(positionId).update({
            ...updateData,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`🔄 Position mise à jour: ${positionId}`);
        return true;
    } catch (err) {
        console.log("❌ Erreur updatePosition:", err.message);
        return false;
    }
}

// ============ INDICATEURS ============
async function saveIndicators(indicators) {
    if (!isFirebaseReady()) return false;
    
    try {
        await db.collection('indicators').add({
            ...indicators,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
        return true;
    } catch (err) {
        console.log("❌ Erreur saveIndicators:", err.message);
        return false;
    }
}

// ============ MÉTRIQUES ============
async function saveMetrics(metrics) {
    if (!isFirebaseReady()) return false;
    
    try {
        await db.collection('metrics').add({
            ...metrics,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
        return true;
    } catch (err) {
        console.log("❌ Erreur saveMetrics:", err.message);
        return false;
    }
}

// ============ RÉSUMÉ JOURNALIER ============
async function saveDailySummary(summary) {
    if (!isFirebaseReady()) return false;
    
    try {
        const today = new Date().toISOString().split('T')[0];
        await db.collection('daily_summary').doc(today).set({
            ...summary,
            date: today,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        console.log(`📅 Résumé journalier enregistré: ${today}`);
        return true;
    } catch (err) {
        console.log("❌ Erreur saveDailySummary:", err.message);
        return false;
    }
}

// ============ STATISTIQUES ============
async function getTradeStats() {
    if (!isFirebaseReady()) return null;
    
    try {
        const snapshot = await db.collection('trades').get();
        const trades = snapshot.docs.map(doc => doc.data());
        
        const total = trades.length;
        const wins = trades.filter(t => t.profit > 0).length;
        const losses = trades.filter(t => t.profit < 0).length;
        const totalProfit = trades.reduce((sum, t) => sum + (t.profit || 0), 0);
        const winRate = total > 0 ? (wins / total) * 100 : 0;
        
        return { total, wins, losses, totalProfit, winRate };
    } catch (err) {
        console.log("❌ Erreur getTradeStats:", err.message);
        return null;
    }
}

// ============ RÉCUPÉRATION DES DERNIERS TRADES ============
async function getRecentTrades(limitCount = 10) {
    if (!isFirebaseReady()) return [];
    
    try {
        const snapshot = await db.collection('trades')
            .orderBy('timestamp', 'desc')
            .limit(limitCount)
            .get();
        
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (err) {
        console.log("❌ Erreur getRecentTrades:", err.message);
        return [];
    }
}

// ============ EXPORT ============
module.exports = {
    initFirebase,
    isFirebaseReady,
    saveTrade,
    saveSignal,
    savePosition,
    updatePosition,
    saveIndicators,
    saveMetrics,
    saveDailySummary,
    getTradeStats,
    getRecentTrades
};