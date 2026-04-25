import {
  getFirestore,
  collection,
  query,
  where,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const db = getFirestore();

/* ═══════════════════════════════════════════════════════════
   VARIABLES GLOBALES
═══════════════════════════════════════════════════════════ */
if (typeof window.selectedForAssignMobile === 'undefined') {
  window.selectedForAssignMobile = new Set();
}

var teamMembers = [];
var teamMembersPipeline = {};
var selectedAssigneeMobile = null;
var currentTeamSeg = 'members';
var activityFeed = [];
var generatedAccesses = [];
var isTeamDataLoading = false;

/* ═══════════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════════ */
function toast(message) {
  const toastEl = document.getElementById('toast');
  if (!toastEl) {
    console.log(message);
    return;
  }

  toastEl.textContent = message;
  toastEl.classList.add('show');

  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    toastEl.classList.remove('show');
  }, 3000);
}

function openSheet(sheetId) {
  var sheet = document.getElementById(sheetId);
  if (sheet) sheet.classList.add('open');
}

function closeSheet(sheetId) {
  var sheet = typeof sheetId === 'string' ? document.getElementById(sheetId) : sheetId;
  if (sheet) sheet.classList.remove('open');
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
  } catch (e) {
    return dateStr;
  }
}

function statusLabel(status) {
  var labels = {
    prospection: 'Prospect',
    negociation: 'Négo',
    conclue: 'Conclu'
  };
  return labels[status] || status || 'Prospect';
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* ═══════════════════════════════════════════════════════════
   API WRAPPER
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

/* ═══════════════════════════════════════════════════════════
   LOGIN / ACTIVATION FLOW
═══════════════════════════════════════════════════════════ */
function switchToActivationFlow() {
  var loginForm = document.getElementById('login-form');
  var activationForm = document.getElementById('activation-form');

  if (loginForm) loginForm.style.display = 'none';
  if (activationForm) activationForm.style.display = 'flex';

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
  var loginForm = document.getElementById('login-form');
  var activationForm = document.getElementById('activation-form');

  if (loginForm) loginForm.style.display = 'block';
  if (activationForm) activationForm.style.display = 'none';

  var accessIdEl = document.getElementById('activation-access-id');
  var passwordEl = document.getElementById('activation-new-password');
  var confirmPasswordEl = document.getElementById('activation-confirm-password');

  if (accessIdEl) accessIdEl.value = '';
  if (passwordEl) passwordEl.value = '';
  if (confirmPasswordEl) confirmPasswordEl.value = '';
}

async function activateMemberAccess() {
  var accessId = document.getElementById('activation-access-id')?.value.trim() || '';
  var newPassword = document.getElementById('activation-new-password')?.value || '';
  var confirmPassword = document.getElementById('activation-confirm-password')?.value || '';
  var btn = document.getElementById('activate-access-btn');

  if (!window.MemberAccessManager) {
    toast("Module d'accès non disponible");
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Activation...';
  }

  try {
    const result = await window.MemberAccessManager.activateMemberAccount(
      accessId,
      newPassword,
      confirmPassword
    );

    if (!result.success) {
      throw new Error(result.message || "Erreur d'activation");
    }

    toast('🎉 Compte activé avec succès !');

    setTimeout(function () {
      backToLoginForm();
    }, 1000);

  } catch (e) {
    toast('Erreur: ' + e.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Activer mon compte →';
    }
  }
}

/* ═══════════════════════════════════════════════════════════
   ROLE MANAGER / NAV
═══════════════════════════════════════════════════════════ */
function applyManagerRole() {
  var isManager = window.user && window.user.role === 'manager';
  var navTeam = document.getElementById('nav-team');
  if (navTeam) navTeam.style.display = isManager ? 'block' : 'none';
}

function switchTeamSeg(seg, el) {
  currentTeamSeg = seg;

  document.querySelectorAll('.tseg').forEach(function (b) {
    b.classList.remove('active');
  });
  if (el) el.classList.add('active');

  var memberView = document.getElementById('team-members-view');
  var activityView = document.getElementById('team-activity-view');
  var accessView = document.getElementById('team-access-view');

  if (memberView) memberView.style.display = seg === 'members' ? 'block' : 'none';
  if (activityView) activityView.style.display = seg === 'activity' ? 'block' : 'none';
  if (accessView) accessView.style.display = seg === 'access' ? 'block' : 'none';

  if (seg === 'activity') renderActivityFeed();
  if (seg === 'access') renderAccessManagement();

  var createAccessBtnHeader = document.getElementById('create-access-btn-header');
  if (createAccessBtnHeader) {
    createAccessBtnHeader.style.display = seg === 'access' ? 'inline-flex' : 'none';
  }
}

/* ═══════════════════════════════════════════════════════════
   TEAM DATA
═══════════════════════════════════════════════════════════ */
async function refreshTeamData() {
  if (!window.user || window.user.role !== 'manager') return;

  var teamLoading = document.getElementById('team-loading');
  var activityLoading = document.getElementById('activity-loading');

  if (teamLoading) teamLoading.style.display = 'flex';
  if (activityLoading) activityLoading.style.display = 'flex';

  await loadTeamData();
  await loadGeneratedAccesses();
}

async function loadTeamData() {
  if (!window.user || window.user.role !== 'manager') return;
  if (isTeamDataLoading) return;

  isTeamDataLoading = true;
  var container = document.getElementById('team-members-view');
  var teamLoadingEl = document.getElementById('team-loading');

  try {
    if (teamLoadingEl) teamLoadingEl.style.display = 'flex';

    var r = await api('GET', '/api/team', null, window.token);
    if (!r.ok) throw new Error('Chargement équipe impossible');

    var d = await r.json();
    teamMembers = d.data || [];
    teamMembersPipeline = {};

    var pipelinePromises = teamMembers.map(async function (member) {
      try {
        var pr = await api('GET', '/api/pipeline?assignee=' + encodeURIComponent(member.uid), null, window.token);
        if (pr.ok) {
          var pd = await pr.json();
          teamMembersPipeline[member.uid] = pd.data || pd || [];
        } else {
          teamMembersPipeline[member.uid] = [];
        }
      } catch (e) {
        teamMembersPipeline[member.uid] = [];
      }
    });

    await Promise.all(pipelinePromises);

    renderTeamMembers();
    buildActivityFeed();
    if (currentTeamSeg === 'activity') renderActivityFeed();

    var pendingCount = teamMembers.reduce(function (acc, m) {
      var items = teamMembersPipeline[m.uid] || [];
      return acc + items.filter(function (p) {
        return p.status === 'prospection' || p.status === 'negociation';
      }).length;
    }, 0);

    var tb = document.getElementById('team-badge');
    if (tb) {
      tb.textContent = pendingCount;
      tb.style.display = pendingCount ? '' : 'none';
    }

  } catch (e) {
    if (container) {
      container.innerHTML = '<div class="team-empty"><div class="team-empty-icon">📡</div><h3>Impossible de charger</h3><p>' + escapeHtml(e.message) + '</p></div>';
    }
  } finally {
    if (teamLoadingEl) teamLoadingEl.style.display = 'none';
    var activityLoading = document.getElementById('activity-loading');
    if (activityLoading) activityLoading.style.display = 'none';
    isTeamDataLoading = false;
  }
}

/* ═══════════════════════════════════════════════════════════
   ACCÈS MEMBRES — FIRESTORE
═══════════════════════════════════════════════════════════ */
async function loadGeneratedAccesses() {
  if (!window.user || window.user.role !== 'manager') return;

  try {
    const q = query(
      collection(db, "member_access"),
      where("createdBy", "==", window.user.uid)
    );

    const snap = await getDocs(q);

    generatedAccesses = snap.docs.map(function (docSnap) {
      const data = docSnap.data();
      return {
        id: docSnap.id,
        access_id: data.accessId || docSnap.id,
        member_name: ((data.firstname || '') + ' ' + (data.lastname || '')).trim(),
        company: data.company || '',
        status: data.status || 'pending',
        created_at: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : '',
        activated_at: data.activatedAt?.toDate ? data.activatedAt.toDate().toISOString() : ''
      };
    });

  } catch (e) {
    console.error('Erreur chargement accès:', e);
    generatedAccesses = [];
  }
}

function renderAccessManagement() {
  var container = document.getElementById('team-access-view');
  if (!container) return;

  var activeAccesses = generatedAccesses.filter(function (a) {
    return a.status === 'active' || a.status === 'pending';
  });

  var canCreateMore = activeAccesses.length < 10;

  var html = '<div class="access-header">'
    + '<div class="access-quota">'
    + '<div class="access-quota-num">' + activeAccesses.length + '/10</div>'
    + '<div class="access-quota-label">Accès utilisés</div>'
    + '</div>'
    + '<button class="btn-primary" type="button" onclick="window.TeamManagerMobile.openCreateAccessSheet()" ' + (canCreateMore ? '' : 'disabled') + '>'
    + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'
    + 'Créer un accès'
    + '</button>'
    + '</div>';

  if (!generatedAccesses.length) {
    html += '<div class="team-empty">'
      + '<div class="team-empty-icon">🔑</div>'
      + '<h3>Aucun accès créé</h3>'
      + '<p>Générez des accès pour votre équipe commerciale (max 10)</p>'
      + '</div>';
  } else {
    html += '<div class="access-list">';
    generatedAccesses.forEach(function (access) {
      var statusIcons = { pending: '⏳', active: '✅', revoked: '❌' };
      var statusLabels = { pending: 'En attente', active: 'Actif', revoked: 'Révoqué' };
      var accessId = access.access_id || String(access.id);

      html += '<div class="access-card ' + escapeHtml(access.status) + '">'
        + '<div class="access-card-header">'
        + '<div class="access-card-id">' + escapeHtml(accessId) + '</div>'
        + '<div class="access-status-badge ' + escapeHtml(access.status) + '">'
        + (statusIcons[access.status] || '') + ' ' + (statusLabels[access.status] || access.status)
        + '</div>'
        + '</div>'
        + '<div class="access-card-info">'
        + '<div class="access-info-row"><strong>Nom:</strong> ' + escapeHtml(access.member_name || '—') + '</div>'
        + '<div class="access-info-row"><strong>Entreprise:</strong> ' + escapeHtml(access.company || '—') + '</div>'
        + '<div class="access-info-row"><strong>Créé le:</strong> ' + escapeHtml(formatDate(access.created_at)) + '</div>'
        + (access.activated_at ? '<div class="access-info-row"><strong>Activé le:</strong> ' + escapeHtml(formatDate(access.activated_at)) + '</div>' : '')
        + '</div>'
        + '<div class="access-card-actions">';

      if (access.status === 'pending') {
        html += '<button class="access-btn copy" type="button" onclick="window.TeamManagerMobile.copyAccessId(\'' + accessId.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + '\')">'
          + 'Copier l\'ID'
          + '</button>';
      }

      if (access.status !== 'revoked') {
        html += '<button class="access-btn revoke" type="button" onclick="window.TeamManagerMobile.revokeAccess(\'' + accessId.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + '\')">'
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
  var activeCount = generatedAccesses.filter(function (a) {
    return a.status === 'active' || a.status === 'pending';
  }).length;

  if (activeCount >= 10) {
    toast('Limite atteinte : 10 accès maximum');
    return;
  }

  var firstnameEl = document.getElementById('new-access-firstname');
  var lastnameEl = document.getElementById('new-access-lastname');
  var companyEl = document.getElementById('new-access-company');
  var previewEl = document.getElementById('new-access-preview');
  var createBtnEl = document.getElementById('create-access-btn');

  if (firstnameEl) firstnameEl.value = '';
  if (lastnameEl) lastnameEl.value = '';
  if (companyEl) companyEl.value = window.user?.company_name || '';
  if (previewEl) previewEl.textContent = '@' + (window.user?.company_name || 'Entreprise');
  if (createBtnEl) {
    createBtnEl.disabled = false;
    createBtnEl.textContent = "Créer l'accès";
  }

  openSheet('create-access-sheet');
}

function updateAccessPreview() {
  var firstname = document.getElementById('new-access-firstname')?.value.trim() || '';
  var lastname = document.getElementById('new-access-lastname')?.value.trim() || '';
  var company = document.getElementById('new-access-company')?.value.trim() || 'Entreprise';
  var preview = (firstname && lastname)
    ? (firstname + lastname + '@' + company)
    : ('@' + company);

  var previewEl = document.getElementById('new-access-preview');
  if (previewEl) previewEl.textContent = preview;
}

async function copyAccessId(accessId) {
  try {
    await navigator.clipboard.writeText(accessId);
    toast('📋 ID copié : ' + accessId);
  } catch (e) {
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

  if (!window.MemberAccessManager || !window.MemberAccessManager.revokeMemberAccess) {
    toast("Fonction de révocation non disponible");
    return;
  }

  const ok = await window.MemberAccessManager.revokeMemberAccess(accessId);

  if (ok) {
    await loadGeneratedAccesses();
    renderAccessManagement();
  }
}

/* ═══════════════════════════════════════════════════════════
   RENDU MEMBRES / ACTIVITÉ
═══════════════════════════════════════════════════════════ */
function renderTeamMembers() {
  var container = document.getElementById('team-members-view');
  if (!container) return;

  var teamLoading = document.getElementById('team-loading');
  if (teamLoading) teamLoading.style.display = 'none';

  if (!teamMembers.length) {
    container.innerHTML = '<div class="team-empty"><div class="team-empty-icon">👥</div><h3>Aucun commercial</h3><p>Créez des accès pour votre équipe dans l\'onglet "Accès".</p></div>';
    return;
  }

  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }

  teamMembers.forEach(function (member) {
    var pipeline = teamMembersPipeline[member.uid] || [];
    var cntP = pipeline.filter(function (p) { return p.status === 'prospection'; }).length;
    var cntN = pipeline.filter(function (p) { return p.status === 'negociation'; }).length;
    var cntC = pipeline.filter(function (p) { return p.status === 'conclue'; }).length;
    var initials = ((member.name || member.email || '?')
      .split(' ')
      .map(function (w) { return w[0] || ''; })
      .join('')
      .slice(0, 2)).toUpperCase();

    var card = document.createElement('div');
    card.className = 'member-card';
    card.id = 'member-' + member.uid;

    var recentItems = pipeline.slice(0, 5);
    var pipelineHTML = recentItems.length
      ? recentItems.map(function (p) {
          return '<div class="mpip-item ' + escapeHtml(p.status || 'prospection') + '">'
            + '<span class="mpip-item-name">' + escapeHtml(p.company_name || '—') + '</span>'
            + '<span class="mpip-item-status ' + escapeHtml(p.status || 'prospection') + '">' + escapeHtml(statusLabel(p.status)) + '</span>'
            + '</div>';
        }).join('')
      : '<div style="font-size:12px;color:var(--text-tertiary);padding:4px 0">Aucun prospect assigné</div>';

    var uidEsc = member.uid.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    card.innerHTML = '<div class="member-head" onclick="window.TeamManagerMobile.toggleMemberCard(\'' + uidEsc + '\')">'
      + '<div class="member-av">' + escapeHtml(initials) + '</div>'
      + '<div class="member-info">'
      + '<div class="member-name">' + escapeHtml(member.name || 'Sans nom') + '</div>'
      + '<div class="member-email">' + escapeHtml(member.email || '') + '</div>'
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

function buildActivityFeed() {
  activityFeed = [];

  teamMembers.forEach(function (member) {
    var pipeline = teamMembersPipeline[member.uid] || [];

    pipeline.forEach(function (p) {
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

  activityFeed.sort(function (a, b) {
    return new Date(b.date) - new Date(a.date);
  });
}

function renderActivityFeed() {
  var container = document.getElementById('team-activity-view');
  var loader = document.getElementById('activity-loading');

  if (loader) loader.style.display = 'none';
  if (!container) return;

  container.innerHTML = '';

  if (!activityFeed.length) {
    container.innerHTML = '<div class="team-empty"><div class="team-empty-icon">⚡</div><h3>Aucune activité</h3><p>L\'activité de votre équipe apparaît ici en temps réel.</p></div>';
    return;
  }

  activityFeed.slice(0, 30).forEach(function (item) {
    var icons = { prospection: '🎯', negociation: '🤝', conclue: '✅' };
    var dateStr = '';

    try {
      dateStr = new Date(item.date).toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (e) {}

    var el = document.createElement('div');
    el.className = 'activity-item';
    el.innerHTML = '<div class="activity-dot-wrap"><div class="activity-dot ' + escapeHtml(item.status) + '"></div></div>'
      + '<div class="activity-body">'
      + '<div class="activity-text"><strong>' + escapeHtml(item.memberName) + '</strong> — '
      + (icons[item.status] || '') + ' <strong>' + escapeHtml(item.company) + '</strong> en '
      + escapeHtml(statusLabel(item.status)) + '</div>'
      + (item.note
          ? '<div style="font-size:12px;color:var(--text-secondary);margin-top:3px;font-style:italic">' + escapeHtml(item.note.slice(0, 80)) + (item.note.length > 80 ? '...' : '') + '</div>'
          : '')
      + '<div class="activity-meta">' + escapeHtml(dateStr) + '</div>'
      + '</div>';

    container.appendChild(el);
  });
}

/* ═══════════════════════════════════════════════════════════
   EVENTS
═══════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', function () {
  var backToLoginLink = document.getElementById('back-to-login-link');
  if (backToLoginLink) {
    backToLoginLink.addEventListener('click', function (e) {
      e.preventDefault();
      backToLoginForm();
    });
  }

  var activateAccessBtn = document.getElementById('activate-access-btn');
  if (activateAccessBtn) {
    activateAccessBtn.addEventListener('click', activateMemberAccess);
  }

  var firstnameEl = document.getElementById('new-access-firstname');
  var lastnameEl = document.getElementById('new-access-lastname');
  var companyEl = document.getElementById('new-access-company');

  if (firstnameEl) firstnameEl.addEventListener('input', updateAccessPreview);
  if (lastnameEl) lastnameEl.addEventListener('input', updateAccessPreview);
  if (companyEl) companyEl.addEventListener('input', updateAccessPreview);

  var _baseShowApp = window.showApp;
  if (typeof _baseShowApp === 'function') {
    window.showApp = function () {
      _baseShowApp();
      applyManagerRole();
      if (window.user && window.user.role === 'manager') {
        setTimeout(async function () {
          await loadTeamData();
          await loadGeneratedAccesses();
          if (currentTeamSeg === 'access') renderAccessManagement();
        }, 800);
      }
    };
  }

  var _baseSwitchTab2 = window.switchTab2;
  if (typeof _baseSwitchTab2 === 'function') {
    window.switchTab2 = function (name) {
      _baseSwitchTab2(name);
      if (name === 'team' && window.user && window.user.role === 'manager') {
        if (!teamMembers.length) loadTeamData();
        loadGeneratedAccesses().then(function () {
          if (currentTeamSeg === 'access') renderAccessManagement();
        });
      }
    };
  }
});

/* ═══════════════════════════════════════════════════════════
   EXPORT GLOBAL
═══════════════════════════════════════════════════════════ */
window.TeamManagerMobile = {
  openSheet,
  closeSheet,
  switchToActivationFlow,
  backToLoginForm,
  activateMemberAccess,
  applyManagerRole,
  switchTeamSeg,
  refreshTeamData,
  loadTeamData,
  loadGeneratedAccesses,
  renderAccessManagement,
  openCreateAccessSheet,
  updateAccessPreview,
  copyAccessId,
  revokeAccess,
  showMemberActivationFlow: switchToActivationFlow,
  renderTeamMembers,
  toggleMemberCard,
  buildActivityFeed,
  renderActivityFeed
};