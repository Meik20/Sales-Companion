/* ═══════════════════════════════════════════════════════════
   MANAGER TEAM MANAGEMENT — VERSION AVEC GÉNÉRATION D'ACCÈS
   Gestion robuste des endpoints API manquants
   ═══════════════════════════════════════════════════════════ */

var teamMembers = [];
var teamMembersPipeline = {};
var selectedAssigneeMobile = null;
var currentTeamSeg = 'members';
var activityFeed = [];
var generatedAccesses = []; // Stockage des accès générés

// Global variables for team manager (initialized early)
if (typeof window.selectedForAssignMobile === 'undefined') {
  window.selectedForAssignMobile = new Set();
}

/* ═══════════════════════════════════════════════════════════
   HELPER FUNCTIONS FOR SHEETS/MODALS
   ═══════════════════════════════════════════════════════════ */

function openSheet(sheetId) {
  var sheet = document.getElementById(sheetId);
  if (sheet) sheet.classList.add('open');
}

function closeSheet(sheetId) {
  var sheet = typeof sheetId === 'string' ? document.getElementById(sheetId) : sheetId;
  if (sheet) sheet.classList.remove('open');
}

/* ═══════════════════════════════════════════════════════════
   API WRAPPER FUNCTION
   ═══════════════════════════════════════════════════════════ */

async function api(method, endpoint, data, token) {
  if (typeof RAILWAY_SERVER === 'undefined') {
    console.error('RAILWAY_SERVER not defined');
    throw new Error('Server not configured');
  }
  
  var options = {
    method: method || 'GET',
    headers: {
      'Content-Type': 'application/json'
    }
  };
  
  if (token) {
    options.headers['Authorization'] = 'Bearer ' + token;
  }
  
  if (data && (method === 'POST' || method === 'PUT')) {
    options.body = JSON.stringify(data);
  }
  
  return fetch(RAILWAY_SERVER + endpoint, options);
}

function switchToActivationFlow() {
  // Afficher le formulaire d'activation ET masquer le login
  var loginForm = document.getElementById('login-form');
  var activationForm = document.getElementById('activation-form');
  
  if (loginForm) loginForm.style.display = 'none';
  if (activationForm) {
    activationForm.style.display = 'flex';
  }
  
  // Réinitialiser les champs
  var accessIdEl = document.getElementById('activation-access-id');
  var passwordEl = document.getElementById('activation-new-password');
  var confirmPasswordEl = document.getElementById('activation-confirm-password');
  
  if (accessIdEl) {
    accessIdEl.value = '';
    accessIdEl.focus();
  }
  if (passwordEl) passwordEl.value = '';
  if (confirmPasswordEl) confirmPasswordEl.value = '';
}

function backToLoginForm() {
  // Retour au formulaire de connexion classique
  var loginForm = document.getElementById('login-form');
  var activationForm = document.getElementById('activation-form');
  
  if (loginForm) loginForm.style.display = 'block';
  if (activationForm) activationForm.style.display = 'none';
  
  // Réinitialiser les champs d'activation
  var accessIdEl = document.getElementById('activation-access-id');
  var passwordEl = document.getElementById('activation-new-password');
  var confirmPasswordEl = document.getElementById('activation-confirm-password');
  
  if (accessIdEl) accessIdEl.value = '';
  if (passwordEl) passwordEl.value = '';
  if (confirmPasswordEl) confirmPasswordEl.value = '';
}

async function activateMemberAccess() {
  var accessId = document.getElementById('activation-access-id').value.trim();
  var newPassword = document.getElementById('activation-new-password').value;
  var confirmPassword = document.getElementById('activation-confirm-password').value;
  
  if (!accessId) {
    toast('Veuillez entrer votre ID d\'accès');
    return;
  }
  
  if (!newPassword || newPassword.length < 8) {
    toast('Le mot de passe doit contenir au moins 8 caractères');
    return;
  }
  
  if (newPassword !== confirmPassword) {
    toast('Les mots de passe ne correspondent pas');
    return;
  }
  
  var btn = document.getElementById('activate-access-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Activation...';
  }
  
  try {
    var r = await api('POST', '/api/auth/activate-member', {
      access_id: accessId,
      new_password: newPassword
    }, null);
    
    if (!r.ok) {
      var err = await r.json().catch(function() { return { message: 'ID invalide ou déjà utilisé' }; });
      throw new Error(err.message);
    }
    
    var data = await r.json();
    
    // Sauvegarder le token et l'utilisateur
    token = data.token;
    user = data.user;
    localStorage.setItem('sc_token', token);
    localStorage.setItem('user', JSON.stringify(user));
    
    toast('🎉 Compte activé avec succès !');
    
    // Retarder l'affichage de l'app
    setTimeout(function() {
      if (window.showApp) {
        showApp();
      }
    }, 1000);
    
  } catch(e) {
    toast('Erreur: ' + e.message);
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Activer mon compte';
    }
  }
}

