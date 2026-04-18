/**
 * Sales Companion Server — Firebase Edition
 * Migration complète vers Firebase Admin SDK + Firestore
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet'); // FIX [info-3]: ajout helmet
const path = require('path');
const multer = require('multer');
const XLSX = require('xlsx');
const fs = require('fs');
const os = require('os');
const fetch = require('node-fetch');
require('dotenv').config();

// Firebase
const { auth } = require('./firebase-config');
const {
  verifyToken,
  verifyAdmin,
  createUser,
  getUser,
  updateUserPlan,
  searchCompanies,
  importCompaniesBatch,
  addSavedSearch,
  getSavedSearches,
  deleteSavedSearch,
  getUserPipeline,
  addPipelineProspect,
  updatePipelineProspect,
  deletePipelineProspect,
  getConfig,
  setConfig,
  logUsage,
} = require('./firestore-operations');

// ── STARTUP VALIDATION ─────────────────────────────────────────
// FIX [info-3]: vérifier les variables d'environnement avant de démarrer
const REQUIRED_ENV = ['FIREBASE_API_KEY'];
const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missingEnv.length > 0) {
  console.error(`[FATAL] Variables d'environnement manquantes : ${missingEnv.join(', ')}`);
  process.exit(1);
}

// ── SERVER SETUP ──────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3210;
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

// FIX [info-2]: helmet pour les en-têtes HTTP de sécurité
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://www.gstatic.com",
          "https://apis.google.com",
        ],
        scriptSrcElem: [
          "'self'",
          "'unsafe-inline'",
          "https://www.gstatic.com",
          "https://apis.google.com",
        ],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: [
          "'self'",
          "https://*.firebaseapp.com",
          "https://*.googleapis.com",
          "https://*.google.com",
          "https://identitytoolkit.googleapis.com",
          "https://www.gstatic.com",
        ],
        frameSrc: ["https://*.firebaseapp.com"],
      },
    },
  })
);

// FIX [warn-1]: CORS restreint aux origines connues
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3210').split(',');
app.use(
  cors({
    origin: (origin, callback) => {
      // Autoriser les requêtes sans origin (ex: Electron, Postman en dev)
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Origine non autorisée par la politique CORS'));
      }
    },
  })
);

app.use(express.json({ limit: '10mb' }));

// ── ADMIN PANEL SPA (Single Page Application) ─────────────────
// Serve static files for admin panel assets
app.use(express.static(path.join(__dirname, 'admin')));

// ── MOBILE APP (PWA) ──────────────────────────────────────────
app.use('/mobile', express.static(path.join(__dirname, '..', 'mobile')));

// ── RATE LIMITING ──────────────────────────────────────────────
// FIX [critical-4]: rate limiting sur les routes d'authentification
// Nécessite : npm install express-rate-limit
const rateLimit = require('express-rate-limit');
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { error: 'Trop de tentatives, réessayez dans 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── LOCAL IP DETECTION ──────────────────────────────────────────
function getLocalIP() {
  if (process.env.SERVER_IP && process.env.SERVER_IP !== 'localhost') {
    return process.env.SERVER_IP;
  }
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

// ── MULTER CONFIGURATION ────────────────────────────────────────
const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['.xlsx', '.xls', '.csv'].some((ext) =>
      file.originalname.toLowerCase().endsWith(ext)
    );
    cb(null, ok);
  },
});

// ── HELPERS ─────────────────────────────────────────────────────

// FIX [warn-3]: helper pour ne pas exposer les erreurs internes
function safeError(res, status, publicMsg, internalErr) {
  console.error(`[ERROR] ${publicMsg}:`, internalErr?.message || internalErr);
  return res.status(status).json({ error: publicMsg });
}

// FIX [warn-4]: validation du paramètre limit
function parseLimit(value, defaultVal = 50, max = 200) {
  const n = parseInt(value, 10);
  if (isNaN(n) || n < 1) return defaultVal;
  return Math.min(n, max);
}

// ── SECTOR DETECTION ────────────────────────────────────────────
const SECTOR_KEYWORDS = {
  'BTP et construction': [
    'btp', 'construction', 'bâtiment', 'travaux', 'immobilier',
    'génie civil', 'architecture', 'maçonnerie',
  ],
  'Commerce et distribution': [
    'commerce', 'distribution', 'vente', 'négoce', 'trading',
    'grossiste', 'détail', 'supermarché',
  ],
  'Import-Export': ['import', 'export', 'transit', 'douane', 'fret', 'shipping', 'cargo', 'international'],
  Agroalimentaire: [
    'agroalimentaire', 'alimentaire', 'agro', 'boulangerie', 'pâtisserie',
    'restauration rapide', 'conserve', 'laiterie',
  ],
  'Agriculture et élevage': [
    'agriculture', 'élevage', 'ferme', 'cultivat', 'plantation',
    'pastoral', 'aviculture', 'pisciculture',
  ],
  'Technologies et numérique': [
    'informatique', 'numérique', 'tech', 'digital', 'logiciel', 'software',
    'internet', 'télécommunication', 'it ', 'telecom',
  ],
  'Transport et logistique': [
    'transport', 'logistique', 'fret', 'messagerie', 'déménagement',
    'taxi', 'véhicule', 'transitaire',
  ],
  'Santé et pharmacie': ['santé', 'pharmacie', 'médical', 'clinique', 'hôpital', 'laboratoire', 'soins', 'médecin'],
  'Éducation et formation': [
    'éducation', 'formation', 'école', 'lycée', 'université',
    'enseignement', 'académie', 'apprentissage',
  ],
  'Hôtellerie et restauration': [
    'hôtel', 'restaurant', 'hébergement', 'auberge', 'café', 'bar', 'traiteur', 'tourisme',
  ],
  'Services financiers': [
    'banque', 'finance', 'assurance', 'crédit', 'microfinance',
    'investissement', 'capital', 'épargne',
  ],
  'Énergie et mines': ['énergie', 'mines', 'pétrole', 'gaz', 'électricité', 'solaire', 'hydraulique', 'extracti'],
  'Industrie et manufacturing': [
    'industrie', 'manufactur', 'usine', 'production', 'fabrication',
    'emballage', 'imprimerie', 'métallurgie',
  ],
  'Médias et communication': [
    'média', 'communication', 'presse', 'radio', 'télévision',
    'publicité', 'événementiel', 'relations',
  ],
  'Conseil et services B2B': [
    'conseil', 'consulting', 'audit', 'expertise', 'comptabilité',
    'juridique', 'ressources humaines', 'nettoyage', 'sécurité',
  ],
};

function detectSector(activite) {
  if (!activite) return 'Autres';
  const a = activite.toLowerCase();
  for (const [sector, keywords] of Object.entries(SECTOR_KEYWORDS)) {
    if (keywords.some((k) => a.includes(k))) return sector;
  }
  return 'Autres';
}

// ── AUTH ROUTES ─────────────────────────────────────────────────

/**
 * POST /auth/sign-up
 * Inscription utilisateur (route originale — conservée pour compatibilité)
 */
