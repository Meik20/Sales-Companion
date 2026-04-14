/**
 * Sales Companion - App URL Configuration
 * Centralized URL management for all app sections
 * Automatically adapts to environment (local, staging, production)
 */

// ── ENVIRONMENT DETECTION ─────────────────────────────────────
const APP_ENV = {
  isLocal: window.location.hostname === 'localhost' || 
           window.location.hostname.startsWith('192.168') ||
           window.location.hostname === '127.0.0.1',
  
  isDev: window.location.hostname === 'localhost',
  
  isProduction: window.location.hostname !== 'localhost' && 
                !window.location.hostname.startsWith('192.168'),
  
  hostname: window.location.hostname,
  protocol: window.location.protocol,
  origin: window.location.origin
};

// ── APP URLS ──────────────────────────────────────────────────
const APP_URLS = {
  // Base endpoints
  api: APP_ENV.isLocal ? 
    'http://192.168.1.139:3210/api' : 
    `${APP_ENV.origin}/api`,
  
  // App sections
  landing: `${APP_ENV.origin}/landing.html`,
  home: APP_ENV.origin + '/',
  mobile: `${APP_ENV.origin}/mobile`,
  admin: `${APP_ENV.origin}/admin`,
  
  // External
  github: 'https://github.com/Meik20/Sales-Companion',
  docs: `${APP_ENV.origin}/docs`,
  
  // API endpoints
  firebase: `${APP_ENV.isLocal ? 'http://192.168.1.139:3210' : APP_ENV.origin}/api/config/firebase`,
  health: `${APP_ENV.isLocal ? 'http://192.168.1.139:3210' : APP_ENV.origin}/api/health`,
  search: `${APP_ENV.isLocal ? 'http://192.168.1.139:3210' : APP_ENV.origin}/api/companies/search`,
  config: `${APP_ENV.isLocal ? 'http://192.168.1.139:3210' : APP_ENV.origin}/api/config`,
  usage: `${APP_ENV.isLocal ? 'http://192.168.1.139:3210' : APP_ENV.origin}/api/usage/log`,
  
  // Functions
  getPageUrl: (pageName) => {
    const pages = {
      'home': APP_URLS.home,
      'landing': APP_URLS.landing,
      'mobile': APP_URLS.mobile,
      'admin': APP_URLS.admin,
      'docs': APP_URLS.docs,
    };
    return pages[pageName] || APP_URLS.home;
  },
  
  // Get API endpoint based on path
  getApiUrl: (endpoint) => {
    const endpoints = {
      'firebase': APP_URLS.firebase,
      'health': APP_URLS.health,
      'search': APP_URLS.search,
      'config': APP_URLS.config,
      'usage': APP_URLS.usage,
    };
    return endpoints[endpoint] || APP_URLS.api + '/' + endpoint;
  }
};

// ── LOGGING ───────────────────────────────────────────────────
console.log('[App Config] Environment:', {
  isLocal: APP_ENV.isLocal,
  isDev: APP_ENV.isDev,
  isProduction: APP_ENV.isProduction,
  hostname: APP_ENV.hostname,
  origin: APP_ENV.origin
});

console.log('[App Config] URLs Loaded:', {
  landing: APP_URLS.landing,
  mobile: APP_URLS.mobile,
  admin: APP_URLS.admin,
  api: APP_URLS.api
});

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { APP_ENV, APP_URLS };
}
