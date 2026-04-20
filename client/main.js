const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const path = require('path');
const https = require('https');
const http = require('http');
const fs = require('fs');

let mainWindow;
const UPDATE_CHANNEL = 'update-status';

const TOKEN_FILE = path.join(app.getPath('userData'), 'auth_token.txt');
const SERVER_FILE = path.join(app.getPath('userData'), 'server_url.txt');
const DEFAULT_SERVER = 'https://sales-companion-production.up.railway.app';

function sendUpdateStatus(channel, payload) {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send(channel, payload);
  }
}

function setupAutoUpdater() {
  autoUpdater.logger = log;
  autoUpdater.logger.transports.file.level = 'info';
  autoUpdater.autoDownload = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('🔄 Checking for updates...');
    sendUpdateStatus(UPDATE_CHANNEL, { status: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    console.log('⬇️ Update disponible:', info.version);
    sendUpdateStatus(UPDATE_CHANNEL, { status: 'available', version: info.version });
  });

  autoUpdater.on('update-not-available', () => {
    console.log('✅ Pas de mise à jour disponible.');
    sendUpdateStatus(UPDATE_CHANNEL, { status: 'not-available' });
  });

  autoUpdater.on('download-progress', (progress) => {
    const progressPayload = {
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond,
    };
    console.log(`📥 Téléchargement ${progressPayload.percent}%`);
    sendUpdateStatus(UPDATE_CHANNEL, { status: 'downloading', progress: progressPayload });
  });

  autoUpdater.on('update-downloaded', () => {
    console.log('✅ Mise à jour téléchargée, installation en cours...');
    sendUpdateStatus(UPDATE_CHANNEL, { status: 'downloaded' });
    setTimeout(() => {
      autoUpdater.quitAndInstall();
    }, 2000);
  });

  autoUpdater.on('error', (err) => {
    console.error('❌ Auto-update error:', err == null ? 'unknown' : err.message);
    sendUpdateStatus(UPDATE_CHANNEL, { status: 'error', message: err?.message || String(err) });
  });
}

/* ─────────────────────────────────────────────
   WINDOW
───────────────────────────────────────────── */
function createWindow() {
  console.log(`📡 Server URL: ${getServerUrl()}`);
  console.log(`🌍 Default Server: ${DEFAULT_SERVER}`);
  console.log(`💾 Config File: ${SERVER_FILE}`);
  
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 780,
    minWidth: 1000,
    minHeight: 640,
    title: 'Sales Companion',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#f0f2f5',
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // fallback si bug affichage
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  }, 3000);

  // sécurise ouverture externe
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      if (['http:', 'https:'].includes(u.protocol)) {
        shell.openExternal(url);
      }
    } catch {
      console.error('Blocked external URL:', url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/* ─────────────────────────────────────────────
   STORAGE
───────────────────────────────────────────── */
function getServerUrl() {
  try {
    if (fs.existsSync(SERVER_FILE)) {
      return fs.readFileSync(SERVER_FILE, 'utf8').trim();
    }
  } catch {}
  return DEFAULT_SERVER;
}

ipcMain.handle('get-token', () => {
  try {
    return fs.existsSync(TOKEN_FILE)
      ? fs.readFileSync(TOKEN_FILE, 'utf8').trim()
      : '';
  } catch {
    return '';
  }
});

ipcMain.handle('save-token', (_, token) => {
  fs.writeFileSync(TOKEN_FILE, token, { encoding: 'utf8', mode: 0o600 });
  return true;
});

ipcMain.handle('clear-token', () => {
  try {
    if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE);
  } catch {}
  return true;
});

ipcMain.handle('get-server-url', () => getServerUrl());

ipcMain.handle('save-server-url', (_, url) => {
  try {
    new URL(url); // validation
    fs.writeFileSync(SERVER_FILE, url, 'utf8');
    return true;
  } catch {
    throw new Error('URL invalide');
  }
});

ipcMain.handle('open-external', (_, url) => {
  try {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error();
    shell.openExternal(url);
    return true;
  } catch {
    throw new Error('URL bloquée');
  }
});

/* ─────────────────────────────────────────────
   HTTP CORE
───────────────────────────────────────────── */
function buildHeaders(bodyStr, token) {
  const headers = {};
  if (bodyStr) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(bodyStr);
  }
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

function request(serverUrl, method, reqPath, body, token) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(serverUrl + reqPath);
      const lib = url.protocol === 'https:' ? https : http;

      const bodyStr = body ? JSON.stringify(body) : '';
      const headers = buildHeaders(bodyStr, token);

      const opts = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers,
        // Tolérer les certificats non valides (nécessaire pour certains environnements)
        rejectUnauthorized: false,
        // Permettre les connexions Keep-Alive
        agent: url.protocol === 'https:' ? new (require('https').Agent)({ keepAlive: true, rejectUnauthorized: false }) : undefined,
      };

      const req = lib.request(opts, (res) => {
        let data = '';

        res.on('data', (chunk) => (data += chunk));

        res.on('end', () => {
          let parsed;

          try {
            parsed = data ? JSON.parse(data) : {};
          } catch {
            parsed = { raw: data };
          }

          if (res.statusCode >= 400) {
            const errorMessage = parsed?.error || parsed?.message || `Erreur HTTP ${res.statusCode}`;
            return reject(
              new Error(`${errorMessage} (HTTP ${res.statusCode})`)
            );
          }

          resolve({
            status: res.statusCode,
            data: parsed,
          });
        });
      });

      req.on('error', (err) => {
        console.error('❌ Network error:', err.message, err.code);
        // Retourner le vrai message d'erreur pour le diagnostic
        reject(new Error(`Erreur réseau: ${err.message} (${err.code})`));
      });

      req.setTimeout(15000, () => {
        req.destroy();
        console.error('❌ Request timeout');
        reject(new Error('Timeout serveur (15s)'));
      });

      if (bodyStr) req.write(bodyStr);
      req.end();
    } catch (err) {
      console.error('❌ Request error:', err);
      reject(err);
    }
  });
}

