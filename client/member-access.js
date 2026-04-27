/**
 * member-access.js — Sales Companion Client (Desktop)
 * Script classique (non-ESM), Firebase compat uniquement.
 *
 * CORRECTIONS v2 :
 *  - Suppression des imports ESM (incompatibles avec chargement script classique)
 *  - Activation : collecte email + password + confirm
 *    → POST /api/team/activate (Railway crée le compte Firebase Auth via Admin SDK)
 *    → team_accesses/{accessId} mis à jour : { status:'active', firebaseUid, email, activatedAt }
 *  - Création accès : structure Firestore enrichie
 *    { firebaseUid:null, email:null, managerEmail, mustChangePassword }
 *  - Toutes les fonctions exposées sur window.MemberAccessManager
 *  - Compatible avec window.TeamManager (client/desktop)
 */

(function () {
  'use strict';

  /* =========================================================
     UTILITAIRES
  ========================================================= */

  function normalizeText(text) {
    return (text || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
  }

  function buildAccessId(firstname, lastname, company) {
    var first = normalizeText(firstname);
    var last  = normalizeText(lastname);
    var comp  = normalizeText(company);
    if (!first && !last && !comp) return '@entreprise';
    return first + last + '@' + comp;
  }

  function normalizeAccessId(accessId) {
    if (!accessId) return '';
    var s  = accessId.trim();
    var at = s.indexOf('@');
    if (at < 0) return normalizeText(s);
    return normalizeText(s.slice(0, at)) + '@' + normalizeText(s.slice(at + 1));
  }

  function getRailwayBase() {
    if (typeof RAILWAY_SERVER !== 'undefined' && RAILWAY_SERVER) return RAILWAY_SERVER;
    if (window.RAILWAY_SERVER) return window.RAILWAY_SERVER;
    return '';
  }

  function showToast(msg) {
    if (typeof window.toast === 'function') { window.toast(msg); return; }
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className   = 'toast show';
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { el.className = 'toast'; }, 3500);
  }

  /* =========================================================
     HELPERS FIREBASE COMPAT
     (Firebase chargé via les scripts compat dans index.html)
  ========================================================= */

  function getDb() {
    if (window._db) return window._db;
    try {
      if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) {
        return firebase.firestore();
      }
    } catch (e) {}
    return null;
  }

  function getServerTimestamp() {
    try {
      return firebase.firestore.FieldValue.serverTimestamp();
    } catch (e) {
      return new Date().toISOString();
    }
  }

  function getCurrentManagerUid() {
    if (window.user && window.user.uid) return window.user.uid;
    try {
      var auth = window._auth || firebase.auth();
      var u    = auth.currentUser;
      return u ? u.uid : null;
    } catch (e) {
      return null;
    }
  }

  function getCurrentManagerEmail() {
    if (window.user && window.user.email) return window.user.email;
    try {
      var auth = window._auth || firebase.auth();
      var u    = auth.currentUser;
      return u ? (u.email || '') : '';
    } catch (e) {
      return '';
    }
  }

  /* =========================================================
     APERÇU DYNAMIQUE (formulaire manager)
  ========================================================= */

  function updateAccessPreview() {
    var fn = ((document.getElementById('new-access-firstname') || {}).value || '').trim();
    var ln = ((document.getElementById('new-access-lastname')  || {}).value || '').trim();
    var co = ((document.getElementById('new-access-company')   || {}).value || 'Entreprise').trim();
    var el = document.getElementById('new-access-preview');
    if (!el) return;
    el.textContent = (fn || ln)
      ? buildAccessId(fn, ln, co)
      : '@' + (normalizeText(co) || 'entreprise');
  }

  /* =========================================================
     COMPTER LES ACCÈS ACTIFS/EN ATTENTE DU MANAGER
  ========================================================= */

  async function countManagerAccesses(managerUid) {
    var db = getDb();
    if (!db) return 0;
    var snap = await db.collection('team_accesses')
      .where('createdBy', '==', managerUid)
      .where('status', 'in', ['pending', 'active'])
      .get();
    return snap.size;
  }

  /* =========================================================
     CRÉATION D'UN ACCÈS MEMBRE (par le manager)

     Document Firestore créé : team_accesses/{accessId}
     {
       accessId       : "jeandupont@orange"
       firstname, lastname, company
       role           : 'member'
       status         : 'pending'    → 'active' après activation
       activated      : false         → true après activation
       firebaseUid    : null          → rempli à l'activation
       email          : null          → rempli à l'activation
       createdBy      : managerUid
       managerEmail   : string
       mustChangePassword : true
       createdAt      : Timestamp
     }
  ========================================================= */

  async function createMemberAccess() {
    var db = getDb();

    // Fallback : si pas de Firebase côté client (ex: Electron sans Firebase compat),
    // déléguer à l'API Railway directement
    if (!db) {
      return createMemberAccessViaAPI();
    }

    var managerUid = getCurrentManagerUid();
    if (!managerUid) { showToast('Vous devez être connecté en tant que manager.'); return false; }

    var fn = ((document.getElementById('new-access-firstname') || {}).value || '').trim();
    var ln = ((document.getElementById('new-access-lastname')  || {}).value || '').trim();
    var co = ((document.getElementById('new-access-company')   || {}).value || '').trim();

    if (!fn || !ln || !co) { showToast('Prénom, nom et entreprise requis.'); return false; }

    var accessId = buildAccessId(fn, ln, co);
    if (!accessId || accessId === '@entreprise') { showToast('Identifiant invalide.'); return false; }

    var btn = document.getElementById('create-access-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Création...'; }

    try {
      var count = await countManagerAccesses(managerUid);
      if (count >= 10) { showToast('Limite de 10 accès atteinte.'); return false; }

      var ref = db.collection('team_accesses').doc(accessId);
      if ((await ref.get()).exists) {
        showToast("Cet identifiant existe déjà. Modifiez le nom ou l'entreprise.");
        return false;
      }

      await ref.set({
        accessId:           accessId,
        firstname:          fn,
        lastname:           ln,
        company:            co,
        role:               'member',
        status:             'pending',
        activated:          false,
        firebaseUid:        null,
        email:              null,
        createdBy:          managerUid,
        managerEmail:       getCurrentManagerEmail(),
        mustChangePassword: true,
        createdAt:          getServerTimestamp()
      });

      showToast('✅ Accès créé : ' + accessId);
      clearCreateAccessForm();

      // Fermer la modale
      if (window.TeamManager && typeof window.TeamManager.closeSheet === 'function') {
        window.TeamManager.closeSheet('create-access-sheet');
      }

      // Rafraîchir la liste des accès
      if (window.TeamManager && typeof window.TeamManager.loadAccesses === 'function') {
        await window.TeamManager.loadAccesses();
        window.TeamManager.renderAccesses();
      }
      return true;

    } catch (e) {
      console.error('[createMemberAccess]', e);
      showToast('Erreur création : ' + e.message);
      return false;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Créer l'accès"; }
    }
  }

  /* Fallback création via API Railway (si Firebase compat absent) */
  async function createMemberAccessViaAPI() {
    var fn = ((document.getElementById('new-access-firstname') || {}).value || '').trim();
    var ln = ((document.getElementById('new-access-lastname')  || {}).value || '').trim();
    var co = ((document.getElementById('new-access-company')   || {}).value || '').trim();

    if (!fn || !ln || !co) { showToast('Prénom, nom et entreprise requis.'); return false; }

    var accessId = buildAccessId(fn, ln, co);
    var btn = document.getElementById('create-access-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Création...'; }

    try {
      var res = await fetch(getRailwayBase() + '/api/team/accesses', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': 'Bearer ' + (window.token || '')
        },
        body: JSON.stringify({ accessId, firstname: fn, lastname: ln, company: co })
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) { showToast('Erreur : ' + (data.error || data.message || 'Erreur serveur')); return false; }

      showToast('✅ Accès créé : ' + accessId);
      clearCreateAccessForm();
      if (window.TeamManager && typeof window.TeamManager.closeSheet === 'function') {
        window.TeamManager.closeSheet('create-access-sheet');
      }
      if (window.TeamManager && typeof window.TeamManager.loadAccesses === 'function') {
        await window.TeamManager.loadAccesses();
        window.TeamManager.renderAccesses();
      }
      return true;
    } catch (e) {
      showToast('Erreur réseau : ' + e.message);
      return false;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Créer l'accès"; }
    }
  }

  /* =========================================================
     ACTIVATION DU COMPTE MEMBRE

     Flux :
     1. Membre saisit : accessId + email + password + confirm
     2. Vérification Firestore : existe, pending, non révoqué, non activé
     3. POST /api/team/activate (Railway Admin SDK) → { firebaseUid }
     4. Mise à jour Firestore team_accesses :
        { status:'active', activated:true, firebaseUid, email, activatedAt }
     5. Le membre peut se connecter avec email/password
  ========================================================= */

   async function activateMemberAccount(accessId, email, password, confirmPassword) {
    var db  = getDb();
    var nid = normalizeAccessId(accessId);
 
    // ── Validation locale ──────────────────────────────────────────
    if (!nid)                             return { success: false, message: "Identifiant d'accès requis." };
    if (!email || !email.includes('@'))   return { success: false, message: 'Adresse email invalide.' };
    if (!password || password.length < 8) return { success: false, message: 'Mot de passe : 8 caractères minimum.' };
    if (password !== confirmPassword)     return { success: false, message: 'Les mots de passe ne correspondent pas.' };
 
    // ── Vérification Firestore (lecture 'pending' autorisée sans auth) ──
    if (db) {
      var managerUidFromAccess = '';
      try {
        var ref  = db.collection('team_accesses').doc(nid);
        var snap = await ref.get();

        if (!snap.exists)
          return { success: false, message: "Identifiant introuvable. Vérifiez auprès de votre manager." };

        var data = snap.data();

        if (data.status === 'revoked')
          return { success: false, message: 'Cet accès a été révoqué par votre manager.' };

        if (data.activated === true)
          return { success: false, message: "Compte déjà activé. Utilisez « S'identifier »." };

        managerUidFromAccess = data.createdBy || '';
      } catch (e) {
        // Si Firestore refuse (ex: règle non encore déployée),
        // continuer quand même — Railway vérifiera côté serveur
        console.warn('[activateMemberAccount] Lecture Firestore échouée:', e.message);
      }
    }
 
    // ── Appel Railway : création compte Firebase Auth + mise à jour Firestore ──
    // Railway utilise Admin SDK → pas soumis aux Security Rules
    // C'est Railway qui fait ref.update({status:'active', firebaseUid, email, activatedAt})
    try {
      var res = await fetch(getRailwayBase() + '/api/team/activate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessId:   nid,
          email:      email.trim().toLowerCase(),
          password:   password,
          managerUid: managerUidFromAccess || ''
        })
      });
 
      var result = await res.json().catch(function () { return {}; });
 
      if (!res.ok) {
        return { success: false, message: result.error || result.message || 'Erreur serveur.' };
      }
 
      return {
        success:     true,
        firebaseUid: result.firebaseUid || result.uid || null,
        token:       result.token       || null,
        customToken: result.customToken || null,   // Firebase Custom Token pour signIn
        email:       email.trim().toLowerCase()
      };
 
    } catch (e) {
      console.error('[activateMemberAccount]', e);
      return { success: false, message: 'Erreur réseau : ' + e.message };
    }
  }

  /* =========================================================
     RÉVOCATION
  ========================================================= */

  async function revokeMemberAccess(accessId) {
    var db = getDb();
    if (!db) { showToast('Base de données non disponible'); return false; }

    var managerUid = getCurrentManagerUid();
    if (!managerUid) { showToast('Non connecté.'); return false; }

    try {
      var ref  = db.collection('team_accesses').doc(normalizeAccessId(accessId));
      var snap = await ref.get();
      if (!snap.exists)                         { showToast('Accès introuvable.'); return false; }
      if (snap.data().createdBy !== managerUid) { showToast('Non autorisé.');      return false; }
      await ref.update({ status: 'revoked', revokedAt: getServerTimestamp() });
      showToast('Accès révoqué.');
      return true;
    } catch (e) {
      showToast('Erreur révocation : ' + e.message);
      return false;
    }
  }

  /* =========================================================
     SUPPRESSION
  ========================================================= */

  async function deleteMemberAccess(accessId) {
    var db = getDb();
    if (!db) { showToast('Base de données non disponible'); return false; }

    var managerUid = getCurrentManagerUid();
    if (!managerUid) { showToast('Non connecté.'); return false; }

    try {
      var ref  = db.collection('team_accesses').doc(normalizeAccessId(accessId));
      var snap = await ref.get();
      if (!snap.exists)                         { showToast('Accès introuvable.'); return false; }
      if (snap.data().createdBy !== managerUid) { showToast('Non autorisé.');      return false; }
      await ref.delete();
      showToast('Accès supprimé.');
      return true;
    } catch (e) {
      showToast('Erreur suppression : ' + e.message);
      return false;
    }
  }

  /* =========================================================
     VÉRIFICATION
  ========================================================= */

  async function checkMemberAccessExists(accessId) {
    var db = getDb();
    if (!db) return { exists: false, data: null };
    try {
      var snap = await db.collection('team_accesses').doc(normalizeAccessId(accessId)).get();
      return snap.exists ? { exists: true, data: snap.data() } : { exists: false, data: null };
    } catch (e) {
      return { exists: false, data: null };
    }
  }

  /* =========================================================
     HELPERS FORMULAIRE
  ========================================================= */

  function clearCreateAccessForm() {
    ['new-access-firstname', 'new-access-lastname', 'new-access-company'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = '';
    });
    updateAccessPreview();
  }

  function bindCreateAccessEvents() {
    ['new-access-firstname', 'new-access-lastname', 'new-access-company'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && !el.dataset.maBound) {
        el.addEventListener('input', updateAccessPreview);
        el.dataset.maBound = '1';
      }
    });

    var btn = document.getElementById('create-access-btn');
    if (btn && !btn.dataset.maBound) {
      btn.addEventListener('click', createMemberAccess);
      btn.dataset.maBound = '1';
    }

    updateAccessPreview();
  }

  /* =========================================================
     EXPORT GLOBAL
  ========================================================= */

  window.MemberAccessManager = {
    createMemberAccess:      createMemberAccess,
    activateMemberAccount:   activateMemberAccount,
    revokeMemberAccess:      revokeMemberAccess,
    deleteMemberAccess:      deleteMemberAccess,
    checkMemberAccessExists: checkMemberAccessExists,
    buildAccessId:           buildAccessId,
    normalizeAccessId:       normalizeAccessId,
    updateAccessPreview:     updateAccessPreview,
    bindCreateAccessEvents:  bindCreateAccessEvents,
    clearCreateAccessForm:   clearCreateAccessForm
  };

  window.updateAccessPreview = updateAccessPreview;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindCreateAccessEvents);
  } else {
    bindCreateAccessEvents();
  }

})();