function applyManagerRole() {
  var isManager = user && user.role === 'manager';
  
  // Desktop: show/hide team manager content
  var teamContent = document.getElementById('team-manager-content');
  if (teamContent) {
    teamContent.style.display = isManager ? 'flex' : 'none';
    console.log('[Manager UI] Team content:', isManager ? 'VISIBLE' : 'hidden', '(rôle:', user?.role || 'none', ')');
  }
  
  // Show/hide Team button in header
  var tbTeamBtn = document.getElementById('tb-team-btn');
  if (tbTeamBtn) {
    tbTeamBtn.style.display = isManager ? 'block' : 'none';
  }
  
  // Mobile fallback: show/hide nav-team button
  var navTeam = document.getElementById('nav-team');
  if (navTeam) {
    navTeam.style.display = isManager ? 'block' : 'none';
  }
  
  // Update avatar with user initials
  var avatar = document.getElementById('tb-avatar');
  if (avatar && user) {
    var initials = (user.name || user.email || '?').split(' ').slice(0, 2).map(function(p){ return p[0].toUpperCase(); }).join('');
    avatar.textContent = initials || 'U';
  }
}

function switchTeamSeg(seg, el) {
  currentTeamSeg = seg;
  document.querySelectorAll('.tseg').forEach(function(b) { b.classList.remove('active'); });
  if (el) el.classList.add('active');
  
  var memberView = document.querySelector('#tab-team .team-view:nth-of-type(1)');
  var activityView = document.querySelector('#tab-team #team-activity-view');
  var accessView = document.querySelector('#tab-team #team-access-view');
  
  // Utiliser les classes CSS au lieu de forcer style.display
  if (memberView) memberView.classList.toggle('active', seg === 'members');
  if (activityView) activityView.classList.toggle('active', seg === 'activity');
  if (accessView) accessView.classList.toggle('active', seg === 'access');
  
  // Show "Create access" button only on access tab
  var createAccessBtn = document.getElementById('create-access-btn-header');
  if (createAccessBtn) {
    createAccessBtn.style.display = seg === 'access' ? 'block' : 'none';
  }
  
  if (seg === 'activity') renderActivityFeed();
  if (seg === 'access') renderAccessManagement();
}

function switchToTeamTab() {
  var teamContent = document.getElementById('team-manager-content');
  if (teamContent) {
    teamContent.style.display = 'flex';
    // Switch to members tab by default
    switchTeamSeg('members', document.querySelector('.tseg.active') || document.querySelector('.tseg'));
  }
}

async function refreshTeamData() {
  if (!user || user.role !== 'manager') return;
  document.getElementById('team-loading').style.display = 'flex';
  document.getElementById('activity-loading').style.display = 'flex';
  await loadTeamData();
  await loadGeneratedAccesses();
}

// Flag pour éviter les chargements multiples simultanés
var isTeamDataLoading = false;