app.post('/auth/sign-up', authLimiter, async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    const user = await createUser(email, password, { name });
    res.json({ uid: user.uid, email: user.email, message: 'User created successfully' });
  } catch (error) {
    return safeError(res, 400, 'Erreur lors de la création du compte', error);
  }
});

// FIX [warn-5]: /auth/sign-in supprimé — route inutile doublonnant /auth/login

/**
 * GET /auth/me
 * Récupérer profil utilisateur (route canonique)
 */
app.get('/auth/me', verifyToken, async (req, res) => {
  try {
    const user = await getUser(req.userId);
    res.json(user);
  } catch (error) {
    return safeError(res, 500, 'Impossible de récupérer le profil', error);
  }
});

// FIX [info-1]: alias /auth/user supprimé — utiliser uniquement /auth/me

// ── COMPANY ROUTES ──────────────────────────────────────────────

/**
 * GET /api/companies/search
 * Rechercher des entreprises
 */
app.get('/api/companies/search', verifyToken, async (req, res) => {
  try {
    const { sector, region, city } = req.query;
    // FIX [warn-4]: limit validé et plafonné
    const limit = parseLimit(req.query.limit);

    await logUsage(req.userId, `search:${sector || 'all'}`, 1);

    const companies = await searchCompanies({
      sector: sector || null,
      region: region || null,
      city: city || null,
      limit,
      active: true,
    });

    res.json({ count: companies.length, data: companies });
  } catch (error) {
    return safeError(res, 500, 'Erreur lors de la recherche', error);
  }
});

/**
 * POST /api/companies/import
 * Importer entreprises depuis Excel (admin only)
 */
