/**
 * Sales Companion Client - URL Configuration
 * For Electron and desktop app routing
 */

const CLIENT_URLS = {
  api: process.env.REACT_APP_API_URL || 'http://localhost:3210/api',
  
  pages: {
    search: '/search',
    pipeline: '/pipeline',
    saved: '/saved',
    chat: '/chat',
    settings: '/settings',
    profile: '/profile',
  },
  
  // Get page URL
  getPage: (pageName) => CLIENT_URLS.pages[pageName] || '/',
  
  // Get API endpoint
  getApi: (endpoint) => {
    const base = process.env.REACT_APP_API_URL || 'http://localhost:3210/api';
    return `${base}/${endpoint}`;
  }
};

module.exports = CLIENT_URLS;
