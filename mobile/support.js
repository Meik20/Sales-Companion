/**
 * support.js — Sales Companion Mobile
 * Système de fils de discussion support
 * Fichier externe pour éviter les conflits de parsing HTML/JS
 */

(function () {
  'use strict';

  var currentThreadId  = null;
  var threadsListener  = null;
  var messagesListener = null;

  /* ── Utilitaire escape ── */
  function esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
  }

  function formatDate(ts) {
    if (!ts) return '';
    try {
      var d = ts.toDate ? ts.toDate() : new Date(ts);
      return d.toLocaleDateString('fr-FR', {
        day: '2-digit', month: 'short',
        hour: '2-digit', minute: '2-digit'
      });
    } catch (e) { return ''; }
  }

  function getDb() {
    return window._db || null;
  }

  function getUser() {
    return window.user || null;
  }

  function toast(msg) {
    if (typeof window.toast === 'function') { window.toast(msg); return; }
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast show';
    setTimeout(function () { el.className = 'toast'; }, 3000);
  }

  function openSheet(id) {
    if (typeof window.openSheet === 'function') { window.openSheet(id); return; }
    var s = document.getElementById(id);
    var o = document.getElementById(id.replace('-sheet', '-overlay'));
    if (o) o.classList.add('open');
    if (s) setTimeout(function () { s.classList.add('open'); }, 10);
  }

  function closeSheet(id) {
    if (typeof window.closeSheet === 'function') { window.closeSheet(id); return; }
    var s = document.getElementById(id);
    var o = document.getElementById(id.replace('-sheet', '-overlay'));
    if (s) s.classList.remove('open');
    if (o) o.classList.remove('open');
  }

  /* ══════════════════════════════════════════════
     CHARGER LES FILS (temps réel)
  ══════════════════════════════════════════════ */
  function loadSupportThreads() {
    var db   = getDb();
    var user = getUser();
    if (!db || !user) return;

    if (threadsListener) { threadsListener(); threadsListener = null; }

    var listEl = document.getElementById('support-threads-list');
    if (!listEl) return;
    listEl.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:40px 0;font-size:13px">Chargement...</div>';

    threadsListener = db.collection('support_threads')
      .where('userId', '==', user.uid)
      .orderBy('updatedAt', 'desc')
      .onSnapshot(function (snap) {
        if (snap.empty) {
          listEl.innerHTML =
            '<div style="display:flex;flex-direction:column;align-items:center;padding:40px 24px;text-align:center;color:var(--text-tertiary)">' +
            '<div style="font-size:40px;margin-bottom:12px;opacity:.3">💬</div>' +
            '<div style="font-size:14px;font-weight:600;margin-bottom:6px;color:var(--text-primary)">Aucune conversation</div>' +
            '<div style="font-size:13px">Démarrez une conversation avec notre équipe.</div>' +
            '</div>';
          return;
        }

        listEl.innerHTML = '';
        snap.docs.forEach(function (doc) {
          var t = doc.data();
          var statusColor = t.status === 'resolved' ? 'var(--green)'
                          : t.status === 'closed'   ? 'var(--text-tertiary)'
                          : 'var(--blue)';
          var statusLabel = t.status === 'resolved' ? '✅ Résolu'
                          : t.status === 'closed'   ? '🔒 Fermé'
                          : '💬 En cours';
          var unreadDot = t.unreadByUser
            ? '<span style="width:8px;height:8px;background:var(--red);border-radius:50%;display:inline-block;margin-left:6px;vertical-align:middle"></span>'
            : '';
          var dateStr = formatDate(t.updatedAt);
          var tid = doc.id;

          var card = document.createElement('div');
          card.style.cssText =
            'background:var(--bg-card);border:1.5px solid ' + (t.unreadByUser ? 'var(--primary)' : 'var(--border)') + ';' +
            'border-radius:var(--r-lg);padding:14px;margin-bottom:10px;cursor:pointer;' +
            'transition:all .2s;box-shadow:var(--shadow-card)';
          card.innerHTML =
            '<div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:8px;gap:8px">' +
              '<div style="font-size:14px;font-weight:700;flex:1;color:var(--text-primary)">' + esc(t.subject || '—') + unreadDot + '</div>' +
              '<div style="font-size:11px;font-weight:700;padding:3px 8px;border-radius:4px;' +
                'background:' + statusColor + '20;color:' + statusColor + ';white-space:nowrap;flex-shrink:0">' + statusLabel + '</div>' +
            '</div>' +
            '<div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;' +
              'overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(t.lastMessage || '') + '</div>' +
            '<div style="font-size:11px;color:var(--text-tertiary)">' + dateStr + '</div>';

          card.onclick = function () { openThread(tid, t); };
          listEl.appendChild(card);
        });
      }, function (err) {
        listEl.innerHTML = '<div style="text-align:center;color:var(--red);padding:20px;font-size:13px">Erreur : ' + esc(err.message) + '</div>';
      });
  }

  /* ══════════════════════════════════════════════
     OUVRIR UN FIL
  ══════════════════════════════════════════════ */
  function openThread(threadId, threadData) {
    currentThreadId = threadId;

    var threadsView = document.getElementById('support-threads-view');
    var detailView  = document.getElementById('support-thread-detail');
    if (threadsView) threadsView.style.display = 'none';
    if (detailView)  detailView.style.display  = 'flex';

    var subjectEl = document.getElementById('thread-detail-subject');
    var statusEl  = document.getElementById('thread-detail-status');
    if (subjectEl) subjectEl.textContent = threadData.subject || '—';
    if (statusEl) {
      var labels = { open: '💬 En cours', resolved: '✅ Résolu', closed: '🔒 Fermé' };
      statusEl.textContent = labels[threadData.status] || threadData.status;
    }

    var isResolved = threadData.status === 'resolved' || threadData.status === 'closed';
    var replyFooter    = document.getElementById('thread-reply-footer');
    var resolvedFooter = document.getElementById('thread-resolved-footer');
    if (replyFooter)    replyFooter.style.display    = isResolved ? 'none'  : 'block';
    if (resolvedFooter) resolvedFooter.style.display = isResolved ? 'block' : 'none';

    if (threadData.unreadByUser && getDb()) {
      getDb().collection('support_threads').doc(threadId)
        .update({ unreadByUser: false }).catch(function () {});
    }

    loadThreadMessages(threadId);
  }

  /* ══════════════════════════════════════════════
     MESSAGES TEMPS RÉEL
  ══════════════════════════════════════════════ */
  function loadThreadMessages(threadId) {
    var db = getDb();
    if (!db) return;

    if (messagesListener) { messagesListener(); messagesListener = null; }

    var listEl = document.getElementById('thread-messages-list');
    if (!listEl) return;
    listEl.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:20px;font-size:13px">Chargement...</div>';

    messagesListener = db.collection('support_threads').doc(threadId)
      .collection('messages')
      .orderBy('createdAt', 'asc')
      .onSnapshot(function (snap) {
        listEl.innerHTML = '';
        snap.docs.forEach(function (doc) {
          var m      = doc.data();
          var isUser = m.senderRole === 'user';
          var dateStr = '';
          try {
            dateStr = m.createdAt && m.createdAt.toDate
              ? m.createdAt.toDate().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
              : '';
          } catch (e) {}

          var bubble = document.createElement('div');
          bubble.style.cssText =
            'display:flex;flex-direction:column;align-items:' + (isUser ? 'flex-end' : 'flex-start') + ';margin-bottom:8px';

          var bg      = isUser ? 'linear-gradient(135deg,var(--primary),var(--primary-medium))' : 'var(--bg-card)';
          var color   = isUser ? '#fff' : 'var(--text-primary)';
          var border  = isUser ? 'none' : '1px solid var(--border)';
          var radius  = isUser ? '16px 4px 16px 16px' : '4px 16px 16px 16px';
          var sender  = isUser ? 'Vous' : '🎧 Support';

          bubble.innerHTML =
            '<div style="max-width:82%;padding:10px 14px;border-radius:' + radius + ';' +
              'background:' + bg + ';color:' + color + ';border:' + border + ';' +
              'font-size:13.5px;line-height:1.6;box-shadow:var(--shadow-xs)">' +
              esc(m.content || '') + '</div>' +
            '<div style="font-size:10px;color:var(--text-tertiary);margin-top:3px;padding:0 4px">' +
              sender + ' · ' + dateStr + '</div>';

          listEl.appendChild(bubble);
        });
        listEl.scrollTop = listEl.scrollHeight;
      });
  }

  /* ══════════════════════════════════════════════
     RETOUR À LA LISTE
  ══════════════════════════════════════════════ */
  function backToThreadsList() {
    if (messagesListener) { messagesListener(); messagesListener = null; }
    currentThreadId = null;

    var threadsView = document.getElementById('support-threads-view');
    var detailView  = document.getElementById('support-thread-detail');
    if (threadsView) threadsView.style.display = 'flex';
    if (detailView)  detailView.style.display  = 'none';
  }

  /* ══════════════════════════════════════════════
     NOUVEAU FIL
  ══════════════════════════════════════════════ */
  function openNewThreadSheet() {
    var s = document.getElementById('new-thread-subject');
    var m = document.getElementById('new-thread-message');
    if (s) s.value = '';
    if (m) m.value = '';
    openSheet('new-thread-sheet');
  }

  async function createSupportThread() {
    var subjectEl = document.getElementById('new-thread-subject');
    var messageEl = document.getElementById('new-thread-message');
    var subject   = subjectEl ? subjectEl.value.trim() : '';
    var message   = messageEl ? messageEl.value.trim() : '';

    if (!subject) { toast('Saisissez un sujet'); return; }
    if (!message) { toast('Saisissez un message'); return; }

    var db   = getDb();
    var user = getUser();
    if (!db || !user) { toast('Non connecté'); return; }

    var btns = document.querySelectorAll('#new-thread-sheet .sheet-btn');
    var btn  = btns[0];
    if (btn) { btn.disabled = true; btn.textContent = 'Envoi...'; }

    try {
      var now = firebase.firestore.FieldValue.serverTimestamp();

      var threadRef = await db.collection('support_threads').add({
        userId:        user.uid,
        userEmail:     user.email  || '',
        userName:      user.name   || '',
        subject:       subject,
        status:        'open',
        lastMessage:   message.slice(0, 80),
        unreadByUser:  false,
        unreadByAdmin: true,
        createdAt:     now,
        updatedAt:     now
      });

      await threadRef.collection('messages').add({
        content:    message,
        senderId:   user.uid,
        senderRole: 'user',
        createdAt:  now
      });

      closeSheet('new-thread-sheet');
      toast('Message envoyé ✅');
      openThread(threadRef.id, { subject: subject, status: 'open', unreadByUser: false });

    } catch (e) {
      toast('Erreur : ' + e.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Envoyer'; }
    }
  }

  /* ══════════════════════════════════════════════
     RÉPONDRE DANS UN FIL
  ══════════════════════════════════════════════ */
  async function sendThreadReply() {
    var input   = document.getElementById('thread-reply-input');
    var content = input ? input.value.trim() : '';
    if (!content)         { return; }
    if (!currentThreadId) { toast('Fil introuvable'); return; }

    var db   = getDb();
    var user = getUser();
    if (!db || !user) { toast('Non connecté'); return; }

    if (input) { input.value = ''; input.style.height = 'auto'; }

    try {
      var now = firebase.firestore.FieldValue.serverTimestamp();

      await db.collection('support_threads').doc(currentThreadId)
        .collection('messages').add({
          content:    content,
          senderId:   user.uid,
          senderRole: 'user',
          createdAt:  now
        });

      await db.collection('support_threads').doc(currentThreadId).update({
        lastMessage:   content.slice(0, 80),
        updatedAt:     now,
        unreadByAdmin: true,
        unreadByUser:  false
      });

    } catch (e) {
      toast('Erreur envoi : ' + e.message);
      if (input) input.value = content;
    }
  }

  /* ══════════════════════════════════════════════
     EXPOSITION GLOBALE
  ══════════════════════════════════════════════ */
  window.SupportManager = {
    loadSupportThreads:  loadSupportThreads,
    openThread:          openThread,
    backToThreadsList:   backToThreadsList,
    openNewThreadSheet:  openNewThreadSheet,
    createSupportThread: createSupportThread,
    sendThreadReply:     sendThreadReply
  };

  // Exposition directe pour les onclick inline
  window.loadSupportThreads  = loadSupportThreads;
  window.openThread          = openThread;
  window.backToThreadsList   = backToThreadsList;
  window.openNewThreadSheet  = openNewThreadSheet;
  window.createSupportThread = createSupportThread;
  window.sendThreadReply     = sendThreadReply;

})();