app.post('/api/companies/import', verifyAdmin, upload.single('file'), async (req, res) => {
  const cleanup = () => {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  };

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const workbook = XLSX.readFile(req.file.path);
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(worksheet);

    const companies = data.map((row) => ({
      raisonSociale: row.RAISON_SOCIALE || row['Raison Sociale'] || '',
      sigle: row.SIGLE || row['Sigle'] || '',
      niu: row.NIU || row['NIU'] || null,
      activitePrincipale: row.ACTIVITE_PRINCIPALE || row['Activité Principale'] || '',
      centreRattachement: row.CENTRE_DE_RATTACHEMENT || row['Centre Rattachement'] || '',
      sector: detectSector(row.ACTIVITE_PRINCIPALE || row['Activité Principale'] || ''),
      region: (row.CENTRE_DE_RATTACHEMENT || row['Centre Rattachement'] || '').split('/')[0] || '',
      city: (row.CENTRE_DE_RATTACHEMENT || row['Centre Rattachement'] || '').split('/')[1] || '',
      telephone: row.TELEPHONE || row['Téléphone'] || '',
      email: row.EMAIL || row['Email'] || '',
      siteWeb: row.SITE_WEB || row['Site Web'] || '',
      dirigeant: row.DIRIGEANT || row['Dirigeant'] || '',
      rccm: row.RCCM || row['RCCM'] || '',
      sourceFile: req.file.originalname,
    }));

    const result = await importCompaniesBatch(companies);
    cleanup();

    res.json({
      message: 'Import successful',
      imported: result.importedCount,
      skipped: result.skippedCount,
    });
  } catch (error) {
    cleanup();
    return safeError(res, 500, "Erreur lors de l'import", error);
  }
});

// ── CLIENT COMPATIBILITY ROUTES ──────────────────────────────────

app.post('/api/search', verifyToken, async (req, res) => {
  try {
    const { query, filters = {} } = req.body;
    const companies = await searchCompanies({
      query,
      sector: filters.secteur || filters.sector || null,
      region: filters.region || null,
      city: filters.ville || filters.city || null,
      limit: filters.limit || 50,
      active: true,
    });

    res.json({
      count: companies.length,
      source: 'database',
      results: companies,
    });
  } catch (error) {
    return safeError(res, 500, 'Erreur lors de la recherche', error);
  }
});

app.post('/api/chat', verifyToken, async (req, res) => {
  try {
    const { messages } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages are required' });
    }

    return res.json({
      choices: [
        {
          message: {
            content:
              'Assistant IA non configuré. Veuillez définir la clé groq_api_key dans la configuration du serveur.',
          },
        },
      ],
    });
  } catch (error) {
    return safeError(res, 500, 'Erreur du chat IA', error);
  }
});

app.post('/api/saved-searches', verifyToken, async (req, res) => {
  try {
    const saved = await addSavedSearch(req.userId, req.body);
    res.json({ success: true, data: saved });
  } catch (error) {
    return safeError(res, 500, 'Impossible de sauvegarder la recherche', error);
  }
});

app.get('/api/saved-searches', verifyToken, async (req, res) => {
  try {
    const searches = await getSavedSearches(req.userId);
    res.json({ data: searches });
  } catch (error) {
    return safeError(res, 500, 'Impossible de charger les recherches sauvegardées', error);
  }
});

app.delete('/api/saved-searches/:id', verifyToken, async (req, res) => {
  try {
    await deleteSavedSearch(req.userId, req.params.id);
    res.json({ success: true });
  } catch (error) {
    return safeError(res, 500, 'Impossible de supprimer la recherche sauvegardée', error);
  }
});

app.get('/api/pipeline', verifyToken, async (req, res) => {
  try {
    const pipeline = await getUserPipeline(req.userId);
    res.json({ data: pipeline });
  } catch (error) {
    return safeError(res, 500, 'Impossible de charger le pipeline', error);
  }
});

app.post('/api/pipeline', verifyToken, async (req, res) => {
  try {
    const prospect = await addPipelineProspect(req.userId, req.body);
    res.json({ data: prospect });
  } catch (error) {
    if (error.message && error.message.includes('already exists')) {
      return res.status(409).json({ error: 'Prospect déjà présent dans le pipeline' });
    }
    return safeError(res, 500, 'Impossible d’ajouter le prospect', error);
  }
});

app.put('/api/pipeline/:id', verifyToken, async (req, res) => {
  try {
    const prospect = await updatePipelineProspect(req.userId, req.params.id, req.body);
    res.json({ data: prospect });
  } catch (error) {
    return safeError(res, 500, 'Impossible de mettre à jour le pipeline', error);
  }
});