async function loadTeamData() {
  if (!user || user.role !== 'manager') return;
  if (isTeamDataLoading) return;
  
  isTeamDataLoading = true;
  var memberView = document.querySelector('#tab-team .team-view:nth-of-type(1)');
  var teamLoadingEl = document.getElementById('team-loading');
  
  try {
    if (teamLoadingEl) teamLoadingEl.style.display = 'flex';
    
    var r = await api('GET', '/api/team', null, token);
    if (!r.ok) throw new Error('Team load failed');
    var d = await r.json();
    teamMembers = d.data || [];
    var pipelinePromises = teamMembers.map(async function(member) {
      try {
        var pr = await api('GET', '/api/pipeline?assignee=' + encodeURIComponent(member.uid), null, token);
        if (pr.ok) { var pd = await pr.json(); teamMembersPipeline[member.uid] = pd.data || pd || []; }
        else { teamMembersPipeline[member.uid] = []; }
      } catch(e) { teamMembersPipeline[member.uid] = []; }
    });
    await Promise.all(pipelinePromises);
    renderTeamMembers();
    buildActivityFeed();
    if (currentTeamSeg === 'activity') renderActivityFeed();
    var pendingCount = teamMembers.reduce(function(acc, m) {
      var items = teamMembersPipeline[m.uid] || [];
      return acc + items.filter(function(p) { return p.status === 'prospection' || p.status === 'negociation'; }).length;
    }, 0);
    var tb = document.getElementById('team-badge');
    if (tb) { tb.textContent = pendingCount; tb.style.display = pendingCount ? '' : 'none'; }
  } catch(e) {
    var container = document.getElementById('team-members-view');
    if (container) {
      container.innerHTML = '<div class="team-empty"><div class="team-empty-icon">&#x1F4E1;</div><h3>Impossible de charger</h3><p>' + e.message + '</p></div>';
    }
  } finally {
    if (teamLoadingEl) teamLoadingEl.style.display = 'none';
    isTeamDataLoading = false;
  }
}

/* ═══════════════════════════════════════════════════════════
   GESTION DES ACCÈS MEMBRES
   ═══════════════════════════════════════════════════════════ */

async function loadGeneratedAccesses() {
  if (!user || user.role !== 'manager') return;
  try {
    var r = await api('GET', '/api/team/accesses', null, token);
    if (r.ok) {
      var d = await r.json();
      generatedAccesses = d.data || [];
    } else if (r.status === 404) {
      // Endpoint pas encore implémenté - utiliser le stockage local temporaire
      var stored = localStorage.getItem('team_accesses_' + user.uid);
      generatedAccesses = stored ? JSON.parse(stored) : [];
      console.log('[Access Management] Using local storage fallback');
    } else {
      generatedAccesses = [];
    }
  } catch(e) {
    // Fallback sur le stockage local
    var stored = localStorage.getItem('team_accesses_' + user.uid);
    generatedAccesses = stored ? JSON.parse(stored) : [];
    console.log('[Access Management] API unavailable, using local storage');
  }
}

async function saveAccessesLocally() {
  if (!user) return;
  try {
    localStorage.setItem('team_accesses_' + user.uid, JSON.stringify(generatedAccesses));
  } catch(e) {
    console.error('Failed to save accesses locally:', e);
  }
}

