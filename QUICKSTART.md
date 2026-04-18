# 🚀 Firebase Integration — Quick Start

## 5 étapes pour démarrer

### 1️⃣ Créer un projet Firebase

1. https://console.firebase.google.com → **Créer un projet**
2. Nom: `sales-companion`
3. Accepter et créer

### 2️⃣ Télécharger les credentials

**Backend (Admin SDK):**
```
Paramètres → Comptes de service → Générer clé privée (JSON)
→ Sauvegarder dans: server/firebase-service-account.json
```

**Frontend (Web):**
```
Paramètres → Vos applications → Web → Copier config
→ Ajouter les valeurs dans le .env
```

### 3️⃣ Configurer Firestore & Auth

**Firestore:**
```
Firestore Database → Créer → Mode test → europe-west1
```

**Authentication:**
```
Authentication → Ajouter Email/Mot de passe
Authentication → Domaines autorisés → Ajouter:
  - localhost:3000
  - localhost:3210
  - 127.0.0.1:3210
  - [votre-ip-locale]:3210
```

### 4️⃣ Installer & configurer

```bash
# Backend
npm install

# Créer .env
cp .env.example .env
# Éditer .env avec vos credentials Firebase

# Démarrer le serveur
npm start
```

### 5️⃣ Déployer les règles Firestore

```bash
# Via Firebase Console:
Firestore → Règles → Copier les règles de FIREBASE-MIGRATION.md
```

---

## 📊 Structure Firestore (créée automatiquement)

```
users/{uid}                    → Profil utilisateur
companies/{id}                 → Entreprises (migrées)
config/{key}                   → Configuration
usage_logs/{id}                → Logs d'utilisation
saved_searches/{id}            → Recherches sauvegardées
users/{uid}/pipeline/{id}      → Pipeline prospect
```

---

## 🧪 Tester l'authentification

```bash
# Terminal 1: Démarrer le serveur
npm start

# Terminal 2: Tester l'inscription
curl -X POST http://localhost:3210/auth/sign-up \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Test123!","name":"Test User"}'

# Réponse:
# {"uid":"...", "email":"test@example.com"}
```

---

## 🔄 Migrer les données (si vous aviez une DB SQLite)

```bash
cd server
node migrate-sqlite-to-firestore.js
```

---

## 📱 Applications clients

### Desktop (Electron)
```bash
cd client
npm install
npm start
```

### Mobile PWA
```
http://localhost:3210/mobile
```

---

## ✅ Vérifier que tout fonctionne

- [ ] Serveur démarre (`node server-firebase.js`)
- [ ] `/health` répond `{status: "ok"}`
- [ ] Inscription possible (`/auth/sign-up`)
- [ ] Firestore a des documents `users/`, `companies/`
- [ ] Recherche fonctionne (`/api/companies/search`)
- [ ] Electron/Mobile peuvent se connecter

---

## 🔐 Credentials Sécurisés

**✅ À FAIRE:**
- Sauvegarder credentials en `.env` (non versionné)
- Ajouter `firebase-service-account.json` au `.gitignore`
- Utiliser Cloud Run Secrets pour production

**❌ À NE PAS FAIRE:**
- Push `firebase-service-account.json` sur GitHub
- Exposer les credentials dans le code frontend
- Utiliser les mêmes credentials en dev/prod

---

## 🚀 Déploiement Production

### Option 1: Docker + Cloud Run
```bash
cd server
docker build -t sales-companion .
docker run -e FIREBASE_PROJECT_ID=... sales-companion
```

### Option 2: Cloud Functions
```bash
firebase init functions
firebase deploy --only functions
```

---

## 📚 Docs compètes
- [`FIREBASE-MIGRATION.md`](./FIREBASE-MIGRATION.md) — Guide détaillé
- [`INTEGRATION-GUIDE.md`](./INTEGRATION-GUIDE.md) — Intégration du code existant
- [`server/firebase-config.js`](./server/firebase-config.js) — Config serveur
- [`client/firebase-helpers.js`](./client/firebase-helpers.js) — Helpers client

---

## 🆘 Support Rapide

| Problème | Solution |
|----------|----------|
| "Cannot find firebase-admin" | `npm install firebase-admin` |
| "Project ID not found" | Vérifier `.env` et `FIREBASE_PROJECT_ID` |
| "Permission denied on Firestore" | Vérifier les règles Firestore |
| "Token expired" | Firebase refresh automatiquement |
| "Server unreachable" | Checker que `server-firebase.js` est en cours |

---

## 🎯 Prochaines étapes
1. ✅ Tester l'authentification
2. ✅ Vérifier la recherche d'entreprises
3. ✅ Importer les données Excel
4. ✅ Déployer sur Cloud Run
5. ✅ Configurer domaines de production
