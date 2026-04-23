/**
 * Firebase Configuration pour Client (Electron & Mobile)
 * Configuration Web SDK Firebase - hardcodée pour production
 */

// Initialize Firebase with production config
const firebaseConfig = {
  apiKey: '' || '',  // Set in environment
  authDomain: 'sales-companion-237.firebaseapp.com',
  projectId: 'sales-companion-237',
  storageBucket: 'sales-companion-237.firebasestorage.app',
  messagingSenderId: '1075913757125',
  appId: '1:1075913757125:web:71cc06fb7f55100c5fbbac',
};

console.log('[Firebase Config] Using production Firebase configuration');

// Validate that config is present
if (!firebaseConfig.projectId || !firebaseConfig.apiKey) {
  console.warn('⚠️ Firebase config: apiKey may not be set - check environment variables');
}

// Initialize Firebase
try {
  const app = firebase.initializeApp(firebaseConfig);
  console.log('✓ Firebase app initialized');

  // Get Firebase services
  const auth = firebase.auth();
  let db = null;
  const storage = firebase.storage ? firebase.storage() : null;

  // Prefer the modern persistence API when available (supports multi-tab natively)
  try {
    if (typeof firebase.initializeFirestore === 'function' && typeof firebase.persistentLocalCache === 'function') {
      // If the modular APIs are exposed on the firebase global, use them
      db = firebase.initializeFirestore(app, {
        cache: firebase.persistentLocalCache({
          tabManager: (typeof firebase.persistentMultipleTabManager === 'function') ? firebase.persistentMultipleTabManager() : undefined
        })
      });
      console.log('✓ Firestore initialized with persistentLocalCache (multi-tab)');
    } else {
      // Fallback to compat / older API
      db = firebase.firestore();
      if (db && typeof db.enablePersistence === 'function') {
        // Try to enable multi-tab persistence where supported
        db.enablePersistence({ synchronizeTabs: true }).then(function() {
          console.log('✓ Persistence enabled (synchronizeTabs:true)');
        }).catch((error) => {
          if (error.code === 'failed-precondition') {
            console.warn('⚠️ Multiple tabs open, persistence disabled');
          } else if (error.code === 'unimplemented') {
            console.warn('⚠️ Browser does not support persistence');
          } else {
            console.warn('⚠️ Persistence error:', error.message);
          }
        });
      }
    }
  } catch (err) {
    console.warn('⚠️ Firestore persistence initialization failed, falling back to default. ' + (err && err.message));
    try { db = db || firebase.firestore(); } catch (e) { console.warn('Unable to initialize firestore:', e && e.message); }
  }

  // Set auth language
  auth.languageCode = 'fr';

  // Make globally available for client code
  window.firebaseApp = { app, auth, db, storage };
  
} catch (error) {
  console.error('❌ Firebase initialization error:', error.message);
  console.error('This may be a fatal error. Check your Firebase configuration.');
}

