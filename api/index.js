/**
 * Vercel Serverless Function - Sales Companion API
 * This exports the Express app for Vercel deployment
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const XLSX = require('xlsx');
const fs = require('fs');
const os = require('os');
require('dotenv').config();

// Firebase
const { auth } = require('../server/firebase-config');
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
} = require('../server/firestore-operations');

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
    const { query } = req.query;
    if (!query) {
      return res.status(400).json({ error: 'Missing query parameter' });
    }
    const companies = await searchCompanies(query);
    res.json({ companies });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Config Routes
app.get('/api/config', verifyToken, async (req, res) => {
  try {
    const config = await getConfig(req.user.uid);
    res.json(config || {});
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
    await setConfig(req.user.uid, key, value);
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
    await logUsage(req.user.uid, action, details);
    res.json({ success: true });
  } catch (error) {
    console.error('Usage log error:', error);
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