function renderAccessManagement() {
  var container = document.getElementById('team-access-view');
  if (!container) {
    console.warn('team-access-view not found in DOM');
    return;
  }
  
  var activeAccesses = generatedAccesses.filter(function(a) { return a.status === 'active' || a.status === 'pending'; });
  var canCreateMore = activeAccesses.length < 10;
  
  // Show the "Create access" button in header
  var headerBtn = document.getElementById('create-access-btn-header');
  if (headerBtn) {
    headerBtn.style.display = 'block';
    headerBtn.disabled = !canCreateMore;
  }
  
  var html = '<div class="access-header">'
    + '<div class="access-quota">'
    + '<div class="access-quota-num">' + activeAccesses.length + '/10</div>'
    + '<div class="access-quota-label">Accès utilisés</div>'
    + '</div>'
    + '<button class="btn-primary" onclick="openCreateAccessSheet()" ' + (canCreateMore ? '' : 'disabled') + '>'
    + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'
    + 'Créer un accès'
    + '</button>'
    + '</div>';
  
  if (!generatedAccesses.length) {
    html += '<div class="team-empty">'
      + '<div class="team-empty-icon">&#x1F511;</div>'
      + '<h3>Aucun accès créé</h3>'
      + '<p>Générez des accès pour votre équipe commerciale (max 10)</p>'
      + '</div>';
  } else {
    html += '<div class="access-list">';
    generatedAccesses.forEach(function(access) {
      var statusIcons = { pending: '&#x23F3;', active: '&#x2705;', revoked: '&#x274C;' };
      var statusLabels = { pending: 'En attente', active: 'Actif', revoked: 'Révoqué' };
      var accessIdEsc = (access.access_id || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      
      html += '<div class="access-card ' + access.status + '">'
        + '<div class="access-card-header">'
        + '<div class="access-card-id">' + (access.access_id || '') + '</div>'
        + '<div class="access-status-badge ' + access.status + '">'
        + (statusIcons[access.status] || '') + ' ' + (statusLabels[access.status] || access.status)
        + '</div>'
        + '</div>'
        + '<div class="access-card-info">'
        + '<div class="access-info-row"><strong>Nom:</strong> ' + (access.member_name || '') + '</div>'
        + '<div class="access-info-row"><strong>Créé le:</strong> ' + formatDate(access.created_at) + '</div>'
        + (access.activated_at ? '<div class="access-info-row"><strong>Activé le:</strong> ' + formatDate(access.activated_at) + '</div>' : '')
        + '</div>'
        + '<div class="access-card-actions">';
      
      if (access.status === 'pending') {
        html += '<button class="access-btn copy" onclick="copyAccessId(\'' + accessIdEsc + '\')">'
          + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>'
          + 'Copier l\'ID'
          + '</button>';
      }
      
      if (access.status !== 'revoked') {
        html += '<button class="access-btn revoke" onclick="revokeAccess(\'' + accessIdEsc + '\')">'
          + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
          + 'Révoquer'
          + '</button>';
      }
      
      html += '</div></div>';
    });
    html += '</div>';
  }
  
  container.innerHTML = html;
}

function openCreateAccessSheet() {
  var activeCount = generatedAccesses.filter(function(a) { 
    return a.status === 'active' || a.status === 'pending'; 
  }).length;
  
  if (activeCount >= 10) {
    toast('Limite atteinte : 10 accès maximum');
    return;
  }
  
  var firstnameEl = document.getElementById('new-access-firstname');
  var lastnameEl = document.getElementById('new-access-lastname');
  var previewEl = document.getElementById('new-access-preview');
  var createBtnEl = document.getElementById('create-access-btn');
  
  if (firstnameEl) firstnameEl.value = '';
  if (lastnameEl) lastnameEl.value = '';
  if (previewEl) previewEl.textContent = '@' + (user.company_name || 'Entreprise');
  if (createBtnEl) {
    createBtnEl.disabled = false;
    createBtnEl.textContent = 'Créer l\'accès';
  }
  
  openSheet('create-access-sheet');
}



async function submitCreateAccess() {
  var firstnameEl = document.getElementById('new-access-firstname');
  var lastnameEl = document.getElementById('new-access-lastname');
  
  if (!firstnameEl || !lastnameEl) {
    toast('Formulaire incomplet');
    return;
  }
  
  var firstname = firstnameEl.value.trim();
  var lastname = lastnameEl.value.trim();
  
  if (!firstname || !lastname) {
    toast('Veuillez renseigner le prénom et le nom');
    return;
  }
  
  var company = user.company_name || 'Entreprise';
  var accessId = firstname + '/' + lastname + '@' + company;
  
  var btn = document.getElementById('create-access-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Création...';
  }
  
  try {
    var newAccess = {
      id: Date.now().toString(),
      access_id: accessId,
      member_name: firstname + ' ' + lastname,
      manager_uid: user.uid,
      company_name: company,
      status: 'pending',
      created_at: new Date().toISOString(),
      activated_at: null
    };
    
    // Essayer l'API d'abord
    try {
      var r = await api('POST', '/api/team/accesses', newAccess, token);
      
      if (r.ok) {
        var data = await r.json();
        generatedAccesses.push(data.access || newAccess);
      } else if (r.status === 404) {
        // API pas disponible, utiliser le stockage local
        generatedAccesses.push(newAccess);
        await saveAccessesLocally();
        console.log('[Access Management] Saved locally (API unavailable)');
      } else {
        throw new Error('Erreur serveur');
      }
    } catch(apiError) {
      // Fallback sur le stockage local
      generatedAccesses.push(newAccess);
      await saveAccessesLocally();
      console.log('[Access Management] Saved locally (API error):', apiError.message);
    }
    
    toast('✅ Accès créé avec succès');
    
    closeSheet('create-access-sheet');
    await loadGeneratedAccesses();
    
    // Switch to access tab if element exists
    var accessTab = document.querySelector('.tseg[onclick*="access"]');
    if (accessTab) {
      switchTeamSeg('access', accessTab);
    } else {
      renderAccessManagement();
    }
    
    // Copier automatiquement l'ID
    setTimeout(function() {
      copyAccessId(accessId);
    }, 500);
    
  } catch(e) {
    toast('Erreur: ' + e.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Créer l\'accès';
    }
  }
}

function updateAccessPreview() {
  var firstname = document.getElementById('new-access-firstname').value.trim();
  var lastname = document.getElementById('new-access-lastname').value.trim();
  var company = document.getElementById('new-access-company').value.trim() || 'Entreprise';
  var preview = (firstname && lastname) ? (firstname + lastname + '@' + company) : ('@' + company);
  var previewEl = document.getElementById('new-access-preview');
  if (previewEl) previewEl.textContent = preview;
}

async function copyAccessId(accessId) {
  try {
    await navigator.clipboard.writeText(accessId);
    toast('📋 ID copié : ' + accessId);
  } catch(e) {
    var input = document.createElement('input');
    input.value = accessId;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
    toast('📋 ID copié');
  }
}

async function revokeAccess(accessId) {
  if (!confirm('Voulez-vous vraiment révoquer cet accès ?')) return;
  
  try {
    var access = generatedAccesses.find(function(a) { return a.access_id === accessId; });
    if (!access) {
      toast('Accès introuvable');
      return;
    }
    
    // Essayer l'API d'abord
    try {
      var r = await api('PUT', '/api/team/accesses/' + encodeURIComponent(accessId), {
        status: 'revoked'
      }, token);
      
      if (r.ok) {
        access.status = 'revoked';
      } else if (r.status === 404) {
        // API pas disponible, modifier localement
        access.status = 'revoked';
        await saveAccessesLocally();
      } else {
        throw new Error('Erreur serveur');
      }
    } catch(apiError) {
      // Fallback sur le stockage local
      access.status = 'revoked';
      await saveAccessesLocally();
      console.log('[Access Management] Revoked locally (API unavailable)');
    }
    
    toast('✅ Accès révoqué');
    renderAccessManagement();
    
  } catch(e) {
    toast('Erreur: ' + e.message);
  }
}

/* ═══════════════════════════════════════════════════════════
   ACTIVATION D'ACCÈS MEMBRE (Première connexion)
   ═══════════════════════════════════════════════════════════ */

function showMemberActivationFlow() {
  var loginForm = document.getElementById('login-form');
  var activationForm = document.getElementById('activation-form');
  
  if (loginForm) loginForm.style.display = 'none';
  if (activationForm) activationForm.style.display = 'block';
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch(e) {
    return dateStr;
  }
}

/* ═══════════════════════════════════════════════════════════
   RENDU DES MEMBRES ET ACTIVITÉS
   ═══════════════════════════════════════════════════════════ */

function renderTeamMembers() {
  var container = document.getElementById('team-members-view');
  if (!container) return;
  
  var teamLoading = document.getElementById('team-loading');
  if (teamLoading) teamLoading.style.display = 'none';
  
  if (!teamMembers.length) {
    container.innerHTML = '<div class="team-empty"><div class="team-empty-icon">&#x1F465;</div><h3>Aucun commercial</h3><p>Créez des accès pour votre équipe dans l\'onglet "Accès".</p></div>';
    return;
  }
  
  // Vider complètement le conteneur avant de rendre
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
  
  teamMembers.forEach(function(member) {
    var pipeline = teamMembersPipeline[member.uid] || [];
    var cntP = pipeline.filter(function(p){ return p.status === 'prospection'; }).length;
    var cntN = pipeline.filter(function(p){ return p.status === 'negociation'; }).length;
    var cntC = pipeline.filter(function(p){ return p.status === 'conclue'; }).length;
    var initials = ((member.name || member.email || '?').split(' ').map(function(w){ return w[0]||''; }).join('').slice(0,2)).toUpperCase();
    var card = document.createElement('div');
    card.className = 'member-card';
    card.id = 'member-' + member.uid;
    var recentItems = pipeline.slice(0, 5);
    var pipelineHTML = recentItems.length ? recentItems.map(function(p) {
      return '<div class="mpip-item ' + (p.status||'prospection') + '">'
        + '<span class="mpip-item-name">' + (p.company_name || '&mdash;') + '</span>'
        + '<span class="mpip-item-status ' + (p.status||'prospection') + '">' + statusLabel(p.status) + '</span>'
        + '</div>';
    }).join('') : '<div style="font-size:12px;color:var(--text-tertiary);padding:4px 0">Aucun prospect assigné</div>';
    var uidEsc = member.uid.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    var nameEsc = (member.name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    card.innerHTML = '<div class="member-head" onclick="toggleMemberCard(\'' + uidEsc + '\')">'
      + '<div class="member-av">' + initials + '</div>'
      + '<div class="member-info">'
      + '<div class="member-name">' + (member.name || 'Sans nom') + '</div>'
      + '<div class="member-email">' + (member.email || '') + '</div>'
      + '</div>'
      + '<svg class="member-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><polyline points="6 9 12 15 18 9"/></svg>'
      + '</div>'
      + '<div class="member-kpi">'
      + '<div class="mkpi"><div class="mkpi-val">' + cntP + '</div><div class="mkpi-lbl">Prosp.</div></div>'
      + '<div class="mkpi"><div class="mkpi-val neg">' + cntN + '</div><div class="mkpi-lbl">Négo.</div></div>'
      + '<div class="mkpi"><div class="mkpi-val ok">' + cntC + '</div><div class="mkpi-lbl">Conclu</div></div>'
      + '</div>'
      + '<div class="member-pipeline">'
      + '<div class="mpip-title">Pipeline récent</div>'
      + pipelineHTML
      + '</div>';
    container.appendChild(card);
  });
}

function toggleMemberCard(uid) {
  var card = document.getElementById('member-' + uid);
  if (card) card.classList.toggle('expanded');
}

function statusLabel(status) {
  var labels = { prospection: 'Prospect', negociation: 'Négo', conclue: 'Conclu' };
  return labels[status] || status || 'Prospect';
}

function buildActivityFeed() {
  activityFeed = [];
  teamMembers.forEach(function(member) {
    var pipeline = teamMembersPipeline[member.uid] || [];
    pipeline.forEach(function(p) {
      activityFeed.push({
        memberName: member.name || member.email || 'Commercial',
        memberUid: member.uid,
        company: p.company_name || 'Entreprise',
        status: p.status || 'prospection',
        date: p.updated_at || p.created_at || new Date().toISOString(),
        note: p.note || ''
      });
    });
  });
  activityFeed.sort(function(a, b) { return new Date(b.date) - new Date(a.date); });
}

function renderActivityFeed() {
  var container = document.querySelector('#tab-team #team-activity-view #team-activity-content') || document.getElementById('team-activity-view');
  var loader = document.getElementById('activity-loading');
  if (loader) loader.style.display = 'none';
  container.innerHTML = '';
  if (!activityFeed.length) {
    container.innerHTML = '<div class="team-empty"><div class="team-empty-icon">&#x26A1;</div><h3>Aucune activité</h3><p>L\'activité de votre équipe apparaît ici en temps réel.</p></div>';
    return;
  }
  activityFeed.slice(0, 30).forEach(function(item) {
    var icons = { prospection: '&#x1F3AF;', negociation: '&#x1F91D;', conclue: '&#x2705;' };
    var dateStr = '';
    try { dateStr = new Date(item.date).toLocaleDateString('fr-FR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }); } catch(e) {}
    var el = document.createElement('div');
    el.className = 'activity-item';
    el.innerHTML = '<div class="activity-dot-wrap"><div class="activity-dot ' + item.status + '"></div></div>'
      + '<div class="activity-body">'
      + '<div class="activity-text"><strong>' + item.memberName + '</strong> &mdash; ' + (icons[item.status]||'') + ' <strong>' + item.company + '</strong> en ' + statusLabel(item.status) + '</div>'
      + (item.note ? '<div style="font-size:12px;color:var(--text-secondary);margin-top:3px;font-style:italic">' + item.note.slice(0,80) + (item.note.length > 80 ? '...' : '') + '</div>' : '')
      + '<div class="activity-meta">' + dateStr + '</div>'
      + '</div>';
    container.appendChild(el);
  });
}

/* ═══════════════════════════════════════════════════════════
   INTÉGRATION AVEC SHOWAPP
   ═══════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', function() {
  var _baseShowApp = window.showApp;
  window.showApp = function() {
    _baseShowApp();
    applyManagerRole();
    if (user && user.role === 'manager') setTimeout(loadTeamData, 1000);
  };

  var _baseSwitchTab2 = window.switchTab2;
  window.switchTab2 = function(name) {
    _baseSwitchTab2(name);
    if (name === 'team' && user && user.role === 'manager') {
      if (!teamMembers.length) loadTeamData();
    }
  };
});
