// src/firebase.js
const admin = require('firebase-admin');

let db = null;
let initialized = false;

function initFirebase() {
    if (initialized) return true;
    
    try {
        const credentialsJson = process.env.FIREBASE_CREDENTIALS_JSON;
        
        if (!credentialsJson) {
            console.log("⚠️ Firebase non configuré (FIREBASE_CREDENTIALS_JSON manquant)");
            return false;
        }
        
        const cleanJson = credentialsJson.trim();
        const serviceAccount = JSON.parse(cleanJson);
        
        if (!serviceAccount.project_id || !serviceAccount.private_key) {
            console.log("❌ Firebase: Credentials invalides - champs manquants");
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
        console.log("💡 Vérifie que FIREBASE_CREDENTIALS_JSON est un JSON valide sur une seule ligne");
        return false;
    }
}

// ⚠️ VÉRIFIE QUE CE CODE EST PRÉSENT ⚠️
module.exports = {
    initFirebase
};

// Si tu as d'autres fonctions, elles doivent être dans module.exports aussi
