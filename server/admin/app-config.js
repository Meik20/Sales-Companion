/**
 * Sales Companion Admin - URL Configuration
 * For admin dashboard routing and API access
 */

// Environment detection
const ADMIN_ENV = {
  isLocal: window.location.hostname === 'localhost' || 
           window.location.hostname.startsWith('192.168'),
  isDev: window.location.hostname === 'localhost',
  isProduction: window.location.hostname !== 'localhost' && 
                !window.location.hostname.startsWith('192.168'),
  origin: window.location.origin
};

// URL configuration
const ADMIN_URLS = {
  // App sections
  landing: `${ADMIN_ENV.origin}/landing.html`,
  mobile: `${ADMIN_ENV.origin}/mobile`,
  admin: `${ADMIN_ENV.origin}/admin`,
  home: ADMIN_ENV.origin + '/',
  
  // API base
  api: ADMIN_ENV.isLocal ? 
    'http://192.168.1.139:3210/api' : 
    `${ADMIN_ENV.origin}/api`,
  
  // Admin specific endpoints
  users: (ADMIN_ENV.isLocal ? 'http://192.168.1.139:3210' : ADMIN_ENV.origin) + '/api/users',
  companies: (ADMIN_ENV.isLocal ? 'http://192.168.1.139:3210' : ADMIN_ENV.origin) + '/api/companies',
  stats: (ADMIN_ENV.isLocal ? 'http://192.168.1.139:3210' : ADMIN_ENV.origin) + '/api/stats',
  settings: (ADMIN_ENV.isLocal ? 'http://192.168.1.139:3210' : ADMIN_ENV.origin) + '/api/settings',
  
  // Navigation functions
  navigateTo: (section) => {
    const urls = {
      'mobile': ADMIN_URLS.mobile,
      'landing': ADMIN_URLS.landing,
      'admin': ADMIN_URLS.admin,
      'home': ADMIN_URLS.home
    };
    if (urls[section]) {
      window.location.href = urls[section];
    }
  },
  
  // Get API endpoint
  getApi: (endpoint) => {
    const endpoints = {
      'users': ADMIN_URLS.users,
      'companies': ADMIN_URLS.companies,
      'stats': ADMIN_URLS.stats,
      'settings': ADMIN_URLS.settings
    };
    return endpoints[endpoint] || ADMIN_URLS.api + '/' + endpoint;
  }
};

console.log('[Admin Config] Environment:', {
  isLocal: ADMIN_ENV.isLocal,
  isDev: ADMIN_ENV.isDev,
  isProduction: ADMIN_ENV.isProduction,
  origin: ADMIN_ENV.origin
});

console.log('[Admin Config] URLs:', {
  landing: ADMIN_URLS.landing,
  mobile: ADMIN_URLS.mobile,
  api: ADMIN_URLS.api
});