app.delete('/api/pipeline/:id', verifyToken, async (req, res) => {
  try {
    await deletePipelineProspect(req.userId, req.params.id);
    res.json({ success: true });
  } catch (error) {
    return safeError(res, 500, 'Impossible de supprimer le prospect du pipeline', error);
  }
});

app.get('/api/config', verifyToken, async (req, res) => {
  try {
    const key = req.query.key;
    if (!key) {
      return res.status(400).json({ error: 'Config key is required' });
    }
    const value = await getConfig(key);
    res.json({ key, value });
  } catch (error) {
    return safeError(res, 500, 'Impossible de récupérer la configuration', error);
  }
});

app.post('/api/config', verifyToken, async (req, res) => {
  try {
    const { key, value } = req.body;
    if (!key) {
      return res.status(400).json({ error: 'Config key is required' });
    }
    await setConfig(key, value);
    res.json({ success: true });
  } catch (error) {
    return safeError(res, 500, 'Impossible de sauvegarder la configuration', error);
  }
});

// ── ADMIN ROUTES ────────────────────────────────────────────────

/**
 * POST /admin/config
 * Sauvegarder configuration
 */
app.post('/admin/config', verifyAdmin, async (req, res) => {
  try {
    const { key, value } = req.body;
    // FIX [warn-4]: validation basique de la clé de config
    if (!key || typeof key !== 'string' || key.trim().length === 0) {
      return res.status(400).json({ error: 'Config key required' });
    }
    await setConfig(key.trim(), value);
    res.json({ message: `Config ${key} saved` });
  } catch (error) {
    return safeError(res, 500, 'Erreur de configuration', error);
  }
});

/**
 * GET /admin/config/:key
 * Récupérer configuration
 */
app.get('/admin/config/:key', verifyAdmin, async (req, res) => {
  try {
    const value = await getConfig(req.params.key);
    res.json({ key: req.params.key, value });
  } catch (error) {
    return safeError(res, 500, 'Erreur de lecture de configuration', error);
  }
});

/**
 * POST /admin/users/:uid/plan
 * Changer le plan utilisateur
 */
app.post('/admin/users/:uid/plan', verifyAdmin, async (req, res) => {
  try {
    const { plan } = req.body;
    if (!plan) {
      return res.status(400).json({ error: 'Plan required' });
    }
    await updateUserPlan(req.params.uid, plan);
    res.json({ message: `User plan updated to ${plan}` });
  } catch (error) {
    return safeError(res, 500, 'Erreur de mise à jour du plan', error);
  }
});

// ── HEALTH CHECK ────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    server: 'Sales Companion v2.0 (Firebase)',
    ip: getLocalIP(),
    port: PORT,
  });
});

// ── PUBLIC Firebase Config ──────────────────────────────────────
// FIX [critical-2]: utiliser les variables d'environnement exclusivement
app.get('/api/config/firebase', (req, res) => {
  try {
    res.json({
      apiKey: process.env.FIREBASE_API_KEY,
      authDomain: process.env.FIREBASE_AUTH_DOMAIN,
      projectId: process.env.FIREBASE_PROJECT_ID,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.FIREBASE_APP_ID,
    });
  } catch (error) {
    return safeError(res, 500, 'Failed to retrieve Firebase config', error);
  }
});

app.get('/mobile', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'mobile', 'index.html'));
});

// ── LANDING PAGE ────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'landing.html'));
});

// ── CLIENT COMPATIBILITY ROUTES ─────────────────────────────────

/**
 * POST /auth/register
 * FIX [bug-1]: création Firebase Auth PUIS document Firestore avec rollback si échec
 * FIX [bug-2]: rollback auth.deleteUser si createUserDocument échoue
 * FIX [critical-3]: FIREBASE_API_KEY validée au démarrage (voir haut du fichier)
 */
app.post('/auth/register', authLimiter, async (req, res) => {
  const { email, password, name } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  let firebaseUser = null;

  try {
    firebaseUser = await createUser(email, password, { name });

    const firebaseRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${process.env.FIREBASE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      }
    );

    const firebaseData = await firebaseRes.json();

    if (firebaseData.error) {
      return res.status(400).json({ error: 'Échec de la génération du token' });
    }

    res.status(201).json({
      token: firebaseData.idToken,
      user: {
        uid: firebaseUser.uid,
        email,
        name: name || email.split('@')[0],
        plan: 'free',
        daily_limit: 10,
        daily_used: 0,
        remaining: 10,
      },
      message: 'User created successfully',
    });
  } catch (error) {
    // FIX [bug-2]: rollback si Firebase Auth a été créé mais Firestore a échoué
    if (firebaseUser?.uid) {
      await auth.deleteUser(firebaseUser.uid).catch((e) =>
        console.error('[ROLLBACK FAILED] deleteUser:', e.message)
      );
    }
    return safeError(res, 400, "Erreur lors de l'inscription", error);
  }
});

