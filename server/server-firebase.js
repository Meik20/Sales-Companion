/**
 * Sales Companion Server — Firebase Edition
 * Migration complète vers Firebase Admin SDK + Firestore
 * v2.1: Optimisations performance, caching, rate limiting
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const multer = require('multer');
const XLSX = require('xlsx');
const fs = require('fs');
const os = require('os');
const fetch = require('node-fetch');
require('dotenv').config();

// Performance & Security
const cache = require('./cache-service');
const { rateLimit } = require('./rate-limit');
const { perfMonitor } = require('./perf-monitor');

// Firebase
const { auth, admin } = require('./firebase-config');
const {
  verifyToken,
  verifyAdmin,
  createUser,
  getUser,
  updateUserPlan,
  updateUserRole,
  getTeamMembers,
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
  addAssignments,
  getAssignmentsForUser,
  getAssignmentsCreatedBy,
  updateAssignment,
  // Team accesses
  createTeamAccess,
  getTeamAccesses,
  revokeTeamAccess,
  activateTeamAccess,
  findTeamAccess,
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
          "https://apis.google.com",
          "https://cdn.jsdelivr.net"
        ],

        scriptSrcElem: [
          "'self'",
          "'unsafe-inline'",
          "https://www.gstatic.com",
          "https://apis.google.com",
          "https://cdn.jsdelivr.net"
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
          "https://www.gstatic.com",
          "https://cdn.jsdelivr.net"
        ],

        frameSrc: ["https://*.firebaseapp.com"],
      },
    },
  })
);

// ── PERFORMANCE ──────────────────────────────────────────────
app.use(compression()); // Gzip compression automatique
app.use(rateLimit(100, 60)); // 100 req/min par IP

console.log('✅ Compression gzip activée');
console.log('✅ Rate limiting activé (100 req/min)');
// (debug endpoint removed)


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
const expressRateLimit = require('express-rate-limit');
const authLimiter = expressRateLimit({
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

// ── AI HELPERS (callOpenAI, formatCompanyForPrompt, generatePitch) ──
async function callOpenAI(prompt, options = {}) {
  const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY;
  const model = options.model || process.env.OPENAI_MODEL || 'gpt-3.5-turbo';
  if (!apiKey) {
    console.warn('[callOpenAI] OPENAI_API_KEY not set — returning placeholder.');
    return null;
  }
  try {
    const body = {
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: options.max_tokens || 500,
      temperature: typeof options.temperature === 'number' ? options.temperature : 0.7,
    };
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || JSON.stringify(data));
    const text = data.choices?.[0]?.message?.content || data.choices?.[0]?.text || '';
    return text.trim();
  } catch (e) {
    console.error('[callOpenAI] Error:', e.message || e);
    return null;
  }
}

function formatCompanyForPrompt(company) {
  if (!company) return '';
  const parts = [];
  if (company.raison_sociale || company.company_name || company.name) parts.push('Nom: ' + (company.raison_sociale || company.company_name || company.name));
  if (company.secteur || company.activite_principale) parts.push('Secteur: ' + (company.secteur || company.activite_principale));
  const loc = [company.ville, company.region, company.adresse].filter(Boolean).join(', ');
  if (loc) parts.push('Localisation: ' + loc);
  if (company.telephone || company.tel) parts.push('Téléphone: ' + (company.telephone || company.tel));
  if (company.email || company.contact_email) parts.push('Email: ' + (company.email || company.contact_email));
  if (company.effectif || company.size) parts.push('Taille: ' + (company.effectif || company.size));
  if (company.description) parts.push('Description: ' + company.description);
  return parts.join('\n');
}

async function generatePitch(company) {
  const formatted = formatCompanyForPrompt(company);
  const prompt = `Génère une accroche commerciale courte (1 phrase) puis un pitch de prospection (2-4 phrases) adapté à cette entreprise. Donne aussi 2 suggestions d'objet d'email. Répond en français.\n\nEntreprise:\n${formatted}`;
  const ai = await callOpenAI(prompt, { max_tokens: 400, temperature: 0.6 });
  if (!ai) return 'Assistant IA non disponible.';
  return ai;
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
  const { email, password, name, role, company_id } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  let firebaseUser = null;
  try {
    firebaseUser = await createUser(email, password, { name, role: role || 'independent', company_id: company_id || null });
    const firebaseRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${process.env.FIREBASE_API_KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) }
    );
    const firebaseData = await firebaseRes.json();
    if (firebaseData.error) return res.status(400).json({ error: 'Échec de la génération du token' });
    res.status(201).json({
      token: firebaseData.idToken,
      user: { uid: firebaseUser.uid, email, name: name || email.split('@')[0], role: role || 'independent', plan: 'free', daily_limit: 10, daily_used: 0, remaining: 10 },
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
        role: user?.role || 'independent',
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
        role:        'independent',
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
      role:       'independent',
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

    // 1️⃣  Find user by email in Firebase Auth
    let userRecord;
    try {
      userRecord = await auth.getUserByEmail(identifier);
    } catch (err) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }

    // 2️⃣ Verify admin status
    const isAdmin = userRecord.customClaims?.admin === true;
    if (!isAdmin) return res.status(403).json({ error: 'Accès refusé — admin uniquement' });

    // 3️⃣ Create custom token for admin session
    try {
      console.log(`[Auth] Admin login attempt for ${identifier} (${userRecord.uid})`);
      
      const customToken = await auth.createCustomToken(userRecord.uid, { admin: true });
      
      // Return token immediately — Firestore profile load is non-critical
      res.json({
        token: customToken,
        user: { 
          uid: userRecord.uid, 
          email: userRecord.email,
          name: userRecord.displayName || identifier.split('@')[0], 
          role: 'admin',
        },
      });
      
      // Log admin login in background (fire-and-forget)
      logUsage(userRecord.uid, 'admin_login').catch(err => {
        console.warn('[Admin Login] Could not log usage:', err.message);
      });
    } catch (authErr) {
      console.error('[Admin Login] auth error:', authErr.message);
      return res.status(401).json({ error: 'Authentification échouée' });
    }
  } catch (error) {
    console.error('Admin login error:', error.message);
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
  // ✅ CHECK CACHE FIRST (5 minutes TTL)
  const cacheKey = 'admin:stats';
  const cached = cache.get(cacheKey);
  if (cached) {
    return res.json({ ...cached, _cached: true, _cacheTime: new Date().toISOString() });
  }

  const { getFirestore } = require('firebase-admin/firestore');
  const adminDb = getFirestore();
  const startTime = Date.now();

  const safeCount = async (query) => {
    try { return (await query.get()).size; } catch(err) { 
      if (err.code === 8) throw err; // Re-throw RESOURCE_EXHAUSTED
      return 0;
    }
  };
  const safeDocs = async (query) => {
    try { return (await query.get()).docs.map(d => d.data()); } catch(err) {
      if (err.code === 8) throw err; // Re-throw RESOURCE_EXHAUSTED
      return [];
    }
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

    const statsData = {
      totalUsers, totalCompanies, activeToday, totalSearches,
      planCounts:         Object.entries(planMap).map(([plan, c]) => ({ plan, c })),
      companiesByRegion:  Object.entries(regionMap).sort((a,b) => b[1]-a[1]).slice(0,8).map(([region, c]) => ({ region, c })),
      companiesBySecteur: Object.entries(secteurMap).sort((a,b) => b[1]-a[1]).slice(0,8).map(([secteur, c]) => ({ secteur, c })),
      recentLogs,
    };

    // ✅ STORE IN CACHE (5 min TTL)
    cache.set(cacheKey, statsData, 300);
    
    const duration = Date.now() - startTime;
    perfMonitor.record('admin:stats', duration, true);
    if (duration > 500) console.warn(`⚠️ /admin/stats took ${duration}ms`);

    res.json(statsData);
  } catch (error) {
    // 🚨 RESOURCE_EXHAUSTED: return demo data for development
    if (error.code === 8) {
      console.warn('⚠️ Firestore quota exceeded — returning cached or demo stats');
      const demoStats = {
        totalUsers: 0,
        totalCompanies: 0,
        activeToday: 0,
        totalSearches: 0,
        planCounts: [
          {plan: 'free', c: 5},
          {plan: 'starter', c: 2},
          {plan: 'pro', c: 1},
          {plan: 'enterprise', c: 1}
        ],
        companiesByRegion: [
          {region: 'Littoral', c: 45},
          {region: 'Centre', c: 32},
          {region: 'Ouest', c: 28},
          {region: 'Nord', c: 15}
        ],
        companiesBySecteur: [
          {secteur: 'Commerce et distribution', c: 35},
          {secteur: 'BTP et construction', c: 28},
          {secteur: 'Technologies', c: 22},
          {secteur: 'Transport', c: 15}
        ],
        recentLogs: [],
        _demo: true,
        _message: '📊 Dashboard en mode démo (quota Firestore dépassé) — Connectez-vous avec de vraies données',
      };
      cache.set(cacheKey, demoStats, 60); // Cache for 1 min
      perfMonitor.record('admin:stats', Date.now() - startTime, false);
      return res.json(demoStats);
    }

    perfMonitor.record('admin:stats', Date.now() - startTime, false);
    return safeError(res, 500, 'Erreur stats', error);
  }
});

// ✅ NEW: Endpoint to check Firestore connection status
app.get('/api/firestore-check', async (req, res) => {
  const { getFirestore } = require('firebase-admin/firestore');
  const adminDb = getFirestore();
  const startTime = Date.now();
  
  try {
    // Test simple read
    await adminDb.collection('_test').limit(1).get();
    const duration = Date.now() - startTime;
    console.log(`✅ Firestore check: OK (${duration}ms)`);
    return res.json({
      connected: true,
      status: 'OK',
      duration: duration,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    
    if (error.code === 8) {
      // Quota exceeded but connection works
      console.warn(`⚠️ Firestore quota exceeded (${duration}ms)`);
      return res.json({
        connected: true,
        status: 'QUOTA_EXCEEDED',
        code: 8,
        duration: duration,
        message: 'Connexion OK mais quota Firestore dépassé',
        timestamp: new Date().toISOString(),
      });
    }
    
    console.error(`❌ Firestore error (${duration}ms):`, error.message);
    return res.json({
      connected: false,
      status: 'ERROR',
      code: error.code,
      message: error.message,
      duration: duration,
      timestamp: new Date().toISOString(),
    });
  }
});

// ✅ NEW: Endpoint to check Groq API
app.get('/api/check-groq', async (req, res) => {
  const groqKey = process.env.GROQ_API_KEY || null;
  
  if (!groqKey) {
    return res.json({
      active: false,
      configured: false,
      message: 'Clé API Groq non configurée',
    });
  }
  
  try {
    const response = await fetch('https://api.groq.com/openai/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${groqKey}`,
      },
      timeout: 5000,
    });
    
    if (response.ok) {
      console.log('✅ Groq API: OK');
      return res.json({
        active: true,
        configured: true,
        status: response.status,
        message: 'API Groq active',
      });
    } else {
      console.warn(`⚠️ Groq API error: ${response.status}`);
      return res.json({
        active: false,
        configured: true,
        status: response.status,
        message: 'Clé API invalide ou API indisponible',
      });
    }
  } catch (error) {
    console.error('❌ Groq check error:', error.message);
    return res.json({
      active: false,
      configured: true,
      error: error.message,
      message: 'Erreur lors de la vérification de l\'API Groq',
    });
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
    
    // ✅ INVALIDATE CACHE after import so dashboard updates immediately
    cache.delete('admin:stats');
    
    // Enregistrer un journal d'import pour l'historique admin
    try {
      const { getFirestore } = require('firebase-admin/firestore');
      const adminDb = getFirestore();
      await adminDb.collection('import_logs').add({
        filename: req.file.originalname || 'upload',
        total: data.length,
        imported: result.importedCount  || 0,
        updated:  result.updatedCount   || 0,
        skipped:  result.skippedCount   || 0,
        errors:   result.errorCount     || 0,
        createdAt: new Date().toISOString(),
        sourceFile: req.file.originalname || '',
      });
    } catch (e) { console.warn('[IMPORT] Failed to write import log:', e.message); }

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
    const docs = snap.docs;
    const BATCH_SIZE = 400; // batch safe size
    let deleted = 0;
    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
      const batch = adminDb.batch();
      const chunk = docs.slice(i, i + BATCH_SIZE);
      chunk.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
      deleted += chunk.length;
    }
    // ✅ INVALIDATE CACHE after deletion
    cache.delete('admin:stats');
    res.json({ success: true, deleted });
  } catch (error) {
    return safeError(res, 500, 'Erreur suppression totale', error);
  }
});

app.delete('/admin/companies/:id', verifyAdmin, async (req, res) => {
  try {
    const { getFirestore } = require('firebase-admin/firestore');
    await getFirestore().collection('companies').doc(req.params.id).delete();
    // ✅ INVALIDATE CACHE after deletion
    cache.delete('admin:stats');
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
    // ✅ INVALIDATE CACHE after update
    cache.delete('admin:stats');
    res.json({ message: `User plan updated to ${plan}` });
  } catch (error) {
    return safeError(res, 500, 'Erreur de mise à jour du plan', error);
  }
});

app.post('/admin/users/:uid/role', verifyAdmin, async (req, res) => {
  try {
    const { role } = req.body;
    if (!role) return res.status(400).json({ error: 'Role required' });
    const validRoles = ['user', 'manager', 'admin', 'independent'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
    }
    await updateUserRole(req.params.uid, role);
    // ✅ INVALIDATE CACHE after update
    cache.delete('admin:stats');
    res.json({ message: `User role updated to ${role}` });
  } catch (error) {
    return safeError(res, 500, 'Erreur de mise à jour du rôle', error);
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
    // ✅ INVALIDATE CACHE after update
    cache.delete('admin:stats');
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
    // ✅ INVALIDATE CACHE after deletion
    cache.delete('admin:stats');
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

// ══════════════════════════════════════════════════════════════
// SIMPLE IN-MEMORY CACHE (1 min TTL)
// Reduces duplicate API calls for same search params
// ══════════════════════════════════════════════════════════════

const searchCache = new Map();
const CACHE_TTL = 60000; // 1 minute in ms

function getCacheKey(query, filters) {
  return JSON.stringify({ query, filters });
}

function getCachedResult(query, filters) {
  const key = getCacheKey(query, filters);
  const cached = searchCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  searchCache.delete(key);
  return null;
}

function setCachedResult(query, filters, data) {
  const key = getCacheKey(query, filters);
  searchCache.set(key, { data, timestamp: Date.now() });
  
  // Prevent memory leak: keep only 100 most recent searches
  if (searchCache.size > 100) {
    const firstKey = searchCache.keys().next().value;
    searchCache.delete(firstKey);
  }
}

// ══════════════════════════════════════════════════════════════
// UNIFIED SEARCH API
// ── Backend handles ALL logic: filters, geolocation, AI scoring ──
// Params:
//   - query (string): free text search
//   - filters: { 
//       sector/secteur (string), 
//       region (string), 
//       city/ville (string),
//       around_me: { lat, lon, radius_km },
//       limit (int, max 200)
//     }
//   - use_ai (bool): generate AI summary
// ══════════════════════════════════════════════════════════════

app.post('/api/search', verifyToken, async (req, res) => {
  try {
    const { query, filters = {}, use_ai } = req.body;
    
    // Check cache first (but not for around_me, as location changes)
    if (!filters.around_me) {
      const cached = getCachedResult(query, filters);
      if (cached) {
        console.log('[CACHE HIT]', { query: query?.slice(0,20), filters });
        return res.json(cached);
      }
    }
    
    const searchParams = {
      query,
      sector: filters.secteur || filters.sector || null,
      region: filters.region || null,
      city: filters.ville || filters.city || null,
      limit: filters.limit || 50,
      active: true,
    };

    // Pass through around_me if provided (expects { lat, lon, radius })
    if (filters.around_me) searchParams.around_me = filters.around_me;

    const companies = await searchCompanies(searchParams);

    let ai_text = null;
    if (use_ai) {
      try {
        // Lightweight summary: count, top sectors, avg score
        const count = companies.length;
        const sectorCount = {};
        let scoreSum = 0, scored = 0;
        companies.forEach(c => {
          const s = c.sector || c.secteur || c.activite_principale || c.activitePrincipale || 'Autre';
          sectorCount[s] = (sectorCount[s] || 0) + 1;
          if (typeof c.leadScore === 'number') { scoreSum += c.leadScore; scored++; }
        });
        const topSectors = Object.entries(sectorCount).sort((a,b) => b[1]-a[1]).slice(0,3).map(e => `${e[0]} (${e[1]})`).join(', ') || 'Aucun secteur dominant';
        const avgScore = scored ? Math.round(scoreSum / scored) : 'N/A';
        ai_text = `Trouvé ${count} entreprise${count>1?'s':''} — secteurs principaux : ${topSectors} — score moyen : ${avgScore}.`;
      } catch (e) {
        console.warn('AI summary generation failed:', e.message || e);
        ai_text = null;
      }
    }

    const response = { count: companies.length, source: 'database', results: companies, ai_text };
    
    // Cache result for 1 minute (not for around_me)
    if (!filters.around_me) {
      setCachedResult(query, filters, response);
    }
    
    res.json(response);
  } catch (error) { return safeError(res, 500, 'Erreur lors de la recherche', error); }
});

app.post('/api/chat', verifyToken, async (req, res) => {
  try {
    const { messages } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) return res.status(400).json({ error: 'Messages are required' });
    return res.json({ choices: [{ message: { content: 'Assistant IA non configuré.' } }] });
  } catch (error) { return safeError(res, 500, 'Erreur du chat IA', error); }
});

// ── PITCH ROUTE (génération de pitch via AI) ──
app.post('/api/pitch', verifyToken, async (req, res) => {
  try {
    const { companyId, company } = req.body;
    let companyData = company;

    if (!companyData && companyId) {
      const { getFirestore } = require('firebase-admin/firestore');
      const adminDb = getFirestore();
      const companyDoc = await adminDb.collection('companies').doc(companyId).get();
      if (companyDoc.exists) {
        companyData = { id: companyDoc.id, ...companyDoc.data() };
      }
    }

    if (!companyData) {
      return res.status(400).json({ error: 'Aucune entreprise fournie pour générer une approche.' });
    }

    const pitch = await generatePitch(companyData);
    res.json({ pitch });

  } catch (error) {
    console.error('[PITCH] Error for user', req.userId, ':', error);
    return safeError(res, 500, 'Erreur lors de la génération du pitch', error);
  }
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
// ── ASSIGNMENTS API ─────────────────────────────────────────────
app.post('/api/assignments', verifyToken, async (req, res) => {
  try {
    const { assigneeId, prospectIds = [], note = '' } = req.body;
    if (!assigneeId || !Array.isArray(prospectIds) || prospectIds.length === 0) return res.status(400).json({ error: 'assigneeId and prospectIds are required' });

    // Resolve email -> uid if necessary
    let assigneeUid = assigneeId;
    try {
      if (String(assigneeId || '').includes('@')) {
        const userRec = await auth.getUserByEmail(assigneeId);
        assigneeUid = userRec.uid;
      }
    } catch (e) {
      return res.status(404).json({ error: 'Assignee not found' });
    }

    // Security: only allow creating assignments for members of the manager's team
    // Admins bypass this check
    const isAdmin = req.user && req.user.isAdmin === true;
    if (!isAdmin && assigneeUid !== req.userId) {
      try {
        const members = await getTeamMembers(req.userId, 2000);
        const allowed = Array.isArray(members) && members.some(m => m.uid === assigneeUid);
        if (!allowed) return res.status(403).json({ error: 'Assignee is not part of your team' });
      } catch (e) {
        return safeError(res, 500, 'Impossible de vérifier les membres de l\'équipe', e);
      }
    }

    const created = await addAssignments(req.userId, assigneeUid, prospectIds, note);
    res.json({ success: true, created });
  } catch (error) { return safeError(res, 500, 'Impossible de créer les assignations', error); }
});

app.get('/api/assignments', verifyToken, async (req, res) => {
  try {
    const assignments = await getAssignmentsForUser(req.userId, req.query.limit || 200);
    res.json({ data: assignments });
  } catch (error) { return safeError(res, 500, 'Impossible de charger les assignations', error); }
});

// GET team members for manager (returns users related to the requesting manager)
app.get('/api/team', verifyToken, async (req, res) => {
  try {
    const members = await getTeamMembers(req.userId, req.query.limit || 200);
    res.json({ data: members });
  } catch (error) { return safeError(res, 500, 'Impossible de charger les membres de l\'équipe', error); }
});

app.get('/api/assignments/manager', verifyToken, async (req, res) => {
  try {
    const assignments = await getAssignmentsCreatedBy(req.userId, req.query.limit || 200);
    res.json({ data: assignments });
  } catch (error) { return safeError(res, 500, 'Impossible de charger les assignations du manager', error); }
});

app.put('/api/assignments/:id', verifyToken, async (req, res) => {
  try {
    const updated = await updateAssignment(req.params.id, req.body);
    res.json({ data: updated });
  } catch (error) { return safeError(res, 500, 'Impossible de mettre à jour l\'assignation', error); }
});

// ══════════════════════════════════════════════════════════════
// TEAM ACCESS ROUTES
// ══════════════════════════════════════════════════════════════

// GET team accesses for manager
app.get('/api/team/accesses', verifyToken, async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'manager') {
      return res.status(403).json({ error: 'Only managers can access team accesses' });
    }
    const accesses = await getTeamAccesses(req.userId, req.query.limit || 100);
    res.json({ data: accesses });
  } catch (error) { return safeError(res, 500, 'Impossible de charger les accès', error); }
});

// CREATE team access
app.post('/api/team/accesses', verifyToken, async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'manager') {
      return res.status(403).json({ error: 'Only managers can create team accesses' });
    }
    const { member_name, access_id, company } = req.body;
    if (!member_name || !access_id || !company) {
      return res.status(400).json({ error: 'member_name, access_id, and company are required' });
    }
    const accessData = {
      access_id,
      member_name,
      company,
      status: 'pending',
      created_at: new Date().toISOString(),
    };
    const result = await createTeamAccess(req.userId, accessData);
    res.json({ data: result });
  } catch (error) { return safeError(res, 500, 'Impossible de créer l\'accès', error); }
});

// REVOKE team access
app.put('/api/team/accesses/:id', verifyToken, async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'manager') {
      return res.status(403).json({ error: 'Only managers can revoke accesses' });
    }
    const revoked = await revokeTeamAccess(req.params.id);
    res.json({ data: revoked });
  } catch (error) { return safeError(res, 500, 'Impossible de révoquer l\'accès', error); }
});

// ACTIVATE member access (public - no token required)
app.post('/api/auth/activate-member', authLimiter, async (req, res) => {
  try {
    const { access_id, new_password } = req.body;
    if (!access_id || !new_password) {
      return res.status(400).json({ error: 'access_id and new_password are required' });
    }
    const result = await activateTeamAccess(access_id, new_password);
    res.json({ data: result });
  } catch (error) { return safeError(res, 500, 'Impossible d\'activer l\'accès', error); }
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

// ─── POST /api/team/activate ─────────────────────────────────────────
// Crée un compte Firebase Auth pour un membre dont l'accès (team_accesses)
// a été créé par son manager.
// Body : { accessId, email, password, firstname, lastname, company, managerUid }
// ----------------------------------------------------------------------
app.post('/api/team/activate', async (req, res) => {
  try {
    const { accessId, email, password, firstname, lastname, company, managerUid } = req.body;

    if (!accessId || !email || !password) {
      return res.status(400).json({ error: 'accessId, email et password sont requis.' });
    }

    // 1. Vérifier l'accès dans Firestore
    const accessRef = admin.firestore().collection('team_accesses').doc(accessId);
    const accessSnap = await accessRef.get();

    if (!accessSnap.exists) {
      return res.status(404).json({ error: "Identifiant d'accès introuvable." });
    }
    const accessData = accessSnap.data();
    if (accessData.status === 'revoked')   return res.status(403).json({ error: 'Accès révoqué.' });
    if (accessData.activated === true)     return res.status(409).json({ error: 'Compte déjà activé.' });

    // 2. Vérifier disponibilité de l'email
    try {
      await admin.auth().getUserByEmail(email);
      return res.status(409).json({ error: 'Cette adresse email est déjà utilisée.' });
    } catch (e) {
      if (e.code !== 'auth/user-not-found') throw e;
    }

    // 3. Créer le compte Firebase Auth
    const displayName = [firstname, lastname].filter(Boolean).join(' ') || accessId;
    const userRecord  = await admin.auth().createUser({
      email, password, displayName, emailVerified: false, disabled: false
    });

    // 4. Créer le document users/{uid} pour l'identification du rôle après login
    await admin.firestore().collection('users').doc(userRecord.uid).set({
      uid:         userRecord.uid,
      email:       email,
      name:        displayName,
      role:        'member',
      accessId:    accessId,
      managerUid:  accessData.createdBy || managerUid || null,
      company:     company || accessData.company || '',
      plan:        'free',
      daily_limit: 50,
      daily_used:  0,
      last_reset:  new Date().toISOString(),
      active:      true,
      created_at:  new Date().toISOString(),
      updated_at:  new Date().toISOString()
    });

    // 5. Mettre à jour team_accesses en mode privilégié (Admin SDK)
    try {
      await accessRef.update({
        status: 'active',
        activated: true,
        firebaseUid: userRecord.uid,
        email: email,
        activatedAt: admin.firestore.FieldValue.serverTimestamp(),
        activatedBy: accessData.createdBy || managerUid || null
      });
    } catch (updateErr) {
      console.error('[POST /api/team/activate] Failed to update team_accesses, rolling back auth user', updateErr);
      // Rollback: supprimer l'utilisateur Auth créé pour éviter orphelins
      try { await admin.auth().deleteUser(userRecord.uid); } catch (dErr) { console.error('Failed to delete user after failed update', dErr); }
      return res.status(500).json({ error: 'Impossible de finaliser l\'activation (erreur écriture Firestore).' });
    }

    // 6. Retourner le firebaseUid au client
    return res.status(200).json({
      success:     true,
      firebaseUid: userRecord.uid,
      message:     'Compte créé et accès activé avec succès.'
    });

  } catch (error) {
    console.error('[POST /api/team/activate]', error);
    if (error.code === 'auth/email-already-exists')
      return res.status(409).json({ error: 'Email déjà utilisé.' });
    if (error.code === 'auth/weak-password')
      return res.status(400).json({ error: 'Mot de passe trop faible.' });
    return res.status(500).json({ error: error.message || 'Erreur serveur.' });
  }
});