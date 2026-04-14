/**
 * Firebase Configuration pour Client (Electron & Mobile)
 * Configuration Web SDK Firebase
 * 
 * Les valeurs DOIVENT être injectées depuis:
 * 1. Window globals (pour Web/PWA)
 * 2. Environment variables (pour Electron)
 * 3. API endpoint (pour Mobile)
 * 
 * JAMAIS hardcodées en dur !
 */

// Initialize Firebase with injected config
// Config should come from: window globals, env vars, or API
const firebaseConfig = {
  apiKey: window.FIREBASE_API_KEY || process.env.REACT_APP_FIREBASE_API_KEY || '',
  authDomain: window.FIREBASE_AUTH_DOMAIN || process.env.REACT_APP_FIREBASE_AUTH_DOMAIN || '',
  projectId: window.FIREBASE_PROJECT_ID || process.env.REACT_APP_FIREBASE_PROJECT_ID || '',
  storageBucket: window.FIREBASE_STORAGE_BUCKET || process.env.REACT_APP_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: window.FIREBASE_MESSAGING_SENDER_ID || process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: window.FIREBASE_APP_ID || process.env.REACT_APP_FIREBASE_APP_ID || '',
};

// Validate that config is present
if (!firebaseConfig.projectId || !firebaseConfig.apiKey) {
  console.error('❌ Firebase config incomplet - vérifiez les variables d\'environnement ou l\'API');
}

// Import Firebase modules (utilisez CDN ou imports ES6)
// Pour Electron: npm install firebase
// Pour Web: utiliser les CDN Firebase

// Initialize Firebase
const app = firebase.initializeApp(firebaseConfig);

// Get Firebase services
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

// Enable persistence
db.enablePersistence().catch((error) => {
  if (error.code === 'failed-precondition') {
    console.warn('⚠️ Multiple tabs open, persistence disabled');
  } else if (error.code === 'unimplemented') {
    console.warn('⚠️ Browser does not support persistence');
  }
});

// Set auth language
auth.languageCode = 'fr';

export { app, auth, db, storage };
