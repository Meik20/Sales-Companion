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
      role: userData.role || 'independent',
      company_id: userData.company_id || userData.company || null,
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
 
function normalizeInt(value) {
  const n = Number(String(value || '').replace(/[^0-9]/g, ''));
  return Number.isInteger(n) ? n : null;
}

function extractEmployeeThreshold(query) {
  if (!query || typeof query !== 'string') return null;
  const match = query.match(/(\d{2,4})\s*(employ|salari|personne|effectif|staff)/i);
  return match ? normalizeInt(match[1]) : null;
}

function computeLeadScore(company) {
  let score = 45;
  if (company.active === false) score -= 18;

  const employees = normalizeInt(company.employees || company.employee_count || company.effectif || company.nb_employes || company.taille || company.taille_effectif);
  if (employees !== null) {
    if (employees >= 100) score += 22;
    else if (employees >= 50) score += 16;
    else if (employees >= 20) score += 10;
    else if (employees >= 5) score += 4;
  }

  const jobOffers = normalizeInt(company.job_postings || company.offres_emploi || company.job_offers || company.offres || company.recrutement);
  if (jobOffers !== null) {
    if (jobOffers >= 5) score += 18;
    else if (jobOffers >= 2) score += 10;
    else if (jobOffers >= 1) score += 6;
  }

  if (company.sector || company.secteur || company.activite_principale || company.activitePrincipale) {
    score += 6;
  }

  if (company.updatedAt) {
    const updatedAt = new Date(company.updatedAt);
    if (!Number.isNaN(updatedAt.getTime())) {
      const ageDays = Math.floor((Date.now() - updatedAt.getTime()) / (1000 * 60 * 60 * 24));
      if (ageDays <= 30) score += 8;
      else if (ageDays <= 90) score += 4;
    }
  }

  return Math.min(100, Math.max(1, score));
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
    const companyPayload = {
      ...companyData,
      id: companyRef.id,
      leadScore: companyData.leadScore || companyData.lead_score || computeLeadScore(companyData),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await companyRef.set(companyPayload);
    return { id: companyRef.id, ...companyPayload };
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
 
    const q = String(filters.query || '').trim().toLowerCase();
    const employeeThreshold = extractEmployeeThreshold(q);

    if (q) {
      companies = companies.filter(c =>
        [
          c.raisonSociale,
          c.raison_sociale,
          c.sigle,
          c.activitePrincipale,
          c.activite_principale,
          c.sector,
          c.secteur,
          c.region,
          c.city,
          c.ville,
          c.dirigeant,
          c.email,
          c.company_email,
          c.contact_email,
          c.telephone,
          c.company_phone,
          c.adresse,
          c.company_address,
          c.site_web,
          c.website,
        ].some(v => typeof v === 'string' && v.toLowerCase().includes(q))
      );
    }

    if (employeeThreshold !== null) {
      companies = companies.filter(c => {
        const employees = normalizeInt(c.employees || c.employee_count || c.effectif || c.nb_employes || c.taille || c.taille_effectif || c.staff_count);
        return typeof employees === 'number' && employees >= employeeThreshold;
      });
    }

    // ── GEO-RADIUS FILTER (around_me) ─────────────────────────
    // filters.around_me = { lat, lon, radius } where radius is in km
    if (filters.around_me && filters.around_me.lat && filters.around_me.lon) {
      const toNum = (v) => (v === undefined || v === null ? null : Number(v));
      const originLat = toNum(filters.around_me.lat);
      const originLon = toNum(filters.around_me.lon);
      const radiusKm = toNum(filters.around_me.radius) || 10;

      // Haversine distance
      const haversineKm = (lat1, lon1, lat2, lon2) => {
        const toRad = (deg) => deg * Math.PI / 180;
        const R = 6371; // Earth radius km
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
      };

      companies = companies.map(c => {
        const lat = toNum(c.latitude || c.lat || (c.location && c.location.latitude) || (c.geo && c.geo.lat));
        const lon = toNum(c.longitude || c.lon || c.lng || (c.location && c.location.longitude) || (c.geo && c.geo.lon));
        if (lat !== null && lon !== null && !Number.isNaN(lat) && !Number.isNaN(lon)) {
          const distance = haversineKm(originLat, originLon, lat, lon);
          return { ...c, _distance_km: Math.round(distance * 100) / 100, _hasLocation: true };
        }
        return { ...c, _distance_km: null, _hasLocation: false };
      }).filter(c => c._hasLocation && c._distance_km !== null && c._distance_km <= radiusKm)
        .sort((a,b) => (a._distance_km || 999999) - (b._distance_km || 999999));
    }

    companies = companies.map(c => ({
      ...c,
      leadScore: c.leadScore || c.lead_score || computeLeadScore(c),
    }));

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
          const payload = {
            ...company,
            id: docId,
            active: true,
            leadScore: company.leadScore || company.lead_score || computeLeadScore(company),
            updatedAt: new Date().toISOString(),
          };
          batch.set(ref, payload, { merge: true });
 
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

// ── ASSIGNMENTS / TEAM MANAGEMENT ─────────────────────────────────
async function addAssignments(assignerId, assigneeId, prospectIds = [], note = '') {
  try {
    if (!assigneeId || !Array.isArray(prospectIds) || prospectIds.length === 0) throw new Error('Invalid parameters');
    const batch = db.batch();
    const created = [];
    for (const pid of prospectIds) {
      const ref = db.collection('assignments').doc();
      const doc = {
        id: ref.id,
        company_id: pid,
        assigned_to: assigneeId,
        assigned_by: assignerId,
        note: note || '',
        status: 'assigned',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      batch.set(ref, doc);
      created.push(doc);
    }
    await batch.commit();
    return created;
  } catch (error) {
    console.error('Error creating assignments:', error.message || error);
    throw error;
  }
}

async function getAssignmentsForUser(userId, limit = 200) {
  try {
    const snapshot = await db.collection('assignments')
      .where('assigned_to', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(parseInt(limit, 10) || 200)
      .get();
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (error) {
    console.error('Error getting assignments for user:', error.message || error);
    throw error;
  }
}

async function getAssignmentsCreatedBy(userId, limit = 200) {
  try {
    const snapshot = await db.collection('assignments')
      .where('assigned_by', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(parseInt(limit, 10) || 200)
      .get();
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (error) {
    console.error('Error getting assignments created by user:', error.message || error);
    throw error;
  }
}

async function updateAssignment(assignmentId, updateData = {}) {
  try {
    const ref = db.collection('assignments').doc(assignmentId);
    await ref.update({ ...updateData, updatedAt: new Date().toISOString() });
    const doc = await ref.get();
    return { id: doc.id, ...doc.data() };
  } catch (error) {
    console.error('Error updating assignment:', error.message || error);
    throw error;
  }
}

// ── TEAM / USERS HELPERS ───────────────────────────────────────
async function getTeamMembers(managerId, limit = 200) {
  try {
    const candidates = [];
    const mgrDoc = await db.collection('users').doc(managerId).get();
    if (mgrDoc.exists) {
      const mgr = mgrDoc.data();
      // If manager document has a company link, return users with same company_id
      const companyId = mgr.company_id || mgr.companyId || mgr.company || null;
      if (companyId) {
        const snap = await db.collection('users').where('company_id', '==', companyId).get();
        candidates.push(...snap.docs.map(d => ({ uid: d.id, ...d.data() })));
      }
      // Try direct manager pointer fields
      const byManager = await db.collection('users').where('managerId', '==', managerId).get();
      candidates.push(...byManager.docs.map(d => ({ uid: d.id, ...d.data() })));
      const byManager2 = await db.collection('users').where('manager', '==', managerId).get().catch(()=>({docs:[]}));
      candidates.push(...byManager2.docs.map(d => ({ uid: d.id, ...d.data() })));
      // If manager has 'team' array of uids
      if (Array.isArray(mgr.team) && mgr.team.length) {
        for (const memberId of mgr.team.slice(0, limit)) {
          const mDoc = await db.collection('users').doc(memberId).get().catch(()=>null);
          if (mDoc && mDoc.exists) candidates.push({ uid: mDoc.id, ...mDoc.data() });
        }
      }
    }

    // Deduplicate by uid
    const map = new Map();
    for (const u of candidates) {
      if (!u || !u.uid) continue;
      if (!map.has(u.uid)) map.set(u.uid, { uid: u.uid, name: u.name || u.displayName || u.email || u.uid, email: u.email || '' });
    }

    const out = Array.from(map.values()).slice(0, limit);
    return out;
  } catch (error) {
    console.error('Error getting team members:', error.message || error);
    throw error;
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
    let decoded;
    let isCustomToken = false;
    
    // Try to verify as ID token first (preferred)
    try {
      decoded = await auth.verifyIdToken(token);
    } catch (idTokenErr) {
      // Check if this might be a custom token (custom tokens raise specific error)
      if (idTokenErr.message.includes('custom token')) {
        isCustomToken = true;
        // For custom tokens, we need to decode manually or verify differently
        // Parse the JWT payload manually (this is safe for custom tokens)
        try {
          const parts = token.split('.');
          if (parts.length !== 3) throw new Error('Invalid token format');
          
          const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
          decoded = payload;
          console.log(`[Auth] Custom token decoded for ${decoded.uid}`);
        } catch (parseErr) {
          throw idTokenErr; // Fall back to original error
        }
      } else {
        throw idTokenErr;
      }
    }
    
    // Check if user is admin
    if (!decoded.admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    // Verify user still exists and is admin
    try {
      const userDoc = await auth.getUser(decoded.uid);
      if (!userDoc.customClaims?.admin) {
        return res.status(403).json({ error: 'Admin access revoked' });
      }
    } catch (userErr) {
      if (!isCustomToken) throw userErr; // For ID tokens, this is fatal
      console.warn(`[Auth] Could not verify admin user ${decoded.uid}:`, userErr.message);
    }
    
    // Populate req.user with decoded token claims
    req.user = {
      uid: decoded.uid,
      email: decoded.email || 'admin@sales-companion.local',
      emailVerified: decoded.email_verified || false,
      isAdmin: true,
    };
    
    // Also set individual properties for backward compatibility
    req.userId    = decoded.uid;
    req.userEmail = req.user.email;
    
    console.log(`[Auth] Admin token verified for user: ${req.userEmail} (${req.userId})`);
    next();
  } catch (error) {
    console.error('Admin verification error:', error.message);
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
  // Assignments / team
  addAssignments, getAssignmentsForUser, getAssignmentsCreatedBy, updateAssignment,
  getTeamMembers,
  verifyToken, verifyAdmin,
};

 