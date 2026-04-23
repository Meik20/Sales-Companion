/**
 * Firebase Configuration pour Mobile PWA (utilisant les globals CDN)
 */

try {
  console.log('[Firebase Config] Initializing...');

  const firebaseConfig = {
    apiKey: 'AIzaSyB4N62OBpJ9xYkV34VKsJrYbR6Z6_NpSPg',  // Public API key
    authDomain: 'sales-companion-237.firebaseapp.com',
    projectId: 'sales-companion-237',
    storageBucket: 'sales-companion-237.firebasestorage.app',
    messagingSenderId: '1075913757125',
    appId: '1:1075913757125:web:71cc06fb7f55100c5fbbac',
  };

  const app = firebase.initializeApp(firebaseConfig);
  console.log('✓ Firebase app initialized');

  const auth = firebase.auth(app);
  let db = null;
  const storage = (firebase.storage) ? firebase.storage(app) : null;

  console.log('✓ Services initialized');

  // Modern persistence: prefer persistentLocalCache when available
  try {
    if (typeof firebase.initializeFirestore === 'function' && typeof firebase.persistentLocalCache === 'function') {
      db = firebase.initializeFirestore(app, {
        cache: firebase.persistentLocalCache({
          tabManager: (typeof firebase.persistentMultipleTabManager === 'function') ? firebase.persistentMultipleTabManager() : undefined
        })
      });
      console.log('✓ Firestore initialized with persistentLocalCache (multi-tab)');
    } else {
      db = firebase.firestore(app);
      if (db && typeof db.enablePersistence === 'function') {
        db.enablePersistence({ synchronizeTabs: true }).catch((error) => {
          if (error.code === 'failed-precondition') {
            console.info('⚠️ Multiple tabs ouvertes');
          } else if (error.code === 'unimplemented') {
            console.warn('⚠️ Navigateur non supporté');
          }
        });
      }
    }
  } catch (e) {
    console.warn('⚠️ Persistence init failed:', e && e.message);
    try { db = db || firebase.firestore(app); } catch (er) { console.warn('Unable to init firestore', er && er.message); }
  }

  auth.languageCode = 'fr';

  // Exposer globalement
  window.auth = auth;
  window.db = db;
  window.storage = storage;

  console.log('✓ Firebase ready');

  // Maps Embed API key (set in environment or before loading the script)
  // Example: window.MAPS_EMBED_API_KEY = 'YOUR_KEY';
  if (typeof window.MAPS_EMBED_API_KEY === 'undefined') window.MAPS_EMBED_API_KEY = '';

} catch (error) {
  console.error('❌ Firebase init error:', error);
}