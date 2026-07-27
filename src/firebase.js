// firebase.js
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
        
        // Nettoie les caractères invisibles
        const cleanJson = credentialsJson.trim();
        const serviceAccount = JSON.parse(cleanJson);
        
        // Vérifie que les champs requis sont présents
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

// ... le reste du code
