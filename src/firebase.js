const { initializeApp } = require('firebase/app');
const { 
  getFirestore, 
  collection, 
  addDoc, 
  doc, 
  setDoc, 
  updateDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  Timestamp,
  serverTimestamp
} = require('firebase/firestore');

// ============ CONFIGURATION FIREBASE ============
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID
};

// Initialisation
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

console.log('🔥 Firebase initialisé');

// ============ COLLECTIONS ============
const COLLECTIONS = {
  TRADES: 'trades',
  SIGNALS: 'signals',
  METRICS: 'metrics',
  INDICATORS: 'indicators',
  POSITIONS: 'positions',
  DAILY_SUMMARY: 'daily_summary'
};

// ============ ENREGISTREMENT D'UN TRADE ============
async function saveTrade(tradeData) {
  try {
    const docRef = await addDoc(collection(db, COLLECTIONS.TRADES), {
      ...tradeData,
      timestamp: serverTimestamp(),
      date: new Date().toISOString()
    });
    console.log(`✅ Trade enregistré | ID: ${docRef.id}`);
    return docRef.id;
  } catch (error) {
    console.error('❌ Erreur saveTrade:', error.message);
    return null;
  }
}

// ============ ENREGISTREMENT D'UN SIGNAL ============
async function saveSignal(signalData) {
  try {
    const docRef = await addDoc(collection(db, COLLECTIONS.SIGNALS), {
      ...signalData,
      timestamp: serverTimestamp(),
      date: new Date().toISOString()
    });
    console.log(`📊 Signal enregistré | ID: ${docRef.id}`);
    return docRef.id;
  } catch (error) {
    console.error('❌ Erreur saveSignal:', error.message);
    return null;
  }
}

// ============ ENREGISTREMENT DES INDICATEURS ============
async function saveIndicators(indicatorData) {
  try {
    const docRef = await addDoc(collection(db, COLLECTIONS.INDICATORS), {
      ...indicatorData,
      timestamp: serverTimestamp(),
      date: new Date().toISOString()
    });
    return docRef.id;
  } catch (error) {
    console.error('❌ Erreur saveIndicators:', error.message);
    return null;
  }
}

// ============ MISE À JOUR D'UNE POSITION ============
async function updatePosition(positionId, updateData) {
  try {
    if (!positionId) return null;
    const docRef = doc(db, COLLECTIONS.POSITIONS, positionId);
    await updateDoc(docRef, {
      ...updateData,
      updatedAt: serverTimestamp()
    });
    console.log(`🔄 Position mise à jour: ${positionId}`);
    return true;
  } catch (error) {
    console.error('❌ Erreur updatePosition:', error.message);
    return false;
  }
}

// ============ CRÉATION D'UNE POSITION ============
async function createPosition(positionData) {
  try {
    const docRef = await addDoc(collection(db, COLLECTIONS.POSITIONS), {
      ...positionData,
      createdAt: serverTimestamp(),
      date: new Date().toISOString(),
      status: 'open'
    });
    console.log(`📌 Position créée | ID: ${docRef.id}`);
    return docRef.id;
  } catch (error) {
    console.error('❌ Erreur createPosition:', error.message);
    return null;
  }
}

// ============ ENREGISTREMENT DES MÉTRIQUES ============
async function saveMetrics(metricsData) {
  try {
    const docRef = await addDoc(collection(db, COLLECTIONS.METRICS), {
      ...metricsData,
      timestamp: serverTimestamp(),
      date: new Date().toISOString()
    });
    return docRef.id;
  } catch (error) {
    console.error('❌ Erreur saveMetrics:', error.message);
    return null;
  }
}

// ============ ENREGISTREMENT DU RÉSUMÉ JOURNALIER ============
async function saveDailySummary(summaryData) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const docRef = doc(db, COLLECTIONS.DAILY_SUMMARY, today);
    await setDoc(docRef, {
      ...summaryData,
      date: today,
      updatedAt: serverTimestamp()
    });
    console.log(`📅 Résumé journalier enregistré: ${today}`);
    return true;
  } catch (error) {
    console.error('❌ Erreur saveDailySummary:', error.message);
    return false;
  }
}

// ============ RÉCUPÉRATION DES DERNIERS TRADES ============
async function getRecentTrades(limitCount = 10) {
  try {
    const q = query(
      collection(db, COLLECTIONS.TRADES),
      orderBy('timestamp', 'desc'),
      limit(limitCount)
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error('❌ Erreur getRecentTrades:', error.message);
    return [];
  }
}

// ============ RÉCUPÉRATION DES STATISTIQUES ============
async function getTradeStats() {
  try {
    const snapshot = await getDocs(collection(db, COLLECTIONS.TRADES));
    const trades = snapshot.docs.map(doc => doc.data());
    
    const total = trades.length;
    const wins = trades.filter(t => t.profit > 0).length;
    const losses = trades.filter(t => t.profit < 0).length;
    const totalProfit = trades.reduce((sum, t) => sum + (t.profit || 0), 0);
    const winRate = total > 0 ? (wins / total) * 100 : 0;
    
    return {
      total,
      wins,
      losses,
      totalProfit,
      winRate
    };
  } catch (error) {
    console.error('❌ Erreur getTradeStats:', error.message);
    return null;
  }
}

module.exports = {
  db,
  saveTrade,
  saveSignal,
  saveIndicators,
  updatePosition,
  createPosition,
  saveMetrics,
  saveDailySummary,
  getRecentTrades,
  getTradeStats,
  COLLECTIONS
};