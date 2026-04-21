/**
 * Firestore Helper Functions
 * Gère les opérations spécifiques à Firestore
 */
 
const { db, auth } = require('./firebase-config');
 
// ── USER OPERATIONS ──────────────────────────────────────────────
 
async function createUser(email, password, userData = {}) {
  try {
    const userRecord = await auth.createUser({
      email,
      password,
      displayName: userData.name || '',
    });
    await db.collection('users').doc(userRecord.uid).set({
      uid: userRecord.uid,
      email,
      name: userData.name || '',
      plan: userData.plan || 'free',
      dailyLimit: 10,
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
 
async function updateUserPlan(uid, newPlan) {
  const planLimits = { free:10, starter:200, pro:500, enterprise:9999 };
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
 
async function searchCompanies(filters = {}) {
  try {
    let query = db.collection('companies');
    if (filters.sector)  query = query.where('sector',  '==', filters.sector);
    if (filters.region)  query = query.where('region',  '==', filters.region);
    if (filters.city)    query = query.where('city',    '==', filters.city);
    if (filters.active !== undefined) query = query.where('active', '==', filters.active);
 
    const requestedLimit = Math.min(Math.max(parseInt(filters.limit, 10) || 50, 1), 200);
    const snapshot = await query.limit(requestedLimit).get();
    let companies = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
 
    if (filters.query) {
      const q = String(filters.query).trim().toLowerCase();
      if (q) {
        companies = companies.filter(c =>
          [
            c.raisonSociale,
            c.sigle,
            c.activitePrincipale,
            c.sector,
            c.region,
            c.city,
            c.dirigeant,
            c.email,
            c.company_email,
            c.contact_email,
            c.telephone,
            c.company_phone,
            c.adresse,
            c.company_address
          ].some(v => typeof v === 'string' && v.toLowerCase().includes(q))
        );
      }
    }
    return companies;
  } catch (error) {
    console.error('Error searching companies:', error);
    throw error;
  }
}
 
/**
 * Import par chunks de 400 — évite la limite Firestore de 500 ops/batch
 * Dédoublonnage par NIU (si présent) ou raisonSociale
 */
async function importCompaniesBatch(companiesData) {
  const CHUNK_SIZE = 400;
  let importedCount = 0, skippedCount = 0, errorCount = 0;
 
  try {
    for (let i = 0; i < companiesData.length; i += CHUNK_SIZE) {
      const chunk = companiesData.slice(i, i + CHUNK_SIZE);
      const batch = db.batch();
      let batchCount = 0;
 
      for (const company of chunk) {
        try {
          if (!company.raisonSociale && !company.niu) { skippedCount++; continue; }
 
          const docId = company.niu
            ? String(company.niu).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100)
            : String(company.raisonSociale).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100) + '_' + i;
 
          const ref = db.collection('companies').doc(docId);
          batch.set(ref, {
            ...company,
            id: docId,
            active: true,
            updatedAt: new Date().toISOString(),
          }, { merge: true });
 
          importedCount++;
          batchCount++;
        } catch (e) {
          console.error('[IMPORT] Erreur ligne:', e.message);
          errorCount++;
        }
      }
 
      if (batchCount > 0) {
        await batch.commit();
        console.log(`[IMPORT] Chunk ${Math.floor(i/CHUNK_SIZE)+1} commité — ${importedCount} total importées`);
      }
    }
 
    return { importedCount, skippedCount, errorCount, updatedCount: 0 };
  } catch (error) {
    console.error('Error importing companies batch:', error);
    throw error;
  }
}
 
// ── SAVED SEARCHES ──────────────────────────────────────────────
 
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
 
async function getSavedSearches(uid) {
  try {
    const snapshot = await db.collection('saved_searches')
      .where('uid', '==', uid)
      .orderBy('createdAt', 'desc')
      .get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error('Error getting saved searches:', error);
    throw error;
  }
}
 
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
 
// ── PIPELINE ────────────────────────────────────────────────────
 
async function addPipelineProspect(userId, prospectData) {
  try {
    const pipelineRef = db.collection('users').doc(userId).collection('pipeline');
    let query = pipelineRef;
    if (prospectData.company_id)   query = query.where('company_id',   '==', prospectData.company_id);
    else if (prospectData.company_name) query = query.where('company_name', '==', prospectData.company_name);
    const existing = await query.limit(1).get();
    if (!existing.empty) throw new Error('Prospect already exists');
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
 
async function getUserPipeline(userId, filters = {}) {
  try {
    let query = db.collection('users').doc(userId).collection('pipeline');
    if (filters.status) query = query.where('status', '==', filters.status);
    const snapshot = await query.orderBy('updatedAt', 'desc').get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error('Error getting user pipeline:', error);
    throw error;
  }
}
 
async function updatePipelineProspect(userId, prospectId, updateData) {
  try {
    const ref = db.collection('users').doc(userId).collection('pipeline').doc(prospectId);
    await ref.update({ ...updateData, updatedAt: new Date().toISOString() });
    const updated = await ref.get();
    return { id: updated.id, ...updated.data() };
  } catch (error) {
    console.error('Error updating pipeline prospect:', error);
    throw error;
  }
}
 
async function deletePipelineProspect(userId, prospectId) {
  try {
    await db.collection('users').doc(userId).collection('pipeline').doc(prospectId).delete();
    return true;
  } catch (error) {
    console.error('Error deleting pipeline prospect:', error);
    throw error;
  }
}
 
async function checkCompanyInPipeline(userId, companyId, companyName) {
  try {
    const pipelineRef = db.collection('users').doc(userId).collection('pipeline');
    let query = pipelineRef;
 
    if (companyId) {
      query = query.where('company_id', '==', companyId);
    } else if (companyName) {
      query = query.where('company_name', '==', companyName);
    } else {
      return null;
    }
 
    const snapshot = await query.limit(1).get();
    if (snapshot.empty) return null;
 
    const doc = snapshot.docs[0];
    return {
      prospectId: doc.id,
      inPipeline: true,
      status: doc.data().status || 'prospection'
    };
  } catch (error) {
    console.error('Error checking company in pipeline:', error);
    return null;
  }
}
 
// ── CONFIG ───────────────────────────────────────────────────────
 
async function setConfig(key, value) {
  try {
    await db.collection('config').doc(key).set({ value, updatedAt: new Date().toISOString() }, { merge: true });
    return true;
  } catch (error) {
    console.error('Error setting config:', error);
    throw error;
  }
}
 
async function getConfig(key) {
  try {
    const doc = await db.collection('config').doc(key).get();
    if (!doc.exists) return null;
    return doc.data().value;
  } catch (error) {
    console.error('Error getting config:', error.message);
    return null;
  }
}
 
// ── USAGE LOGS ───────────────────────────────────────────────────
 
async function logUsage(userId, query, resultsCount = 0) {
  try {
    // Enrichir le log avec le nom et le plan si disponible, et utiliser
    // le champ `createdAt` attendu par le panel admin.
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.exists ? userDoc.data() : {};
    await db.collection('usage_logs').add({
      userId,
      name: userData.name || '',
      email: userData.email || '',
      plan: userData.plan || 'free',
      query: query ?? '',
      results_count: resultsCount ?? 0,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error logging usage:', error.message);
  }
}
 
async function consumeCredit(userId) {
  try {
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) return { ok: false, message: 'Utilisateur non trouvé' };
 
    const userData = userDoc.data();
    const today = new Date().toISOString().split('T')[0];
    const lastReset = userData.lastReset ? userData.lastReset.split('T')[0] : null;
 
    let dailyUsed = userData.dailyUsed || 0;
 
    if (lastReset !== today) {
      dailyUsed = 0;
      await db.collection('users').doc(userId).update({
        dailyUsed: 0,
        lastReset: new Date().toISOString(),
      });
    }
 
    const dailyLimit = userData.dailyLimit || 10;
 
    if (dailyUsed >= dailyLimit) {
      return {
        ok: false,
        remaining: 0,
        message: `Limite quotidienne atteinte (${dailyLimit})`
      };
    }
 
    await db.collection('users').doc(userId).update({
      dailyUsed: dailyUsed + 1,
      updatedAt: new Date().toISOString(),
    });
 
    return {
      ok: true,
      remaining: dailyLimit - (dailyUsed + 1)
    };
  } catch (error) {
    console.error('Error consuming credit:', error.message);
    return { ok: false, message: 'Erreur lors de la consommation du crédit' };
  }
}
 
// ── SUPPORT MESSAGING ────────────────────────────────────────────
 
async function createSupportMessage(userId, data) {
  try {
    // Essayer de récupérer le profil Firestore; si absent, utiliser
    // le profil Firebase Auth comme secours afin de toujours créer
    // le message même si l'utilisateur n'a pas de document users.
    let user = await getUser(userId).catch(() => null);
    if (!user) {
      try {
        const authUser = await auth.getUser(userId);
        user = { name: authUser.displayName || 'Utilisateur', email: authUser.email || '' };
      } catch (_) {
        user = { name: 'Utilisateur', email: '' };
      }
    }

    const message = {
      userId,
      userName: user.name || 'Utilisateur',
      userEmail: user.email || '',
      subject: data.subject || 'Support',
      message: data.message || '',
      status: 'open',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const docRef = await db.collection('support_messages').add(message);
    return { id: docRef.id, ...message };
  } catch (error) {
    console.error('Error creating support message:', error.message);
    throw error;
  }
}
 
async function getSupportMessages(limit = 50) {
  try {
    const snapshot = await db.collection('support_messages')
      .orderBy('created_at', 'desc')
      .limit(limit)
      .get();
 
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error('Error getting support messages:', error.message);
    throw error;
  }
}
 
async function getSupportMessagesForUser(userId) {
  try {
    const snapshot = await db.collection('support_messages')
      .where('userId', '==', userId)
      .orderBy('created_at', 'desc')
      .get();
 
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error('Error getting user support messages:', error.message);
    throw error;
  }
}
 
async function replyToSupportMessage(messageId, reply, adminEmail) {
  try {
    await db.collection('support_messages').doc(messageId).update({
      adminReply: reply,
      adminReplyAt: new Date().toISOString(),
      adminReplyBy: adminEmail,
      status: 'answered',
      updated_at: new Date().toISOString(),
    });
    return true;
  } catch (error) {
    console.error('Error replying to support message:', error.message);
    throw error;
  }
}
 
async function closeSupportMessage(messageId) {
  try {
    await db.collection('support_messages').doc(messageId).update({
      status: 'closed',
      updated_at: new Date().toISOString(),
    });
    return true;
  } catch (error) {
    console.error('Error closing support message:', error.message);
    throw error;
  }
}
 
// ── MIDDLEWARE ────────────────────────────────────────────────────
 
async function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split('Bearer ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = await auth.verifyIdToken(token);
    
    // Populate req.user with decoded token claims
    req.user = {
      uid: decoded.uid,
      email: decoded.email,
      emailVerified: decoded.email_verified || false,
      isAdmin: decoded.admin === true,
    };
    
    // Also set individual properties for backward compatibility
    req.userId    = decoded.uid;
    req.userEmail = decoded.email;
    
    console.log(`[Auth] Token verified for user: ${req.userEmail} (${req.userId})`);
    next();
  } catch (error) {
    console.error('Token verification error:', error.message);
    // ✅ FIX: retourner un code clair pour que le client puisse rafraîchir le token
    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({ error: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
 
async function verifyAdmin(req, res, next) {
  const token = req.headers.authorization?.split('Bearer ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = await auth.verifyIdToken(token);
    if (!decoded.admin) return res.status(403).json({ error: 'Admin access required' });
    
    // Populate req.user with decoded token claims
    req.user = {
      uid: decoded.uid,
      email: decoded.email,
      emailVerified: decoded.email_verified || false,
      isAdmin: true,
    };
    
    // Also set individual properties for backward compatibility
    req.userId    = decoded.uid;
    req.userEmail = decoded.email;
    
    console.log(`[Auth] Admin token verified for user: ${req.userEmail} (${req.userId})`);
    next();
  } catch (error) {
    console.error('Admin verification error:', error.message);
    // ✅ FIX: retourner un code clair pour que le client puisse rafraîchir le token
    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({ error: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
 
module.exports = {
  createUser, getUser, updateUserPlan, setAdminClaims,
  addCompany, searchCompanies, importCompaniesBatch,
  setConfig, getConfig,
  addPipelineProspect, getUserPipeline, updatePipelineProspect, deletePipelineProspect, checkCompanyInPipeline,
  addSavedSearch, getSavedSearches, deleteSavedSearch,
  logUsage, consumeCredit,
  createSupportMessage, getSupportMessages, getSupportMessagesForUser, replyToSupportMessage, closeSupportMessage,
  verifyToken, verifyAdmin,
};
 