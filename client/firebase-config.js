/**
 * Firebase Configuration pour Client (Electron & Mobile)
 * Configuration Web SDK Firebase - hardcodée pour production
 */

// Initialize Firebase with production config
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY || '',  // Set in .env
  authDomain: 'sales-companion-237.firebaseapp.com',
  projectId: 'sales-companion-237',
  storageBucket: 'sales-companion-237.firebasestorage.app',
  messagingSenderId: '1075913757125',
  appId: '1:1075913757125:web:71cc06fb7f55100c5fbbac',
};

console.log('[Firebase Config] Using production Firebase configuration');

// Validate that config is present
if (!firebaseConfig.projectId || !firebaseConfig.apiKey) {
  console.error('❌ Firebase config incomplet - Firebase initialization failed');
}

// Initialize Firebase
const app = firebase.initializeApp(firebaseConfig);
console.log('✓ Firebase app initialized');

// Get Firebase services
const auth = firebase.auth();
let db = null;
const storage = (firebase.storage) ? firebase.storage() : null;
console.log('✓ Firebase services initialized (auth, storage)');

// Prefer modern persistence API (persistentLocalCache) when available
try {
  if (typeof firebase.initializeFirestore === 'function' && typeof firebase.persistentLocalCache === 'function') {
    db = firebase.initializeFirestore(app, {
      cache: firebase.persistentLocalCache({
        tabManager: (typeof firebase.persistentMultipleTabManager === 'function') ? firebase.persistentMultipleTabManager() : undefined
      })
    });
    console.log('✓ Firestore initialized with persistentLocalCache (multi-tab)');
  } else {
    db = firebase.firestore();
    if (db && typeof db.enablePersistence === 'function') {
      db.enablePersistence({ synchronizeTabs: true }).catch((error) => {
        if (error.code === 'failed-precondition') {
          console.warn('⚠️ Multiple tabs open, persistence disabled');
        } else if (error.code === 'unimplemented') {
          console.warn('⚠️ Browser does not support persistence');
        }
      });
    }
  }
} catch (e) {
  console.warn('⚠️ Firestore persistence init failed, falling back to default. ' + (e && e.message));
  try { db = db || firebase.firestore(); } catch (er) { console.warn('Unable to initialize firestore:', er && er.message); }
}

// Set auth language
auth.languageCode = 'fr';

export { app, auth, db, storage };
