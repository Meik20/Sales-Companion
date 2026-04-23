/**
 * Vercel Serverless Function - Sales Companion API
 * This exports the Express app for Vercel deployment
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fetch = require('node-fetch');
const XLSX = require('xlsx');
const fs = require('fs');
const os = require('os');
require('dotenv').config();

// Firebase
const { auth, db } = require('../server/firebase-config');
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
  checkCompanyInPipeline,
  getConfig,
  setConfig,
  logUsage,
  consumeCredit,
  createSupportMessage,
  getSupportMessages,
  getSupportMessagesForUser,
  replyToSupportMessage,
  closeSupportMessage,
} = require('../server/firestore-operations');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';

function formatCompanyForPrompt(company) {
  const fields = [];
  if (company.raisonSociale || company.raison_sociale) fields.push(`Nom : ${company.raisonSociale || company.raison_sociale}`);
  if (company.sigle) fields.push(`Sigle : ${company.sigle}`);
  if (company.sector || company.secteur) fields.push(`Secteur : ${company.sector || company.secteur}`);
  if (company.activitePrincipale || company.activite_principale) fields.push(`Activité : ${company.activitePrincipale || company.activite_principale}`);
  if (company.region) fields.push(`Région : ${company.region}`);
  if (company.city || company.ville) fields.push(`Ville : ${company.city || company.ville}`);
  if (company.email || company.company_email || company.contact_email) fields.push(`Email : ${company.email || company.company_email || company.contact_email}`);
  if (company.telephone || company.tel || company.company_phone || company.contact_phone) fields.push(`Téléphone : ${company.telephone || company.tel || company.company_phone || company.contact_phone}`);
  if (company.adresse || company.company_address) fields.push(`Adresse : ${company.adresse || company.company_address}`);
  if (company.dirigeant) fields.push(`Dirigeant : ${company.dirigeant}`);
  if (company.employees || company.employee_count || company.effectif || company.nb_employes) fields.push(`Effectif estimé : ${company.employees || company.employee_count || company.effectif || company.nb_employes}`);
  if (company.site_web || company.website) fields.push(`Site web : ${company.site_web || company.website}`);
  return fields.join('\n');
}

async function callOpenAI(messages) {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY n\'est pas configurée.');
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages,
      max_tokens: 450,
      temperature: 0.85,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    const message = data?.error?.message || data?.error || 'Erreur lors de l\'appel OpenAI';
    throw new Error(message);
  }
  return data?.choices?.[0]?.message?.content?.trim() || '';
}

async function generatePitch(company) {
  const prompt = `Tu es un assistant commercial pour un CRM B2B basé au Cameroun. Génère un message de prospection ultra-personnalisé en utilisant les informations ci-dessous. Ne fais pas de promesses factices, reste direct, professionnel et orienté gain client.`;
  const companyDescription = formatCompanyForPrompt(company);

  const messages = [
    { role: 'system', content: 'Tu aides un commercial à rédiger des emails et des scripts d\'appel pour des entreprises camerounaises.' },
    { role: 'user', content: `${prompt}\n\nInformations sur l\'entreprise :\n${companyDescription}` },
  ];

  return await callOpenAI(messages);
}

async function generateSearchSummary(query, filters, companies) {
  if (!OPENAI_API_KEY) return null;
  const messages = [
    { role: 'system', content: 'Tu es un assistant capable de résumer des intentions de recherche commerciale en français.' },
    { role: 'user', content: `Résume en une phrase la recherche suivante et indique si elle concerne la logistique, la taille, la localisation ou autre. Recherche : "${query}". Filtres : ${JSON.stringify(filters)}. Résultats trouvés : ${companies.length} entreprises.` },
  ];
  return await callOpenAI(messages);
}

// ── SERVER SETUP ──────────────────────────────────────────────
const app = express();
const UPLOAD_DIR = path.join('/tmp', 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'server', 'admin')));
app.use('/mobile', express.static(path.join(__dirname, '..', 'mobile')));

// Content Security Policy header (applied at server level)
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "connect-src 'self' https://*.firebaseapp.com https://*.googleapis.com https://*.google.com https://identitytoolkit.googleapis.com https://www.gstatic.com https://fonts.gstatic.com https://fonts.googleapis.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "script-src 'self' 'unsafe-inline' https://*.googleapis.com https://*.firebaseapp.com",
      "frame-src https://*.firebaseapp.com https://maps.google.com https://www.google.com",
      "img-src 'self' data: https://*.googleapis.com https://*.gstatic.com"
    ].join('; ')
  );
  next();
});

// ── ROUTES DE BASE ──────────────────────────────────────────────

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Public Firebase Config (safe to expose - public credentials only)
app.get('/api/config/firebase', (req, res) => {
  try {
    // Load from environment variables (set in Vercel or .env)
    const firebaseConfig = {
      apiKey: process.env.FIREBASE_PUBLIC_API_KEY || '',
      authDomain: process.env.FIREBASE_AUTH_DOMAIN || `${process.env.FIREBASE_PROJECT_ID}.firebaseapp.com`,
      projectId: process.env.FIREBASE_PROJECT_ID || '',
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${process.env.FIREBASE_PROJECT_ID}.firebasestorage.app`,
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
      appId: process.env.FIREBASE_APP_ID || ''
    };
    
    // Validate that we have at least projectId and apiKey
    if (!firebaseConfig.projectId || !firebaseConfig.apiKey) {
      console.warn('⚠️ Firebase config incomplete - check environment variables');
      return res.status(503).json({ 
        error: 'Firebase configuration not available',
        message: 'Please configure Firebase environment variables'
      });
    }
    
    res.json(firebaseConfig);
  } catch (error) {
    console.error('Firebase config error:', error);
    res.status(500).json({ error: 'Failed to retrieve Firebase config' });
  }
});

// Auth Routes
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const user = await createUser({ email, password, name });
    res.json({ user });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) {
      return res.status(400).json({ error: 'Missing idToken' });
    }
    const decodedToken = await auth.verifyIdToken(idToken);
    res.json({ uid: decodedToken.uid, email: decodedToken.email });
  } catch (error) {
    console.error('Login error:', error);
    res.status(401).json({ error: 'Unauthorized' });
  }
});

app.get('/auth/me', verifyToken, async (req, res) => {
  try {
    const user = await getUser(req.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Calculer remaining = dailyLimit - dailyUsed
    const today = new Date().toISOString().split('T')[0];
    const lastReset = user.lastReset ? user.lastReset.split('T')[0] : null;
    
    // Réinitialiser si c'est un nouveau jour
    if (lastReset !== today) {
      user.dailyUsed = 0;
      await db.collection('users').doc(req.userId).update({
        dailyUsed: 0,
        lastReset: new Date().toISOString(),
      });
    }
    
    user.remaining = (user.dailyLimit || 10) - (user.dailyUsed || 0);
    res.json(user);
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Admin Routes
app.post('/api/admin/import-companies', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const upload = multer({ dest: UPLOAD_DIR }).single('file');
    upload(req, res, async (err) => {
      if (err) {
        return res.status(400).json({ error: err.message });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }
      const workbook = XLSX.readFile(req.file.path);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const companies = XLSX.utils.sheet_to_json(sheet);
      await importCompaniesBatch(companies);
      fs.unlinkSync(req.file.path);
      res.json({ success: true, count: companies.length });
    });
  } catch (error) {
    console.error('Import error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Search Route
app.get('/api/companies/search', verifyToken, async (req, res) => {
  try {
    const { query, sector, region, city, limit } = req.query;
    const companies = await searchCompanies({
      query,
      sector,
      region,
      city,
      limit: limit || 50,
      active: true,
    });
    res.json({ companies });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/search', verifyToken, async (req, res) => {
  try {
    const { query, filters = {}, use_ai = false } = req.body;
    console.log(`[SEARCH] User ${req.userId} searching: "${query}" with filters:`, filters, 'use_ai:', use_ai);

    // Consommer 1 crédit pour la recherche
    const creditResult = await consumeCredit(req.userId);
    console.log(`[SEARCH] Credit consumption result for user ${req.userId}:`, creditResult);

    if (!creditResult.ok) {
      console.log(`[SEARCH] Credit limit reached for user ${req.userId}: ${creditResult.message}`);
      return res.status(429).json({
        error: creditResult.message || 'Limite quotidienne atteinte',
        upgrade: true,
        remaining: creditResult.remaining || 0
      });
    }

    console.log(`[SEARCH] Credit consumed successfully for user ${req.userId}, remaining: ${creditResult.remaining}`);

    const companies = await searchCompanies({
      query,
      sector: filters.secteur || filters.sector,
      region: filters.region,
      city: filters.ville || filters.city,
      limit: filters.limit || 50,
      active: true,
    });

    console.log(`[SEARCH] Found ${companies.length} companies for user ${req.userId}`);

    let ai_text = null;
    if (use_ai && query) {
      try {
        ai_text = await generateSearchSummary(query, filters, companies);
      } catch (err) {
        console.warn('[SEARCH] AI summary failed:', err.message);
      }
    }

    res.json({
      count: companies.length,
      source: 'database',
      results: companies,
      ai_text,
      remaining: creditResult.remaining
    });
  } catch (error) {
    console.error('[SEARCH] Error for user', req.userId, ':', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/pitch', verifyToken, async (req, res) => {
  try {
    const { companyId, company } = req.body;
    let companyData = company;

    if (!companyData && companyId) {
      const companyDoc = await db.collection('companies').doc(companyId).get();
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
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/chat', verifyToken, async (req, res) => {
  try {
    const { messages } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages are required' });
    }

    console.log(`[CHAT] User ${req.userId} sending ${messages.length} messages`);

    // Vérifier et consommer 1 crédit
    const creditResult = await consumeCredit(req.userId);
    console.log(`[CHAT] Credit consumption result for user ${req.userId}:`, creditResult);

    if (!creditResult.ok) {
      console.log(`[CHAT] Credit limit reached for user ${req.userId}: ${creditResult.message}`);
      return res.status(429).json({
        error: creditResult.message || 'Limite quotidienne atteinte',
        upgrade: true,
        remaining: creditResult.remaining || 0
      });
    }

    console.log(`[CHAT] Credit consumed successfully for user ${req.userId}, remaining: ${creditResult.remaining}`);

    // Réponse IA (à configurer avec Groq)
    res.json({
      choices: [
        {
          message: {
            content: "Je suis l'assistant IA de Sales Companion. Pour le moment, je suis en cours de configuration. Veuillez réessayer plus tard ou contactez le support.",
            role: "assistant"
          }
        }
      ],
      remaining: creditResult.remaining
    });
  } catch (error) {
    console.error('[CHAT] Error for user', req.userId, ':', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/saved-searches', verifyToken, async (req, res) => {
  try {
    const saved = await addSavedSearch(req.userId, req.body);
    res.json({ success: true, data: saved });
  } catch (error) {
    console.error('Saved search error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/saved-searches', verifyToken, async (req, res) => {
  try {
    const searches = await getSavedSearches(req.userId);
    res.json({ data: searches });
  } catch (error) {
    console.error('Saved search error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/saved-searches/:id', verifyToken, async (req, res) => {
  try {
    await deleteSavedSearch(req.userId, req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Saved search delete error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/pipeline', verifyToken, async (req, res) => {
  try {
    const pipeline = await getUserPipeline(req.userId);
    res.json(pipeline);
  } catch (error) {
    console.error('Pipeline error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/pipeline/check', verifyToken, async (req, res) => {
  try {
    const { companyId, companyName } = req.query;
    const result = await checkCompanyInPipeline(req.userId, companyId, companyName);
    res.json({ data: result });
  } catch (error) {
    console.error('Pipeline check error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/pipeline', verifyToken, async (req, res) => {
  try {
    const prospect = await addPipelineProspect(req.userId, req.body);
    res.json({ data: prospect });
  } catch (error) {
    if (error.message.includes('already exists')) {
      return res.status(409).json({ error: 'Prospect déjà présent dans le pipeline' });
    }
    console.error('Pipeline error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/pipeline/:id', verifyToken, async (req, res) => {
  try {
    const prospect = await updatePipelineProspect(req.userId, req.params.id, req.body);
    res.json({ data: prospect });
  } catch (error) {
    console.error('Pipeline update error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/pipeline/:id', verifyToken, async (req, res) => {
  try {
    await deletePipelineProspect(req.userId, req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Pipeline delete error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Config Routes
app.get('/api/config', verifyToken, async (req, res) => {
  try {
    const key = req.query.key;
    if (!key) {
      return res.status(400).json({ error: 'Missing key parameter' });
    }
    const config = await getConfig(key);
    res.json({ key, value: config });
  } catch (error) {
    console.error('Config fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/config', verifyToken, async (req, res) => {
  try {
    const { key, value } = req.body;
    if (!key) {
      return res.status(400).json({ error: 'Missing key' });
    }
    await setConfig(key, value);
    res.json({ success: true });
  } catch (error) {
    console.error('Config save error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Usage Logging
app.post('/api/usage/log', verifyToken, async (req, res) => {
  try {
    const { action, details } = req.body;
    await logUsage(req.userId, action, details);
    res.json({ success: true });
  } catch (error) {
    console.error('Usage log error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── SUPPORT MESSAGING ─────────────────────────────────────────

app.post('/api/support/messages', verifyToken, async (req, res) => {
  try {
    const { subject, message } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }
    const result = await createSupportMessage(req.userId, { subject, message });
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Support message error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/support/messages', verifyAdmin, async (req, res) => {
  try {
    const messages = await getSupportMessages(100);
    res.json({ data: messages });
  } catch (error) {
    console.error('Get support messages error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/support/messages/user', verifyToken, async (req, res) => {
  try {
    const messages = await getSupportMessagesForUser(req.userId);
    res.json({ data: messages });
  } catch (error) {
    console.error('Get user support messages error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/support/messages/:id', verifyAdmin, async (req, res) => {
  try {
    const { reply } = req.body;
    if (!reply || !reply.trim()) {
      return res.status(400).json({ error: 'Reply is required' });
    }
    await replyToSupportMessage(req.params.id, reply, req.userEmail);
    res.json({ success: true });
  } catch (error) {
    console.error('Reply support message error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/support/messages/:id/close', verifyAdmin, async (req, res) => {
  try {
    await closeSupportMessage(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Close support message error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// Error Handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

module.exports = app;
