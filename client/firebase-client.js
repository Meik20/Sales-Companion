/**
 * Firebase Client Module
 * Initializes Firebase SDK for use in Electron renderer
 * Uses environment variables for configuration
 */

const { initializeApp } = require('firebase/app');
const { getAuth } = require('firebase/auth');
const { getFirestore } = require('firebase/firestore');

// Load config from environment variables (set in preload.js or .env)
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY || 'AIzaSyCVJxyeysHWDQ7yECTb-GApJz7u8s5l7N0',
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN || 'sales-companion-9cf56.firebaseapp.com',
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID || 'sales-companion-9cf56',
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET || 'sales-companion-9cf56.firebasestorage.app',
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID || '1058275289756',
  appId: process.env.REACT_APP_FIREBASE_APP_ID || '1:1058275289756:web:8c3a2f9b4e1d7c6f5a4b9e8d7c6f5a4b'
};

console.log('[Firebase] Initializing Firebase with config:', firebaseConfig.projectId);

try {
  const firebaseApp = initializeApp(firebaseConfig);
  const auth = getAuth(firebaseApp);
  const db = getFirestore(firebaseApp);
  
  auth.languageCode = 'fr';
  
  console.log('✅ Firebase initialized successfully');
  console.log('✅ Auth and Firestore ready');
  
  // Export for use in renderer
  module.exports = {
    firebaseApp,
    auth,
    db,
    initializeApp,
    getAuth,
    getFirestore
  };
} catch (error) {
  console.error('❌ Firebase initialization error:', error);
  module.exports = {
    error: error.message
  };
}
