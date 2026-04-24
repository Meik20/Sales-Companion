/**
 * Script de diagnostic et correction du tableau de bord admin
 * Initialise l'admin et vérifie que le dashboard peut charger les données
 */

const http = require('http');
const https = require('https');
require('dotenv').config();

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3210';
const ADMIN_EMAIL = 'admin@sales-companion.local';
const ADMIN_PASSWORD = 'admin123';

console.log('🔧 Diagnostic du tableau de bord admin');
console.log(`📍 Serveur: ${SERVER_URL}\n`);

// Utilitaire pour faire des requêtes HTTP/HTTPS
function makeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, SERVER_URL);
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;
    
    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      },
    };
    
    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: data ? JSON.parse(data) : null,
            rawBody: data,
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: null,
            rawBody: data,
          });
        }
      });
    });
    
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runDiagnostics() {
  try {
    console.log('📋 ÉTAPE 1: Initialiser l\'utilisateur admin');
    console.log('─'.repeat(50));
    
    // Étape 1: Initialiser l'admin
    const initRes = await makeRequest('POST', '/init-admin', {
      adminEmail: ADMIN_EMAIL,
      adminPassword: ADMIN_PASSWORD,
    });
    
    if (initRes.status === 400 && initRes.body?.error?.includes('existe déjà')) {
      console.log('✅ Admin existe déjà');
    } else if (initRes.status === 200) {
      console.log('✅ Admin créé avec succès');
      console.log(`   Email: ${initRes.body?.email}`);
      console.log(`   UID: ${initRes.body?.uid}\n`);
    } else {
      console.log(`⚠️ Problème lors de l'initialisation: ${initRes.status}`);
      console.log(`   ${initRes.body?.error || initRes.rawBody}\n`);
    }
    
    console.log('📋 ÉTAPE 2: Se connecter en tant qu\'admin');
    console.log('─'.repeat(50));
    
    // Étape 2: Se connecter
    const loginRes = await makeRequest('POST', '/admin/login', {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });
    
    if (loginRes.status !== 200) {
      console.log(`❌ Erreur de connexion: ${loginRes.status}`);
      console.log(`   ${loginRes.body?.error || loginRes.rawBody}\n`);
      return;
    }
    
    const token = loginRes.body?.token;
    const refreshToken = loginRes.body?.refreshToken;
    
    console.log('✅ Connexion réussie');
    console.log(`   User: ${loginRes.body?.user?.email}`);
    console.log(`   Role: ${loginRes.body?.user?.role}`);
    console.log(`   Token reçu: ${token ? '✅' : '❌'}\n`);
    
    console.log('📋 ÉTAPE 3: Récupérer les stats du dashboard');
    console.log('─'.repeat(50));
    
    // Étape 3: Appeler /admin/stats avec le token
    const options = {
      hostname: new URL(SERVER_URL).hostname,
      port: new URL(SERVER_URL).port || 80,
      path: '/admin/stats',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    };
    
    const statsRes = await new Promise((resolve, reject) => {
      const isHttps = SERVER_URL.startsWith('https');
      const client = isHttps ? https : http;
      
      const req = client.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            body: data ? JSON.parse(data) : null,
            rawBody: data,
          });
        });
      });
      req.on('error', reject);
      req.end();
    });
    
    if (statsRes.status !== 200) {
      console.log(`❌ Erreur lors de la récupération des stats: ${statsRes.status}`);
      console.log(`   ${statsRes.body?.error || statsRes.rawBody}\n`);
      return;
    }
    
    console.log('✅ Stats récupérées avec succès');
    const stats = statsRes.body;
    console.log(`   👥 Utilisateurs: ${stats.totalUsers}`);
    console.log(`   🏢 Entreprises: ${stats.totalCompanies}`);
    console.log(`   📊 Recherches aujourd'hui: ${stats.activeToday}`);
    console.log(`   📈 Total recherches: ${stats.totalSearches}`);
    console.log(`   🗺️  Régions trouvées: ${(stats.companiesByRegion || []).length}`);
    console.log(`   🏭 Secteurs trouvés: ${(stats.companiesBySecteur || []).length}\n`);
    
    console.log('📋 ÉTAPE 4: Vérifier les données');
    console.log('─'.repeat(50));
    
    if (stats.totalCompanies === 0) {
      console.log('⚠️  La base de données est vide (0 entreprises)');
      console.log('    → Importez un fichier Excel/CSV via le panel admin');
      console.log('    → Ou utilisez l\'endpoint POST /admin/import\n');
    } else {
      console.log(`✅ ${stats.totalCompanies} entreprises en base\n`);
    }
    
    if (stats.totalUsers === 0) {
      console.log('⚠️  Aucun utilisateur enregistré');
      console.log('    → Les utilisateurs s\'inscrivent via l\'app\n');
    } else {
      console.log(`✅ ${stats.totalUsers} utilisateur(s) enregistré(s)\n`);
    }
    
    console.log('📋 RÉSUMÉ & RECOMMANDATIONS');
    console.log('─'.repeat(50));
    console.log('✅ Tableau de bord admin: OK');
    console.log('✅ Authentification admin: OK');
    console.log(`${stats.totalCompanies > 0 ? '✅' : '⚠️'} Données en base: ${stats.totalCompanies > 0 ? 'OK' : 'Vide - à importer'}`);
    console.log('\n🌐 Accédez au panel admin:');
    console.log(`   ${SERVER_URL}/admin`);
    console.log(`   Email: ${ADMIN_EMAIL}`);
    console.log(`   Password: ${ADMIN_PASSWORD}`);
    
  } catch (error) {
    console.error('❌ Erreur:', error.message);
    if (error.code === 'ECONNREFUSED') {
      console.error('\n💡 Le serveur n\'est pas accessible');
      console.error(`   Vérifiez que le serveur est lancé sur ${SERVER_URL}`);
      console.error('   Commande: cd server && npm start');
    }
  }
}

// Lancer le diagnostic
runDiagnostics().then(() => {
  console.log('\n✨ Diagnostic terminé\n');
  process.exit(0);
}).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
