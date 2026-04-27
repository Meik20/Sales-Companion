/**
 * Firebase Configuration pour Client (Electron & Mobile)
 * Configuration Web SDK Firebase - production
 */

console.log('[Firebase Config] Initializing...');

const firebaseConfig = {
  apiKey: '' || '',  // Set in environment via /api/config/firebase
  authDomain: 'sales-companion-237.firebaseapp.com',
  projectId: 'sales-companion-237',
  storageBucket: 'sales-companion-237.firebasestorage.app',
  messagingSenderId: '1075913757125',
  appId: '1:1075913757125:web:71cc06fb7f55100c5fbbac',
};

// Validate config
if (!firebaseConfig.projectId) {
  console.warn('⚠️ Firebase config: projectId manquant');
}

// If apiKey is not set, skip automatic initialization. Admin UI will
// fetch runtime config from `/api/config/firebase` and call
// `firebase.initializeApp(cfg)` itself. This prevents invalid-api-key
// errors when the static file contains placeholders.
if (!firebaseConfig.apiKey) {
  console.log('[Firebase Config] apiKey empty — skipping automatic init');
  // expose helper for consumers that want to initialize from server config
  window.initFirebaseFromServer = async function() {
    try {
      const res = await fetch('/api/config/firebase');
      const cfg = await res.json();
      if (!cfg || !cfg.apiKey) throw new Error('No firebase config from server');
      if (!firebase.apps.length) firebase.initializeApp(cfg);
      return { ok: true };
    } catch (e) {
      console.error('[initFirebaseFromServer] failed:', e.message || e);
      return { ok: false, error: e };
    }
  };

} else {
  try {
    // ── Initialisation de l'app ──────────────────────────────────────
    const app = firebase.initializeApp(firebaseConfig);
    console.log('✓ Firebase app initialized');

  // ── Services ─────────────────────────────────────────────────────
  const auth = firebase.auth();
  const storage = firebase.storage ? firebase.storage() : null;

  // ── Firestore — initialisation avec persistance moderne ────────
  // Utiliser initializeFirestore + persistentLocalCache/persistentMultipleTabManager
  // quand disponible, sinon retomber sur la compatibilité firebase.firestore().
  let db;
  try {
    if (typeof firebase.initializeFirestore === 'function') {
      // Si l'environnement expose les helpers modernes, utilisez-les.
      try {
        db = firebase.initializeFirestore(app, {
          // Si persistentLocalCache/persistentMultipleTabManager sont exposés,
          // construisez la configuration de cache locale multi-tab.
          localCache: (typeof firebase.persistentLocalCache === 'function' && typeof firebase.persistentMultipleTabManager === 'function')
            ? firebase.persistentLocalCache({ tabManager: firebase.persistentMultipleTabManager() })
            : undefined
        });
      } catch (initErr) {
        console.warn('⚠️ initializeFirestore failed, falling back to firestore():', initErr.message);
        db = firebase.firestore();
      }
    } else {
      db = firebase.firestore();
    }

    // Appliquer des settings compatibles si supportés
    try {
      if (db && typeof db.settings === 'function' && firebase.firestore && firebase.firestore.CACHE_SIZE_UNLIMITED) {
        db.settings({ cacheSizeBytes: firebase.firestore.CACHE_SIZE_UNLIMITED });
      }
    } catch (settingsErr) {
      console.warn('⚠️ Firestore settings déjà appliqués ou non supportés:', settingsErr.message);
    }
  } catch (e) {
    console.error('❌ Firestore initialization error:', e.message || e);
    db = firebase.firestore ? firebase.firestore() : null;
  }

  // ── Langue ───────────────────────────────────────────────────────
  auth.languageCode = 'fr';

  // ── Exposition globale ────────────────────────────────────────────
  window.firebaseApp = { app, auth, db, storage };

  console.log('✓ Services initialized');
  console.log('✓ Firebase ready');

} catch (error) {
  console.error('❌ Firebase initialization error:', error.message);
  console.error('Vérifiez votre configuration Firebase.');
}
