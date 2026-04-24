/**
 * Script pour réinitialiser l'admin et corriger le dashboard
 * Supprime l'admin existant et en crée un nouveau
 */

const admin = require('firebase-admin');
const { getFirestore, initializeApp } = require('firebase-admin');
require('dotenv').config();

// Initialiser Firebase Admin
const serviceAccount = require('./firebase-config').default;

try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
} catch (err) {
  console.log('Firebase déjà initialisé (dev mode)');
}

const auth = admin.auth();
const db = admin.firestore();

const ADMIN_EMAIL = 'admin@sales-companion.local';
const ADMIN_PASSWORD = 'admin123';

async function resetAdmin() {
  try {
    console.log('🔧 Réinitialisation de l\'admin\n');
    
    // 1. Trouver et supprimer l'admin existant
    console.log('📋 Étape 1: Vérifier les admins existants');
    const allUsers = await auth.listUsers();
    let adminToDelete = null;
    
    for (const user of allUsers.users) {
      if (user.customClaims?.admin === true) {
        adminToDelete = user;
        console.log(`✅ Admin trouvé: ${user.email} (${user.uid})`);
      }
    }
    
    if (adminToDelete) {
      console.log(`\n📋 Étape 2: Supprimer l'admin existant`);
      try {
        await auth.deleteUser(adminToDelete.uid);
        await db.collection('users').doc(adminToDelete.uid).delete();
        console.log(`✅ Admin supprimé: ${adminToDelete.email}`);
      } catch (err) {
        console.log(`⚠️  Erreur lors de la suppression: ${err.message}`);
      }
    }
    
    // 2. Créer un nouvel admin
    console.log(`\n📋 Étape 3: Créer un nouvel admin`);
    try {
      const adminUser = await auth.createUser({
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        displayName: 'Admin',
      });
      
      // Ajouter le claim admin
      await auth.setCustomUserClaims(adminUser.uid, { admin: true });
      
      // Créer l'enregistrement Firestore
      await db.collection('users').doc(adminUser.uid).set({
        uid: adminUser.uid,
        email: ADMIN_EMAIL,
        name: 'Admin',
        role: 'admin',
        plan: 'enterprise',
        dailyLimit: 9999,
        dailyUsed: 0,
        active: true,
        createdAt: new Date().toISOString(),
      });
      
      console.log(`✅ Nouvel admin créé`);
      console.log(`   Email: ${ADMIN_EMAIL}`);
      console.log(`   Password: ${ADMIN_PASSWORD}`);
      console.log(`   UID: ${adminUser.uid}`);
    } catch (err) {
      if (err.code === 'auth/email-already-exists') {
        console.log(`⚠️  L'email existe déjà. Tentative de mise à jour du mot de passe...`);
        // Trouver l'utilisateur et changer son mot de passe
        const userByEmail = await auth.getUserByEmail(ADMIN_EMAIL);
        await auth.updateUser(userByEmail.uid, { password: ADMIN_PASSWORD });
        await auth.setCustomUserClaims(userByEmail.uid, { admin: true });
        console.log(`✅ Admin réinitialisé`);
      } else {
        throw err;
      }
    }
    
    // 3. Vérifier les collections Firestore
    console.log(`\n📋 Étape 4: Vérifier les collections Firestore`);
    
    const collections = ['users', 'companies', 'usage_logs', 'config'];
    for (const col of collections) {
      const snap = await db.collection(col).limit(1).get();
      console.log(`   📊 ${col}: ${snap.size > 0 ? '✅ OK' : '⚠️  Vide'}`);
    }
    
    console.log(`\n✨ Réinitialisation terminée`);
    console.log(`\n🌐 Accédez au panel admin:`);
    console.log(`   http://localhost:3210/admin`);
    console.log(`   Email: ${ADMIN_EMAIL}`);
    console.log(`   Password: ${ADMIN_PASSWORD}`);
    
  } catch (error) {
    console.error(`\n❌ Erreur: ${error.message}`);
    if (error.code === 'app/invalid-credential') {
      console.error('💡 Problème: Firebase ne peut pas initialiser (pas de credentials)');
      console.error('   → Vérifiez le fichier firebase-config.js');
      console.error('   → Vérifiez les variables d\'environnement .env');
    }
  }
  
  process.exit(0);
}

resetAdmin();