/**
 * POST /auth/login
 * Connexion via Firebase REST API
 */
app.post('/auth/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const firebaseRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${process.env.FIREBASE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      }
    );

    const firebaseData = await firebaseRes.json();

    if (firebaseData.error) {
      // FIX [warn-3]: ne pas transmettre l'erreur Firebase brute
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }

    const user = await getUser(firebaseData.localId);
    await logUsage(firebaseData.localId, 'login');

    res.json({
      token: firebaseData.idToken,
      user: {
        uid: firebaseData.localId,
        email: firebaseData.email,
        name: user?.name || email.split('@')[0],
        plan: user?.plan || 'free',
        daily_limit: user?.daily_limit || 10,
        daily_used: user?.daily_used || 0,
        remaining: (user?.daily_limit || 10) - (user?.daily_used || 0),
      },
    });
  } catch (error) {
    return safeError(res, 500, 'Erreur de connexion', error);
  }
});

// ── ADMIN ROUTES ────────────────────────────────────────────────

/**
 * POST /admin/import
 * Importer des entreprises via Excel/CSV
 */
app.post('/admin/import', verifyAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Aucun fichier fourni' });
    }

    const filePath = req.file.path;
    const fileName = req.file.originalname;

    // Lire le fichier Excel/CSV
    const workbook = XLSX.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);

    if (rows.length === 0) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ error: 'Fichier vide' });
    }

    // Importer les entreprises (batch)
    const result = await importCompaniesBatch(rows);

    // Enregistrer le log d'import
    const db = require('firebase-admin').firestore();
    await db.collection('import_logs').add({
      filename: fileName,
      timestamp: new Date(),
      rows_processed: rows.length,
      rows_imported: result.imported,
      rows_failed: result.failed,
      admin_uid: req.user.uid,
    });

    fs.unlinkSync(filePath);

    res.json({
      success: true,
      message: `${result.imported} entreprises importées`,
      imported: result.imported,
      failed: result.failed,
      duplicates: result.duplicates || 0,
    });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return safeError(res, 500, "Erreur lors de l'import", error);
  }
});

// ── AUTH LOGIN ROUTES ────────────────────────────────────────────
/**
 * POST /admin/login
 * Authentification admin avec vérification du rôle
 */
app.post('/admin/login', authLimiter, async (req, res) => {
  try {
    const { username, password, email } = req.body;
    const identifier = email || username;

    if (!identifier || !password) {
      return res.status(400).json({ error: 'Email/ID et mot de passe requis' });
    }

    // Authentifier via Firebase REST API
    const firebaseRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${process.env.FIREBASE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: identifier, password, returnSecureToken: true }),
      }
    );

    const firebaseData = await firebaseRes.json();
    if (firebaseData.error) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }

    // Vérifier que l'utilisateur est bien admin via custom claims
    const userRecord = await auth.getUser(firebaseData.localId);
    const isAdmin = userRecord.customClaims?.admin === true;
    
    if (!isAdmin) {
      return res.status(403).json({ error: 'Accès refusé — admin uniquement' });
    }

    // Récupérer les données utilisateur
    const user = await getUser(firebaseData.localId);

    // Log connexion admin
    await logUsage(firebaseData.localId, 'admin_login');

    res.json({
      token: firebaseData.idToken,
      user: {
        uid: firebaseData.localId,
        email: firebaseData.email,
        name: user?.name || identifier.split('@')[0],
        role: 'admin',
      },
    });
  } catch (error) {
    return safeError(res, 500, 'Erreur de connexion admin', error);
  }
});

// ── ADMIN INIT ROUTE ────────────────────────────────────────────
/**
 * POST /init-admin
 * Créer utilisateur admin initial (à appeler une seule fois)
 */
