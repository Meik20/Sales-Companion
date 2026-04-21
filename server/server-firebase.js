/**
 * Sales Companion Server — Firebase Edition
 * Migration complète vers Firebase Admin SDK + Firestore
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
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
const REQUIRED_ENV = ['FIREBASE_API_KEY'];
const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missingEnv.length > 0) {
  console.error(`[FATAL] Variables d'environnement manquantes : ${missingEnv.join(', ')}`);
  process.exit(1);
}

// ── SERVER SETUP ──────────────────────────────────────────────
const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3210;
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

// ── HELMET / CSP ──────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],

        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://www.gstatic.com",
          "https://apis.google.com"
        ],

        scriptSrcElem: [
          "'self'",
          "'unsafe-inline'",
          "https://www.gstatic.com",
          "https://apis.google.com"
        ],

        scriptSrcAttr: ["'unsafe-inline'"],

        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://fonts.googleapis.com"
        ],

        fontSrc: [
          "'self'",
          "https://fonts.gstatic.com"
        ],

        imgSrc: [
          "'self'",
          "data:",
          "https:"
        ],

        connectSrc: [
          "'self'",
          "https://*.firebaseapp.com",
          "https://*.googleapis.com",
          "https://*.google.com",
          "https://identitytoolkit.googleapis.com",
          "https://www.gstatic.com", // ✅ AJOUT IMPORTANT
        ],

        frameSrc: ["https://*.firebaseapp.com"],
      },
    },
  })
);

// ── CORS ──────────────────────────────────────────────────────
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3210').split(',');
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Origine non autorisée par la politique CORS'));
      }
    },
  })
);

app.use(express.json({ limit: '10mb' }));
// Serve static files: sw.js, manifest.json at root
app.use(express.static(path.join(__dirname, '..')));
// Admin panel
app.use(express.static(path.join(__dirname, 'admin')));
// Mobile PWA
app.use('/mobile', express.static(path.join(__dirname, '..', 'mobile')));

// ── RATE LIMITING ──────────────────────────────────────────────
const rateLimit = require('express-rate-limit');
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Trop de tentatives, réessayez dans 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── LOCAL IP ──────────────────────────────────────────────────
function getLocalIP() {
  if (process.env.SERVER_IP && process.env.SERVER_IP !== 'localhost') return process.env.SERVER_IP;
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

// ── MULTER ────────────────────────────────────────────────────
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

// ── HELPERS ───────────────────────────────────────────────────
function safeError(res, status, publicMsg, internalErr) {
  console.error(`[ERROR] ${publicMsg}:`, internalErr?.message || internalErr);
  return res.status(status).json({ error: publicMsg });
}

function parseLimit(value, defaultVal = 50, max = 200) {
  const n = parseInt(value, 10);
  if (isNaN(n) || n < 1) return defaultVal;
  return Math.min(n, max);
}

// ── SECTOR DETECTION ──────────────────────────────────────────
const SECTOR_KEYWORDS = {
  'BTP et construction': ['btp', 'construction', 'bâtiment', 'travaux', 'immobilier', 'génie civil', 'architecture', 'maçonnerie'],
  'Commerce et distribution': ['commerce', 'distribution', 'vente', 'négoce', 'trading', 'grossiste', 'détail', 'supermarché'],
  'Import-Export': ['import', 'export', 'transit', 'douane', 'fret', 'shipping', 'cargo', 'international'],
  'Agroalimentaire': ['agroalimentaire', 'alimentaire', 'agro', 'boulangerie', 'pâtisserie', 'restauration rapide', 'conserve', 'laiterie'],
  'Agriculture et élevage': ['agriculture', 'élevage', 'ferme', 'cultivat', 'plantation', 'pastoral', 'aviculture', 'pisciculture'],
  'Technologies et numérique': ['informatique', 'numérique', 'tech', 'digital', 'logiciel', 'software', 'internet', 'télécommunication', 'it ', 'telecom'],
  'Transport et logistique': ['transport', 'logistique', 'fret', 'messagerie', 'déménagement', 'taxi', 'véhicule', 'transitaire'],
  'Santé et pharmacie': ['santé', 'pharmacie', 'médical', 'clinique', 'hôpital', 'laboratoire', 'soins', 'médecin'],
  'Éducation et formation': ['éducation', 'formation', 'école', 'lycée', 'université', 'enseignement', 'académie', 'apprentissage'],
  'Hôtellerie et restauration': ['hôtel', 'restaurant', 'hébergement', 'auberge', 'café', 'bar', 'traiteur', 'tourisme'],
  'Services financiers': ['banque', 'finance', 'assurance', 'crédit', 'microfinance', 'investissement', 'capital', 'épargne'],
  'Énergie et mines': ['énergie', 'mines', 'pétrole', 'gaz', 'électricité', 'solaire', 'hydraulique', 'extracti'],
  'Industrie et manufacturing': ['industrie', 'manufactur', 'usine', 'production', 'fabrication', 'emballage', 'imprimerie', 'métallurgie'],
  'Médias et communication': ['média', 'communication', 'presse', 'radio', 'télévision', 'publicité', 'événementiel', 'relations'],
  'Conseil et services B2B': ['conseil', 'consulting', 'audit', 'expertise', 'comptabilité', 'juridique', 'ressources humaines', 'nettoyage', 'sécurité'],
};

function detectSector(activite) {
  if (!activite) return 'Autres';
  const a = String(activite).toLowerCase();
  for (const [sector, keywords] of Object.entries(SECTOR_KEYWORDS)) {
    if (keywords.some((k) => a.includes(k))) return sector;
  }
  return 'Autres';
}

// ══════════════════════════════════════════════════════════════
// AUTH ROUTES
// ══════════════════════════════════════════════════════════════

app.post('/auth/sign-up', authLimiter, async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const user = await createUser(email, password, { name });
    res.json({ uid: user.uid, email: user.email, message: 'User created successfully' });
  } catch (error) {
    return safeError(res, 400, 'Erreur lors de la création du compte', error);
  }
});

app.post('/auth/register', authLimiter, async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  let firebaseUser = null;
  try {
    firebaseUser = await createUser(email, password, { name });
    const firebaseRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${process.env.FIREBASE_API_KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) }
    );
    const firebaseData = await firebaseRes.json();
    if (firebaseData.error) return res.status(400).json({ error: 'Échec de la génération du token' });
    res.status(201).json({
      token: firebaseData.idToken,
      user: { uid: firebaseUser.uid, email, name: name || email.split('@')[0], plan: 'free', daily_limit: 10, daily_used: 0, remaining: 10 },
      message: 'User created successfully',
    });
  } catch (error) {
    if (firebaseUser?.uid) await auth.deleteUser(firebaseUser.uid).catch((e) => console.error('[ROLLBACK FAILED]', e.message));
    return safeError(res, 400, "Erreur lors de l'inscription", error);
  }
});

app.post('/auth/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const firebaseRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${process.env.FIREBASE_API_KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) }
    );
    const firebaseData = await firebaseRes.json();
    if (firebaseData.error) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    const user = await getUser(firebaseData.localId);
    await logUsage(firebaseData.localId, 'login');
    res.json({
      token: firebaseData.idToken,
      user: {
        uid: firebaseData.localId, email: firebaseData.email,
        name: user?.name || email.split('@')[0], plan: user?.plan || 'free',
        daily_limit: user?.daily_limit || 10, daily_used: user?.daily_used || 0,
        remaining: (user?.daily_limit || 10) - (user?.daily_used || 0),
      },
    });
  } catch (error) {
    return safeError(res, 500, 'Erreur de connexion', error);
  }
});

app.get('/auth/me', verifyToken, async (req, res) => {
  try {
    const user = await getUser(req.userId);
    
    // Si le document Firestore n'existe pas encore, retourner un profil minimal
    if (!user) {
      return res.json({
        uid:         req.userId,
        email:       req.userEmail,
        name:        req.userEmail?.split('@')[0] || 'Utilisateur',
        plan:        'free',
        dailyLimit:  10,
        dailyUsed:   0,
        remaining:   10,
        active:      true,
      });
    }
    
    res.json(user);
  } catch (error) {
    // Ne pas retourner 500 — retourner profil minimal
    return res.json({
      uid:        req.userId,
      email:      req.userEmail,
      name:       req.userEmail?.split('@')[0] || 'Utilisateur',
      plan:       'free',
      dailyLimit: 10,
      dailyUsed:  0,
      remaining:  10,
      active:     true,
    });
  }
});

// ══════════════════════════════════════════════════════════════
// ADMIN LOGIN & INIT
// ══════════════════════════════════════════════════════════════

app.post('/admin/login', authLimiter, async (req, res) => {
  try {
    const { username, password, email } = req.body;
    const identifier = email || username;
    if (!identifier || !password) return res.status(400).json({ error: 'Email/ID et mot de passe requis' });

    const firebaseRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${process.env.FIREBASE_API_KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: identifier, password, returnSecureToken: true }) }
    );
    const firebaseData = await firebaseRes.json();
    if (firebaseData.error) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });

    const userRecord = await auth.getUser(firebaseData.localId);
    const isAdmin = userRecord.customClaims?.admin === true;
    if (!isAdmin) return res.status(403).json({ error: 'Accès refusé — admin uniquement' });

    const user = await getUser(firebaseData.localId);
    await logUsage(firebaseData.localId, 'admin_login');
    res.json({
      token:        firebaseData.idToken,
      refreshToken: firebaseData.refreshToken, // ← ajouter
      user: { uid: firebaseData.localId, email: firebaseData.email,
              name: user?.name || identifier.split('@')[0], role:'admin' },
    });
  } catch (error) {
    return safeError(res, 500, 'Erreur de connexion admin', error);
  }
});

app.post('/init-admin', async (req, res) => {
  try {
    const { adminEmail = 'admin@sales-companion.local', adminPassword = 'admin123' } = req.body;
    const admin = require('firebase-admin');
    const db = admin.firestore();

    const existingAdmins = await auth.listUsers();
    for (const user of existingAdmins.users) {
      if (user.customClaims?.admin === true) return res.status(400).json({ error: 'Admin existe déjà' });
    }

    const adminUser = await auth.createUser({ email: adminEmail, password: adminPassword, displayName: 'Admin' });
    await auth.setCustomUserClaims(adminUser.uid, { admin: true });
    await db.collection('users').doc(adminUser.uid).set({
      uid: adminUser.uid, email: adminEmail, name: 'Admin', role: 'admin',
      plan: 'enterprise', dailyLimit: 9999, dailyUsed: 0,
      active: true, createdAt: new Date().toISOString(),
    });
    res.json({ success: true, message: 'Admin créé avec succès', email: adminEmail, uid: adminUser.uid });
  } catch (error) {
    return safeError(res, 500, 'Erreur lors de la création admin', error);
  }
});

// ══════════════════════════════════════════════════════════════
// ADMIN STATS & CONFIG
// ══════════════════════════════════════════════════════════════

app.get('/admin/stats', verifyAdmin, async (req, res) => {
  const { getFirestore } = require('firebase-admin/firestore');
  const adminDb = getFirestore();

  const safeCount = async (query) => {
    try { return (await query.count().get()).data().count; } catch(_) { return 0; }
  };
  const safeDocs = async (query) => {
    try { return (await query.get()).docs.map(d => d.data()); } catch(_) { return []; }
  };

  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const [totalUsers, totalCompanies, activeToday, totalSearches] = await Promise.all([
      safeCount(adminDb.collection('users')),
      safeCount(adminDb.collection('companies')),
      safeCount(adminDb.collection('usage_logs').where('createdAt', '>=', today)),
      safeCount(adminDb.collection('usage_logs')),
    ]);

    const users      = await safeDocs(adminDb.collection('users'));
    const companies  = await safeDocs(adminDb.collection('companies'));
    const recentLogs = await safeDocs(adminDb.collection('usage_logs').orderBy('createdAt', 'desc').limit(20));

    const planMap = {};
    users.forEach(u => { const p = u.plan || 'free'; planMap[p] = (planMap[p] || 0) + 1; });

    const regionMap = {}, secteurMap = {};
    companies.forEach(c => {
      if (c.region) regionMap[c.region]   = (regionMap[c.region]   || 0) + 1;
      if (c.sector) secteurMap[c.sector]  = (secteurMap[c.sector]  || 0) + 1;
    });

    res.json({
      totalUsers, totalCompanies, activeToday, totalSearches,
      planCounts:         Object.entries(planMap).map(([plan, c]) => ({ plan, c })),
      companiesByRegion:  Object.entries(regionMap).sort((a,b) => b[1]-a[1]).slice(0,8).map(([region, c]) => ({ region, c })),
      companiesBySecteur: Object.entries(secteurMap).sort((a,b) => b[1]-a[1]).slice(0,8).map(([secteur, c]) => ({ secteur, c })),
      recentLogs,
    });
  } catch (error) {
    return safeError(res, 500, 'Erreur stats', error);
  }
});

app.get('/admin/config', verifyAdmin, async (req, res) => {
  try {
    // getConfig peut retourner null si le doc n'existe pas — pas d'erreur
    const groq_api_key = await getConfig('groq_api_key').catch(() => null);
    res.json({ groq_api_key: groq_api_key || null });
  } catch (error) {
    // Ne pas retourner 500 — retourner un objet vide
    res.json({ groq_api_key: null });
  }
});

app.post('/admin/config', verifyAdmin, async (req, res) => {
  try {
    let { key, value } = req.body;
    // Accepte { key, value } OU { groq_api_key: '...' }
    if (!key && req.body && typeof req.body === 'object') {
      const payloadKeys = Object.keys(req.body).filter((k) => k !== 'value');
      if (payloadKeys.length === 1) { key = payloadKeys[0]; value = req.body[key]; }
    }
    if (!key || typeof key !== 'string' || key.trim().length === 0) {
      return res.status(400).json({ error: 'Config key required' });
    }
    await setConfig(key.trim(), value);
    res.json({ message: `Config ${key.trim()} saved` });
  } catch (error) {
    return safeError(res, 500, 'Erreur de configuration', error);
  }
});

app.get('/admin/config/:key', verifyAdmin, async (req, res) => {
  try {
    const value = await getConfig(req.params.key);
    res.json({ key: req.params.key, value });
  } catch (error) {
    return safeError(res, 500, 'Erreur de lecture de configuration', error);
  }
});

// ══════════════════════════════════════════════════════════════
// ADMIN IMPORT
// ══════════════════════════════════════════════════════════════

app.post('/admin/import', verifyAdmin, upload.single('file'), async (req, res) => {
  const cleanup = () => {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  };
  try {
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier fourni' });

    const workbook  = XLSX.readFile(req.file.path);
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const data      = XLSX.utils.sheet_to_json(worksheet);

    if (data.length === 0) { cleanup(); return res.status(400).json({ error: 'Fichier vide' }); }

    console.log('[IMPORT] Lignes lues:', data.length);
    console.log('[IMPORT] Première ligne:', JSON.stringify(data[0]));

    const companies = data.map((row) => ({
      raisonSociale:      String(row.RAISON_SOCIALE      || row['Raison Sociale']      || ''),
      sigle:              String(row.SIGLE                || row['Sigle']               || ''),
      niu:                row.NIU ? String(row.NIU) : null,
      activitePrincipale: String(row.ACTIVITE_PRINCIPALE || row['Activité Principale'] || ''),
      centreRattachement: String(row.CENTRE_DE_RATTACHEMENT || row['Centre Rattachement'] || ''),
      sector:             detectSector(row.ACTIVITE_PRINCIPALE || row['Activité Principale']),
      region:             String(row.CENTRE_DE_RATTACHEMENT || row['Centre Rattachement'] || '').split('/')[0] || '',
      city:               String(row.CENTRE_DE_RATTACHEMENT || row['Centre Rattachement'] || '').split('/')[1] || '',
      telephone:          String(row.TELEPHONE  || row['Téléphone'] || ''),
      email:              String(row.EMAIL       || row['Email']     || ''),
      siteWeb:            String(row.SITE_WEB    || row['Site Web']  || ''),
      dirigeant:          String(row.DIRIGEANT   || row['Dirigeant'] || ''),
      rccm:               String(row.RCCM        || row['RCCM']      || ''),
      active:             true,
      sourceFile:         req.file.originalname,
      createdAt:          new Date(),
    }));

    const result = await importCompaniesBatch(companies);
    cleanup();

    res.json({
      total:    data.length,
      imported: result.importedCount  || 0,
      updated:  result.updatedCount   || 0,
      skipped:  result.skippedCount   || 0,
      errors:   result.errorCount     || 0,
    });
  } catch (error) {
    cleanup();
    return safeError(res, 500, "Erreur lors de l'import", error);
  }
});

app.get('/admin/import-logs', verifyAdmin, async (req, res) => {
  try {
    const { getFirestore } = require('firebase-admin/firestore');
    const adminDb = getFirestore();
    const snap = await adminDb.collection('import_logs').orderBy('createdAt', 'desc').limit(20).get();
    const logs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json({ data: logs });
  } catch (error) {
    res.json({ data: [] });
  }
});

// ══════════════════════════════════════════════════════════════
// ADMIN COMPANIES
// ══════════════════════════════════════════════════════════════

app.get('/admin/companies', verifyAdmin, async (req, res) => {
  try {
    const { getFirestore } = require('firebase-admin/firestore');
    const adminDb = getFirestore();
    const { q, region, secteur, page = 1 } = req.query;
    const limit = 50;

    let query = adminDb.collection('companies');
    if (region)  query = query.where('region', '==', region);
    if (secteur) query = query.where('sector', '==', secteur);

    const snap = await query.get();
    let companies = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    if (q) {
      const ql = q.toLowerCase();
      companies = companies.filter((c) =>
        (c.raisonSociale      || '').toLowerCase().includes(ql) ||
        (c.niu                || '').toLowerCase().includes(ql) ||
        (c.activitePrincipale || '').toLowerCase().includes(ql)
      );
    }

    const total = companies.length;
    const pages = Math.ceil(total / limit) || 1;
    const start = (parseInt(page, 10) - 1) * limit;
    res.json({ companies: companies.slice(start, start + limit), total, page: parseInt(page, 10), pages });
  } catch (error) {
    return safeError(res, 500, 'Erreur chargement entreprises', error);
  }
});

// IMPORTANT : /admin/companies/all AVANT /admin/companies/:id
app.delete('/admin/companies/all', verifyAdmin, async (req, res) => {
  try {
    const { getFirestore } = require('firebase-admin/firestore');
    const adminDb = getFirestore();
    const snap = await adminDb.collection('companies').get();
    const batch = adminDb.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    res.json({ success: true, deleted: snap.size });
  } catch (error) {
    return safeError(res, 500, 'Erreur suppression totale', error);
  }
});

app.delete('/admin/companies/:id', verifyAdmin, async (req, res) => {
  try {
    const { getFirestore } = require('firebase-admin/firestore');
    await getFirestore().collection('companies').doc(req.params.id).delete();
    res.json({ success: true });
  } catch (error) {
    return safeError(res, 500, 'Erreur suppression', error);
  }
});

// ══════════════════════════════════════════════════════════════
// ADMIN USERS
// ══════════════════════════════════════════════════════════════

app.get('/admin/users', verifyAdmin, async (req, res) => {
  try {
    const { getFirestore } = require('firebase-admin/firestore');
    const snap = await getFirestore().collection('users').get();
    const users = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(users);
  } catch (error) {
    return safeError(res, 500, 'Erreur chargement utilisateurs', error);
  }
});

app.post('/admin/users/:uid/plan', verifyAdmin, async (req, res) => {
  try {
    const { plan } = req.body;
    if (!plan) return res.status(400).json({ error: 'Plan required' });
    await updateUserPlan(req.params.uid, plan);
    res.json({ message: `User plan updated to ${plan}` });
  } catch (error) {
    return safeError(res, 500, 'Erreur de mise à jour du plan', error);
  }
});

app.post('/admin/users/:uid/toggle', verifyAdmin, async (req, res) => {
  try {
    const { getFirestore } = require('firebase-admin/firestore');
    const ref  = getFirestore().collection('users').doc(req.params.uid);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'Utilisateur non trouvé' });
    const active = !snap.data().active;
    await ref.update({ active });
    res.json({ success: true, active });
  } catch (error) {
    return safeError(res, 500, 'Erreur toggle utilisateur', error);
  }
});

app.delete('/admin/users/:uid', verifyAdmin, async (req, res) => {
  try {
    const { getFirestore } = require('firebase-admin/firestore');
    await Promise.all([
      auth.deleteUser(req.params.uid).catch(() => {}),
      getFirestore().collection('users').doc(req.params.uid).delete(),
    ]);
    res.json({ success: true });
  } catch (error) {
    return safeError(res, 500, 'Erreur suppression utilisateur', error);
  }
});

app.post('/admin/change-password', verifyAdmin, async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Minimum 6 caractères' });
    await auth.updateUser(req.userId, { password: newPassword });
    res.json({ success: true });
  } catch (error) {
    return safeError(res, 500, 'Erreur changement mot de passe', error);
  }
});

// ══════════════════════════════════════════════════════════════
// API ROUTES (mobile/client)
// ══════════════════════════════════════════════════════════════

app.get('/api/companies/search', verifyToken, async (req, res) => {
  try {
    const { sector, region, city } = req.query;
    const limit = parseLimit(req.query.limit);
    await logUsage(req.userId, `search:${sector || 'all'}`, 1);
    const companies = await searchCompanies({ sector: sector || null, region: region || null, city: city || null, limit, active: true });
    res.json({ count: companies.length, data: companies });
  } catch (error) {
    return safeError(res, 500, 'Erreur lors de la recherche', error);
  }
});

app.post('/api/companies/import', verifyAdmin, upload.single('file'), async (req, res) => {
  const cleanup = () => { if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); };
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const workbook  = XLSX.readFile(req.file.path);
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const data      = XLSX.utils.sheet_to_json(worksheet);
    const companies = data.map((row) => ({
      raisonSociale: String(row.RAISON_SOCIALE || row['Raison Sociale'] || ''),
      niu: row.NIU ? String(row.NIU) : null,
      activitePrincipale: String(row.ACTIVITE_PRINCIPALE || row['Activité Principale'] || ''),
      sector: detectSector(row.ACTIVITE_PRINCIPALE || row['Activité Principale']),
      region: String(row.CENTRE_DE_RATTACHEMENT || '').split('/')[0] || '',
      city:   String(row.CENTRE_DE_RATTACHEMENT || '').split('/')[1] || '',
      sourceFile: req.file.originalname,
    }));
    const result = await importCompaniesBatch(companies);
    cleanup();
    res.json({ message: 'Import successful', imported: result.importedCount, skipped: result.skippedCount });
  } catch (error) { cleanup(); return safeError(res, 500, "Erreur lors de l'import", error); }
});

app.post('/api/search', verifyToken, async (req, res) => {
  try {
    const { query, filters = {} } = req.body;
    const companies = await searchCompanies({
      query, sector: filters.secteur || filters.sector || null,
      region: filters.region || null, city: filters.ville || filters.city || null,
      limit: filters.limit || 50, active: true,
    });
    res.json({ count: companies.length, source: 'database', results: companies });
  } catch (error) { return safeError(res, 500, 'Erreur lors de la recherche', error); }
});

app.post('/api/chat', verifyToken, async (req, res) => {
  try {
    const { messages } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) return res.status(400).json({ error: 'Messages are required' });
    return res.json({ choices: [{ message: { content: 'Assistant IA non configuré.' } }] });
  } catch (error) { return safeError(res, 500, 'Erreur du chat IA', error); }
});

app.post('/api/saved-searches', verifyToken, async (req, res) => {
  try { const saved = await addSavedSearch(req.userId, req.body); res.json({ success: true, data: saved }); }
  catch (error) { return safeError(res, 500, 'Impossible de sauvegarder la recherche', error); }
});

app.get('/api/saved-searches', verifyToken, async (req, res) => {
  try { const searches = await getSavedSearches(req.userId); res.json({ data: searches }); }
  catch (error) { return safeError(res, 500, 'Impossible de charger les recherches sauvegardées', error); }
});

app.delete('/api/saved-searches/:id', verifyToken, async (req, res) => {
  try { await deleteSavedSearch(req.userId, req.params.id); res.json({ success: true }); }
  catch (error) { return safeError(res, 500, 'Impossible de supprimer la recherche sauvegardée', error); }
});

app.get('/api/pipeline', verifyToken, async (req, res) => {
  try { const pipeline = await getUserPipeline(req.userId); res.json({ data: pipeline }); }
  catch (error) { return safeError(res, 500, 'Impossible de charger le pipeline', error); }
});

app.post('/api/pipeline', verifyToken, async (req, res) => {
  try {
    const prospect = await addPipelineProspect(req.userId, req.body);
    res.json({ data: prospect });
  } catch (error) {
    if (error.message?.includes('already exists')) return res.status(409).json({ error: 'Prospect déjà présent dans le pipeline' });
    return safeError(res, 500, "Impossible d'ajouter le prospect", error);
  }
});

app.put('/api/pipeline/:id', verifyToken, async (req, res) => {
  try { const prospect = await updatePipelineProspect(req.userId, req.params.id, req.body); res.json({ data: prospect }); }
  catch (error) { return safeError(res, 500, 'Impossible de mettre à jour le pipeline', error); }
});

app.delete('/api/pipeline/:id', verifyToken, async (req, res) => {
  try { await deletePipelineProspect(req.userId, req.params.id); res.json({ success: true }); }
  catch (error) { return safeError(res, 500, 'Impossible de supprimer le prospect du pipeline', error); }
});

app.get('/api/config', verifyToken, async (req, res) => {
  try {
    const key = req.query.key;
    if (!key) return res.status(400).json({ error: 'Config key is required' });
    const value = await getConfig(key);
    res.json({ key, value });
  } catch (error) { return safeError(res, 500, 'Impossible de récupérer la configuration', error); }
});

app.post('/api/config', verifyToken, async (req, res) => {
  try {
    const { key, value } = req.body;
    if (!key) return res.status(400).json({ error: 'Config key is required' });
    await setConfig(key, value);
    res.json({ success: true });
  } catch (error) { return safeError(res, 500, 'Impossible de sauvegarder la configuration', error); }
});

// ══════════════════════════════════════════════════════════════
// SUPPORT ROUTES
// ══════════════════════════════════════════════════════════════
const supportRoutes = require('./routes/support');
app.use('/api/support', supportRoutes);

// ══════════════════════════════════════════════════════════════
// MISC ROUTES
// ══════════════════════════════════════════════════════════════

app.get('/api/config/firebase', (req, res) => {
  res.json({
    apiKey:            process.env.FIREBASE_API_KEY,
    authDomain:        process.env.FIREBASE_AUTH_DOMAIN,
    projectId:         process.env.FIREBASE_PROJECT_ID,
    storageBucket:     process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId:             process.env.FIREBASE_APP_ID,
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', server: 'Sales Companion v2.0 (Firebase)', ip: getLocalIP(), port: PORT });
});

app.get('/mobile', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'mobile', 'index.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'landing.html'));
});

// SPA fallback pour le panel admin (doit être en dernier)
app.get('/admin*', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'index.html'));
});

// ══════════════════════════════════════════════════════════════
// START
// ══════════════════════════════════════════════════════════════

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