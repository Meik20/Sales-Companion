/**
 * Sales Companion Server — Firebase Edition
 * Migration complète vers Firebase Admin SDK + Firestore
 */

const express = require('express');
const cors = require('cors');
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
  getConfig,
  setConfig,
  logUsage,
} = require('./firestore-operations');

// ── SERVER SETUP ──────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3210;
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'admin')));
app.use('/mobile', express.static(path.join(__dirname, '..', 'mobile')));

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

// ── SECTOR DETECTION ────────────────────────────────────────────
const SECTOR_KEYWORDS = {
  'BTP et construction': [
    'btp',
    'construction',
    'bâtiment',
    'travaux',
    'immobilier',
    'génie civil',
    'architecture',
    'maçonnerie',
  ],
  'Commerce et distribution': [
    'commerce',
    'distribution',
    'vente',
    'négoce',
    'trading',
    'grossiste',
    'détail',
    'supermarché',
  ],
  'Import-Export': ['import', 'export', 'transit', 'douane', 'fret', 'shipping', 'cargo', 'international'],
  Agroalimentaire: [
    'agroalimentaire',
    'alimentaire',
    'agro',
    'boulangerie',
    'pâtisserie',
    'restauration rapide',
    'conserve',
    'laiterie',
  ],
  'Agriculture et élevage': [
    'agriculture',
    'élevage',
    'ferme',
    'cultivat',
    'plantation',
    'pastoral',
    'aviculture',
    'pisciculture',
  ],
  'Technologies et numérique': [
    'informatique',
    'numérique',
    'tech',
    'digital',
    'logiciel',
    'software',
    'internet',
    'télécommunication',
    'it ',
    'telecom',
  ],
  'Transport et logistique': [
    'transport',
    'logistique',
    'fret',
    'messagerie',
    'déménagement',
    'taxi',
    'véhicule',
    'transitaire',
  ],
  'Santé et pharmacie': ['santé', 'pharmacie', 'médical', 'clinique', 'hôpital', 'laboratoire', 'soins', 'médecin'],
  'Éducation et formation': [
    'éducation',
    'formation',
    'école',
    'lycée',
    'université',
    'enseignement',
    'académie',
    'apprentissage',
  ],
  'Hôtellerie et restauration': [
    'hôtel',
    'restaurant',
    'hébergement',
    'auberge',
    'café',
    'bar',
    'traiteur',
    'tourisme',
  ],
  'Services financiers': [
    'banque',
    'finance',
    'assurance',
    'crédit',
    'microfinance',
    'investissement',
    'capital',
    'épargne',
  ],
  'Énergie et mines': ['énergie', 'mines', 'pétrole', 'gaz', 'électricité', 'solaire', 'hydraulique', 'extracti'],
  'Industrie et manufacturing': [
    'industrie',
    'manufactur',
    'usine',
    'production',
    'fabrication',
    'emballage',
    'imprimerie',
    'métallurgie',
  ],
  'Médias et communication': [
    'média',
    'communication',
    'presse',
    'radio',
    'télévision',
    'publicité',
    'événementiel',
    'relations',
  ],
  'Conseil et services B2B': [
    'conseil',
    'consulting',
    'audit',
    'expertise',
    'comptabilité',
    'juridique',
    'ressources humaines',
    'nettoyage',
    'sécurité',
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
 * Inscription utilisateur
 */
app.post('/auth/sign-up', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const user = await createUser(email, password, { name });
    res.json({ uid: user.uid, email: user.email, message: 'User created successfully' });
  } catch (error) {
    console.error('Sign-up error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /auth/sign-in
 * Authentification (retourne un formulaire de login côté client)
 */
app.post('/auth/sign-in', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email required' });
    }

    // Vérifier que l'utilisateur existe
    const user = await auth.getUserByEmail(email).catch(() => null);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      message: 'Use Firebase client SDK for sign-in with password',
      email,
      uid: user.uid,
    });
  } catch (error) {
    console.error('Sign-in error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /auth/user
 * Récupérer profil utilisateur
 */
app.get('/auth/user', verifyToken, async (req, res) => {
  try {
    const user = await getUser(req.userId);
    res.json(user);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── COMPANY ROUTES ──────────────────────────────────────────────

/**
 * GET /api/companies/search
 * Rechercher des entreprises
 */
app.get('/api/companies/search', verifyToken, async (req, res) => {
  try {
    const { sector, region, city, limit } = req.query;

    // Log usage
    await logUsage(req.userId, `search:${sector || 'all'}`, 1);

    const companies = await searchCompanies({
      sector: sector || null,
      region: region || null,
      city: city || null,
      limit: parseInt(limit) || 50,
      active: true,
    });

    res.json({
      count: companies.length,
      data: companies,
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/companies/import
 * Importer entreprises depuis Excel (admin only)
 */
app.post('/api/companies/import', verifyAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Lire le fichier Excel
    const workbook = XLSX.readFile(req.file.path);
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(worksheet);

    // Transformer les données
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

    // Importer en batch
    const result = await importCompaniesBatch(companies);

    // Nettoyer le fichier
    fs.unlinkSync(req.file.path);

    res.json({
      message: 'Import successful',
      imported: result.importedCount,
      skipped: result.skippedCount,
    });
  } catch (error) {
    console.error('Import error:', error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: error.message });
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
    if (!key) {
      return res.status(400).json({ error: 'Config key required' });
    }

    await setConfig(key, value);
    res.json({ message: `Config ${key} saved` });
  } catch (error) {
    console.error('Config error:', error);
    res.status(500).json({ error: error.message });
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
    console.error('Config retrieval error:', error);
    res.status(500).json({ error: error.message });
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
    console.error('Plan update error:', error);
    res.status(500).json({ error: error.message });
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

// ── PUBLIC Firebase Config (for client initialization) ──────────
app.get('/api/config/firebase', (req, res) => {
  try {
    res.json({
      apiKey: 'AIzaSyCVJxyeysHWDQ7yECTb-GApJz7u8s5l7N0',
      authDomain: 'sales-companion-9cf56.firebaseapp.com',
      projectId: 'sales-companion-9cf56',
      storageBucket: 'sales-companion-9cf56.firebasestorage.app',
      messagingSenderId: '385537597968',
      appId: '1:385537597968:web:8c7e0f4e1d6c3b9a2e5f7c1d',
    });
  } catch (error) {
    console.error('Firebase config error:', error);
    res.status(500).json({ error: 'Failed to retrieve Firebase config' });
  }
});

app.get('/mobile', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'mobile', 'index.html'));
});

// ── ENDPOINT ALIASES (Client Compatibility) ─────────────────────
// Aliases pour compatibilité avec les appels du client Electron

// POST /auth/register - Create user account
app.post('/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    
    // Create user via Firebase Auth
    const firebaseUser = await auth.createUser({
      email,
      password,
      displayName: name || email.split('@')[0],
    });
    
    // Create user document in Firestore
    const user = await createUser(email, password, { 
      name: name || email.split('@')[0],
      uid: firebaseUser.uid
    });
    
    // Get ID token via Firebase REST API
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
      return res.status(400).json({ error: 'Failed to generate token' });
    }
    
    res.status(201).json({
      token: firebaseData.idToken,
      user: {
        uid: firebaseUser.uid,
        email: user.email,
        name: user.name,
        plan: 'free',
        daily_limit: 10,
        daily_used: 0,
        remaining: 10,
      },
      message: 'User created successfully'
    });
  } catch (error) {
    console.error('Register error:', error);
    const msg = error.message || 'Registration failed';
    res.status(400).json({ error: msg });
  }
});

// POST /auth/login - Sign in user via Firebase REST API
app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    // Verification via Firebase REST API
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
    console.error('Login error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Alias: GET /auth/me → /auth/user
app.get('/auth/me', verifyToken, async (req, res) => {
  try {
    const user = await getUser(req.userId);
    res.json(user);
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── START SERVER ────────────────────────────────────────────────

app.listen(PORT, "0.0.0.0", () => {
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