// retry automatique
async function requestWithRetry(...args) {
  for (let i = 0; i < 3; i++) {
    try {
      return await request(...args);
    } catch (err) {
      console.log(`⚠️  Tentative ${i + 1}/3 échouée:`, err.message);
      if (i === 2) {
        console.error('❌ Tous les essais ont échoué');
        throw err;
      }
      // Attendre avant de réessayer
      await new Promise(r => setTimeout(r, 500 * (i + 1)));
    }
  }
}

/* ─────────────────────────────────────────────
   AUTH
───────────────────────────────────────────── */
ipcMain.handle('login', (_, p) => {
  const serverUrl = p.serverUrl || getServerUrl();
  console.log(`🔐 Login attempt with server: ${serverUrl}`);
  return requestWithRetry(serverUrl, 'POST', '/auth/login', {
    email: p.email,
    password: p.password,
  });
});

ipcMain.handle('register', (_, p) => {
  const serverUrl = p.serverUrl || getServerUrl();
  console.log(`📝 Register attempt with server: ${serverUrl}`);
  return requestWithRetry(serverUrl, 'POST', '/auth/register', {
    name: p.name,
    email: p.email,
    password: p.password,
  });
});

ipcMain.handle('get-me', async (_, payload) => {
  const serverUrl = payload && payload.serverUrl ? payload.serverUrl : getServerUrl();
  const token = payload && typeof payload === 'object' ? payload.token : payload;
  
  try {
    const res = await requestWithRetry(serverUrl, 'GET', '/auth/me', null, token);
    
    // Si 401 → token expiré, on ne peut pas le rafraîchir côté main process
    // Retourner une erreur claire pour que le renderer redemande le login
    if (res.status === 401) {
      throw new Error('Token expiré — reconnexion requise');
    }
    
    return res;
  } catch (error) {
    if (error.message.includes('Token expiré')) {
      throw error;
    }
    throw new Error(`Impossible de récupérer le profil: ${error.message}`);
  }
});

/* ─────────────────────────────────────────────
   SEARCH & CHAT
───────────────────────────────────────────── */
ipcMain.handle('search', (_, p) => {
  const serverUrl = p.serverUrl || getServerUrl();
  console.log(`🔍 Search with server: ${serverUrl}`);
  return requestWithRetry(
    serverUrl,
    'POST',
    '/api/search',
    {
      query: p.query,
      filters: p.filters,
      use_ai: p.use_ai,
    },
    p.token
  );
});