app.post('/init-admin', async (req, res) => {
  try {
    const { adminEmail = 'admin@sales-companion.local', adminPassword = 'admin123' } = req.body;
    
    // Importer db depuis firestore-operations
    const admin = require('firebase-admin');
    const db = admin.firestore();

    // Vérifier qu'il n'y a pas déjà d'admin
    const existingAdmins = await auth.listUsers();
    for (const user of existingAdmins.users) {
      if (user.customClaims?.admin === true) {
        return res.status(400).json({ error: 'Admin existe déjà' });
      }
    }

    // Créer l'utilisateur admin
    const adminUser = await auth.createUser({
      email: adminEmail,
      password: adminPassword,
      displayName: 'Admin',
    });

    // Ajouter custom claims
    await auth.setCustomUserClaims(adminUser.uid, { admin: true });

    // Créer document Firestore
    await db.collection('users').doc(adminUser.uid).set({
      uid: adminUser.uid,
      email: adminEmail,
      name: 'Admin',
      role: 'admin',
      plan: 'enterprise',
      dailyLimit: 9999,
      dailyUsed: 0,
      lastReset: new Date().toISOString(),
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    res.json({
      success: true,
      message: 'Admin créé avec succès',
      email: adminEmail,
      uid: adminUser.uid,
    });
  } catch (error) {
    return safeError(res, 500, 'Erreur lors de la création admin', error);
  }
});

// ── ADMIN STATS ────────────────────────────────────────────────
app.get('/admin/stats', verifyAdmin, async (req, res) => {
  const { getFirestore } = require('firebase-admin/firestore');
  const adminDb = getFirestore();

  // Helper — renvoie 0 si la collection n'existe pas
  const safeCount = async (query) => {
    try { return (await query.count().get()).data().count; }
    catch(_) { return 0; }
  };

  // Helper — renvoie [] si la collection n'existe pas
  const safeDocs = async (query) => {
    try { return (await query.get()).docs.map(d => d.data()); }
    catch(_) { return []; }
  };

  try {
    const today = new Date(); today.setHours(0,0,0,0);

    const [totalUsers, totalCompanies, activeToday, totalSearches] = await Promise.all([
      safeCount(adminDb.collection('users')),
      safeCount(adminDb.collection('companies')),
      safeCount(adminDb.collection('usage_logs').where('createdAt', '>=', today)),
      safeCount(adminDb.collection('usage_logs')),
    ]);

    const users      = await safeDocs(adminDb.collection('users'));
    const companies  = await safeDocs(adminDb.collection('companies'));
    const recentLogs = await safeDocs(
      adminDb.collection('usage_logs').orderBy('createdAt','desc').limit(20)
    );

    // Répartition plans
    const planMap = {};
    users.forEach(u => { const p = u.plan || 'free'; planMap[p] = (planMap[p] || 0) + 1; });

    // Répartition régions et secteurs
    const regionMap = {}, secteurMap = {};
    companies.forEach(c => {
      if (c.region)  regionMap[c.region]   = (regionMap[c.region]   || 0) + 1;
      if (c.sector)  secteurMap[c.sector]  = (secteurMap[c.sector]  || 0) + 1;
    });

    res.json({
      totalUsers,
      totalCompanies,
      activeToday,
      totalSearches,
      planCounts:         Object.entries(planMap).map(([plan,c])=>({plan,c})),
      companiesByRegion:  Object.entries(regionMap).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([region,c])=>({region,c})),
      companiesBySecteur: Object.entries(secteurMap).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([secteur,c])=>({secteur,c})),
      recentLogs,
    });
  } catch (error) {
    return safeError(res, 500, 'Erreur stats', error);
  }
});

// ── ADMIN CONFIG (GET global) ───────────────────────────────────
app.get('/admin/config', verifyAdmin, async (req, res) => {
  try {
    const groq_api_key = await getConfig('groq_api_key');
    res.json({ groq_api_key });
  } catch (error) {
    return safeError(res, 500, 'Erreur config', error);
  }
});

// ── ADMIN PANEL SPA (Single Page Application) ─────────────────
// Fallback to index.html for admin SPA routes after all admin APIs
app.get('/admin*', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'index.html'));
});

// ── START SERVER ────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔════════════════════════════════════════════════════════╗
║  🏢 SALES COMPANION — Firebase Backend                 ║
║  📍 http://localhost:${PORT}                          ║
║  🔐 Firebase Admin SDK initialized                     ║
║  📱 Mobile: http://${getLocalIP()}:${PORT}/mobile     ║
║  🎛️  Admin: http://localhost:${PORT}/admin           ║
╚════════════════════════════════════════════════════════╝
  `);
});