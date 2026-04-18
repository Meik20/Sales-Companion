/**
 * Firestore Helper Functions
 * Gère les opérations spécifiques à Firestore
 */

const { db, auth } = require('./firebase-config');

// ── USER OPERATIONS ──────────────────────────────────────────────

/**
 * Créer un nouvel utilisateur Firebase
 */
async function createUser(email, password, userData = {}) {
  try {
    // 1. Créer utilisateur Firebase Auth
    const userRecord = await auth.createUser({
      email,
      password,
      displayName: userData.name || '',
    });

    // 2. Créer document utilisateur dans Firestore
    const userRef = db.collection('users').doc(userRecord.uid);
    await userRef.set({
      uid: userRecord.uid,
      email,
      name: userData.name || '',
      plan: userData.plan || 'free',
      dailyLimit: 10, // free plan
      dailyUsed: 0,
      lastReset: new Date().toISOString(),
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    return { uid: userRecord.uid, email };
  } catch (error) {
    console.error('Error creating user:', error);
    throw error;
  }
}

/**
 * Récupérer un utilisateur
 */
async function getUser(uid) {
  try {
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists) return null;
    return { uid: userDoc.id, ...userDoc.data() };
  } catch (error) {
    console.error('Error getting user:', error);
    throw error;
  }
}

/**
 * Mettre à jour plan utilisateur
 */
async function updateUserPlan(uid, newPlan) {
  const planLimits = {
    free: 10,
    starter: 200,
    pro: 500,
    enterprise: 9999,
  };

  try {
    await db.collection('users').doc(uid).update({
      plan: newPlan,
      dailyLimit: planLimits[newPlan] || 10,
      updatedAt: new Date().toISOString(),
    });
    return true;
  } catch (error) {
    console.error('Error updating user plan:', error);
    throw error;
  }
}

// ── ADMIN OPERATIONS ────────────────────────────────────────────

/**
 * Créer admin (doit être fait via Firebase Console)
 * Ou utiliser custom claims
 */
async function setAdminClaims(uid) {
  try {
    await auth.setCustomUserClaims(uid, { admin: true });
    return true;
  } catch (error) {
    console.error('Error setting admin claims:', error);
    throw error;
  }
}

// ── COMPANY OPERATIONS ──────────────────────────────────────────

/**
 * Ajouter une entreprise à Firestore
 */
async function addCompany(companyData) {
  try {
    const companyRef = db.collection('companies').doc();
    await companyRef.set({
      ...companyData,
      id: companyRef.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return { id: companyRef.id, ...companyData };
  } catch (error) {
    console.error('Error adding company:', error);
    throw error;
  }
}

/**
 * Rechercher des entreprises
 */
async function searchCompanies(filters = {}) {
  try {
    let query = db.collection('companies');

    if (filters.sector) {
      query = query.where('sector', '==', filters.sector);
    }
    if (filters.region) {
      query = query.where('region', '==', filters.region);
    }
    if (filters.city) {
      query = query.where('city', '==', filters.city);
    }
    if (filters.active !== undefined) {
      query = query.where('active', '==', filters.active);
    }

    const requestedLimit = Math.min(Math.max(parseInt(filters.limit, 10) || 50, 1), 200);
    const snapshot = await query.limit(requestedLimit).get();
    let companies = [];
    snapshot.forEach((doc) => companies.push({ id: doc.id, ...doc.data() }));

    if (filters.query) {
      const q = filters.query.toString().trim().toLowerCase();
      if (q) {
        companies = companies.filter((company) => {
          const values = [
            company.raison_sociale,
            company.sigle,
            company.activite_principale,
            company.sector,
            company.region,
            company.city,
            company.centre_rattachement,
            company.dirigeant,
            company.email,
          ];
          return values.some((value) =>
            typeof value === 'string' && value.toLowerCase().includes(q)
          );
        });
      }
    }

    return companies;
  } catch (error) {
    console.error('Error searching companies:', error);
    throw error;
  }
}

/**
 * Ajouter une recherche sauvegardée
 */
async function addSavedSearch(uid, searchData) {
  try {
    const searchRef = db.collection('saved_searches').doc();
    await searchRef.set({
      uid,
      title: searchData.title || 'Recherche sauvegardée',
      query: searchData.query || '',
      filters: searchData.filters || {},
      results: searchData.results || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return { id: searchRef.id, ...searchData };
  } catch (error) {
    console.error('Error adding saved search:', error);
    throw error;
  }
}

/**
 * Récupérer les recherches sauvegardées d'un utilisateur
 */
async function getSavedSearches(uid) {
  try {
    const snapshot = await db
      .collection('saved_searches')
      .where('uid', '==', uid)
      .orderBy('createdAt', 'desc')
      .get();

    const searches = [];
    snapshot.forEach((doc) => searches.push({ id: doc.id, ...doc.data() }));
    return searches;
  } catch (error) {
    console.error('Error getting saved searches:', error);
    throw error;
  }
}

/**
 * Supprimer une recherche sauvegardée
 */
async function deleteSavedSearch(uid, searchId) {
  try {
    const docRef = db.collection('saved_searches').doc(searchId);
    const doc = await docRef.get();
    if (!doc.exists) return false;
    if (doc.data().uid !== uid) throw new Error('Unauthorized');
    await docRef.delete();
    return true;
  } catch (error) {
    console.error('Error deleting saved search:', error);
    throw error;
  }
}

/**
 * Mettre à jour un prospect dans le pipeline
 */
async function updatePipelineProspect(userId, prospectId, updateData) {
  try {
    const prospectRef = db
      .collection('users')
      .doc(userId)
      .collection('pipeline')
      .doc(prospectId);

    await prospectRef.update({
      ...updateData,
      updatedAt: new Date().toISOString(),
    });

    const updatedDoc = await prospectRef.get();
    return { id: updatedDoc.id, ...updatedDoc.data() };
  } catch (error) {
    console.error('Error updating pipeline prospect:', error);
    throw error;
  }
}

/**
 * Supprimer un prospect dans le pipeline
 */
async function deletePipelineProspect(userId, prospectId) {
  try {
    const prospectRef = db
      .collection('users')
      .doc(userId)
      .collection('pipeline')
      .doc(prospectId);

    await prospectRef.delete();
    return true;
  } catch (error) {
    console.error('Error deleting pipeline prospect:', error);
    throw error;
  }
}

/**
 * Importer plusieurs entreprises (batch)
 */
async function importCompaniesBatch(companiesData) {
  try {
    const batch = db.batch();
    let importedCount = 0;
    let skippedCount = 0;

    for (const company of companiesData) {
      // Skip si NIU déjà existe
      const existing = await db
        .collection('companies')
        .where('niu', '==', company.niu)
        .limit(1)
        .get();

      if (existing.empty) {
        const companyRef = db.collection('companies').doc();
        batch.set(companyRef, {
          ...company,
          id: companyRef.id,
          active: true,
          importedAt: new Date().toISOString(),
        });
        importedCount++;
      } else {
        skippedCount++;
      }

      // Commit tous les 500 documents
      if (importedCount % 500 === 0) {
        await batch.commit();
      }
    }

    // Commit les restants
    await batch.commit();

    return { importedCount, skippedCount };
  } catch (error) {
    console.error('Error importing companies batch:', error);
    throw error;
  }
}

// ── CONFIG OPERATIONS ──────────────────────────────────────────

/**
 * Sauvegarder configuration
 */
async function setConfig(key, value) {
  try {
    await db.collection('config').doc(key).set(
      {
        value,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
    return true;
  } catch (error) {
    console.error('Error setting config:', error);
    throw error;
  }
}

/**
 * Récupérer configuration
 */
async function getConfig(key) {
  try {
    const doc = await db.collection('config').doc(key).get();
    if (!doc.exists) return null;
    return doc.data().value;
  } catch (error) {
    console.error('Error getting config:', error);
    throw error;
  }
}

// ── PIPELINE/DEALS OPERATIONS ──────────────────────────────────

/**
 * Créer prospect dans pipeline
 */
async function addPipelineProspect(userId, prospectData) {
  try {
    const pipelineRef = db.collection('users').doc(userId).collection('pipeline');
    let query = pipelineRef;

    if (prospectData.company_id) {
      query = query.where('company_id', '==', prospectData.company_id);
    } else if (prospectData.company_name) {
      query = query.where('company_name', '==', prospectData.company_name);
    }

    const existing = await query.limit(1).get();
    if (!existing.empty) {
      throw new Error('Prospect already exists');
    }

    const prospectRef = pipelineRef.doc();
    await prospectRef.set({
      ...prospectData,
      id: prospectRef.id,
      status: prospectData.status || 'prospection',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    return { id: prospectRef.id, ...prospectData };
  } catch (error) {
    console.error('Error adding pipeline prospect:', error);
    throw error;
  }
}

/**
 * Obtenir pipeline utilisateur
 */
async function getUserPipeline(userId, filters = {}) {
  try {
    let query = db
      .collection('users')
      .doc(userId)
      .collection('pipeline');

    if (filters.status) {
      query = query.where('status', '==', filters.status);
    }

    const snapshot = await query.orderBy('updatedAt', 'desc').get();
    const prospects = [];
    snapshot.forEach((doc) => prospects.push({ id: doc.id, ...doc.data() }));
    return prospects;
  } catch (error) {
    console.error('Error getting user pipeline:', error);
    throw error;
  }
}

// ── USAGE LOGS ──────────────────────────────────────────────────

/**
 * Enregistrer une requête utilisateur
 */
async function logUsage(userId, query, resultsCount) {
  try {
    await db.collection('usage_logs').add({
      userId,
      query,
      resultsCount,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error logging usage:', error);
  }
}

// ── MIDDLEWARE ──────────────────────────────────────────────────

/**
 * Middleware pour vérifier JWT Firebase
 */
async function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split('Bearer ')[1];
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decodedToken = await auth.verifyIdToken(token);
    req.userId = decodedToken.uid;
    req.userEmail = decodedToken.email;
    next();
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(401).json({ error: 'Invalid token' });
  }
}

/**
 * Middleware pour vérifier admin
 */
async function verifyAdmin(req, res, next) {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decodedToken = await auth.verifyIdToken(token);

    if (!decodedToken.admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    req.userId = decodedToken.uid;
    next();
  } catch (error) {
    console.error('Admin verification error:', error);
    res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = {
  // User
  createUser,
  getUser,
  updateUserPlan,
  setAdminClaims,

  // Companies
  addCompany,
  searchCompanies,
  importCompaniesBatch,

  // Config
  setConfig,
  getConfig,

  // Pipeline
  addPipelineProspect,
  getUserPipeline,
  updatePipelineProspect,
  deletePipelineProspect,

  // Saved Searches
  addSavedSearch,
  getSavedSearches,
  deleteSavedSearch,

  // Usage
  logUsage,

  // Middleware
  verifyToken,
  verifyAdmin,
};