ipcMain.handle('chat', (_, p) => {
  const serverUrl = p.serverUrl || getServerUrl();
  console.log(`💬 Chat with server: ${serverUrl}`);
  return requestWithRetry(
    serverUrl,
    'POST',
    '/api/chat',
    { messages: p.messages },
    p.token
  );
});

/* ─────────────────────────────────────────────
   SUPPORT MESSAGING
───────────────────────────────────────────── */
ipcMain.handle('supportMessages', (_, method, token) => {
  const serverUrl = getServerUrl();
  console.log(`📧 Support messages [${method}] with server: ${serverUrl}`);
  if (method === 'GET') {
    return requestWithRetry(serverUrl, 'GET', '/api/support/messages/user', null, token);
  }
});

ipcMain.handle('createSupportMessage', (_, p) => {
  const serverUrl = getServerUrl();
  console.log(`📨 Creating support message with server: ${serverUrl}`);
  return requestWithRetry(
    serverUrl,
    'POST',
    '/api/support/messages',
    { subject: p.subject, message: p.message },
    p.token
  );
});

/* ─────────────────────────────────────────────
   SAVED SEARCHES
───────────────────────────────────────────── */
ipcMain.handle('save-search', (_, token, data) =>
  requestWithRetry(getServerUrl(), 'POST', '/api/saved-searches', data, token)
);

ipcMain.handle('load-saved-searches', (_, token) =>
  requestWithRetry(getServerUrl(), 'GET', '/api/saved-searches', null, token)
);

ipcMain.handle('delete-saved-search', (_, token, id) =>
  requestWithRetry(
    getServerUrl(),
    'DELETE',
    `/api/saved-searches/${id}`,
    null,
    token
  )
);

/* ─────────────────────────────────────────────
   PIPELINE
───────────────────────────────────────────── */
ipcMain.handle('pipeline', (_, method, token, id, data) => {
  const url = getServerUrl();
  console.log(`📋 Pipeline [${method}] with server: ${url}`);

  if (method === 'GET')
    return requestWithRetry(url, 'GET', '/api/pipeline', null, token);

  if (method === 'POST')
    return requestWithRetry(url, 'POST', '/api/pipeline', data, token);

  if (method === 'PUT')
    return requestWithRetry(
      url,
      'PUT',
      `/api/pipeline/${id}`,
      data,
      token
    );

  if (method === 'DELETE')
    return requestWithRetry(
      url,
      'DELETE',
      `/api/pipeline/${id}`,
      null,
      token
    );
});

/* ─────────────────────────────────────────────
   MENU
───────────────────────────────────────────── */
const menuTemplate = [
  {
    label: 'Fichier',
    submenu: [
      {
        label: 'Nouvelle session',
        accelerator: 'CmdOrCtrl+N',
        click: () => mainWindow.reload(),
      },
      {
        label: 'Se déconnecter',
        click: () => mainWindow.webContents.send('logout'),
      },
      { type: 'separator' },
      {
        label: 'Quitter',
        accelerator: 'Alt+F4',
        click: () => app.quit(),
      },
    ],
  },
  {
    label: 'Affichage',
    submenu: [
      {
        label: 'Recharger',
        accelerator: 'CmdOrCtrl+R',
        click: () => mainWindow.reload(),
      },
      {
        label: 'Plein écran',
        accelerator: 'F11',
        click: () =>
          mainWindow.setFullScreen(!mainWindow.isFullScreen()),
      },
      { type: 'separator' },
      {
        label: 'Zoom +',
        accelerator: 'CmdOrCtrl+Plus',
        click: () =>
          mainWindow.webContents.setZoomLevel(
            mainWindow.webContents.getZoomLevel() + 0.5
          ),
      },
      {
        label: 'Zoom -',
        accelerator: 'CmdOrCtrl+-',
        click: () =>
          mainWindow.webContents.setZoomLevel(
            mainWindow.webContents.getZoomLevel() - 0.5
          ),
      },
      {
        label: 'Taille normale',
        accelerator: 'CmdOrCtrl+0',
        click: () => mainWindow.webContents.setZoomLevel(0),
      },
    ],
  },
];

/* ─────────────────────────────────────────────
   APP LIFECYCLE
───────────────────────────────────────────── */
app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
  createWindow();
  setupAutoUpdater();
  autoUpdater.checkForUpdatesAndNotify();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});