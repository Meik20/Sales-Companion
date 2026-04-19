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
  const db = firebase.firestore(app);
  const storage = firebase.storage(app);

  console.log('✓ Services initialized');

  // Persistence offline
  db.enablePersistence().catch((error) => {
    if (error.code === 'failed-precondition') {
      console.info('⚠️ Multiple tabs ouvertes');
    } else if (error.code === 'unimplemented') {
      console.warn('⚠️ Navigateur non supporté');
    }
  });

  auth.languageCode = 'fr';

  // Exposer globalement
  window.auth = auth;
  window.db = db;
  window.storage = storage;

  console.log('✓ Firebase ready');

} catch (error) {
  console.error('❌ Firebase init error:', error);
}