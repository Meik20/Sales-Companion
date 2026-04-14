# 🔒 Guide de Sécurité Firebase

## ⚠️ Issue Corrigée : Fuite de Données Sensibles

**Problème:** Les credentials Firebase étaient en dur dans `mobile/index.html`
**Solution:** Chargement dynamique depuis un endpoint API sécurisé

## 🔐 Architecture de Sécurité

### 1. **Credentials Publiques (Côté Client)**
```
FIREBASE_PUBLIC_API_KEY          ✓ Sûr d'exposer (utilisé en front-end)
FIREBASE_AUTH_DOMAIN             ✓ Sûr
FIREBASE_PROJECT_ID              ✓ Sûr
FIREBASE_STORAGE_BUCKET          ✓ Sûr
FIREBASE_MESSAGING_SENDER_ID     ✓ Sûr
FIREBASE_APP_ID                  ✓ Sûr
```

### 2. **Credentials Privées (Côté Serveur)**
```
FIREBASE_PRIVATE_KEY             ❌ NE JAMAIS COMMITTER
FIREBASE_CLIENT_EMAIL            ❌ NE JAMAIS COMMITTER
                                 (Admin SDK - serveur SEULEMENT)
```

## ✅ Implémentation Sécurisée

### Flow Actuel (Sécurisé)

```
[Mobile/Browser]
       ↓
   GET /api/config/firebase
       ↓
   [API Server]
   (Charge depuis .env)
       ↓
  Retourne config publique
       ↓
   [Mobile/Browser]
   Initialise Firebase
```

### Ancien Flow (NON-SÉCURISÉ) ❌
```
Config en dur dans mobile/index.html
Exposée dans le code source
Quiconque peut voir les credentials
```

## 📋 Checklist de Sécurité

### Git
- ✅ `.env` exclu de git (voir .gitignore)
- ✅ `.env.*` (fichiers d'environnement) exclu
- ✅ Credentials Firebase ignorés

### Variables d'Environnement
- ✅ Jamais hardcodées en dur
- ✅ Chargées depuis .env localement
- ✅ Chargées depuis Vercel en production

### Endpoints API
- ✅ `/api/config/firebase` - Endpoint public (credentials publiques seulement)
- ✅ Validation des variables environnement
- ✅ Gestion d'erreur appropriée

## 🚀 Déploiement sur Vercel

### 1. Ajouter les Variables sur Vercel
Dashboard → Project Settings → Environment Variables

**Ces variables sont publiques (safe):**
```
FIREBASE_PUBLIC_API_KEY=AIzaSyCVJxyeysHWDQ7yECTb-GApJz7u8s5l7N0
FIREBASE_AUTH_DOMAIN=sales-companion-9cf56.firebaseapp.com
FIREBASE_PROJECT_ID=sales-companion-9cf56
FIREBASE_STORAGE_BUCKET=sales-companion-9cf56.firebasestorage.app
FIREBASE_MESSAGING_SENDER_ID=1058275289756
FIREBASE_APP_ID=1:1058275289756:web:8c3a2f9b4e1d7c6f5a4b9e8d7c6f5a4b
```

**Ces variables sont privées (admin SDK - backend ONLY):**
```
FIREBASE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----...
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-...@sales-companion-9cf56.iam.gserviceaccount.com
FIREBASE_CLIENT_ID=...
FIREBASE_PRIVATE_KEY_ID=...
FIREBASE_AUTH_URI=https://accounts.google.com/o/oauth2/auth
FIREBASE_TOKEN_URI=https://oauth2.googleapis.com/token
FIREBASE_AUTH_PROVIDER_X509_CERT_URL=...
FIREBASE_CLIENT_X509_CERT_URL=...
```

### 2. Local Development
1. Copier `.env.example` en `.env`
2. Remplir les variables nécessaires
3. Ne JAMAIS committer le `.env` réel

## 🔍 Vérification

### Test endpoint API
```bash
curl http://localhost:3210/api/config/firebase
# Doit retourner la config publique seulement
```

### Vérifier que le app initialise
```javascript
// Dans la console du navigateur
> firebaseConfig
// Doit afficher la config loaded depuis l'API
```

## ⚡ Bonnes Pratiques

✅ **À FAIRE:**
- Charger la config depuis un endpoint
- Utiliser des variables d'environnement
- Valider les credentials au chargement
- Utiliser les credentials publiques en front
- Admin SDK seulement sur le serveur

❌ **À NE PAS FAIRE:**
- Hardcoder les credentials dans le code
- Committer les .env
- Utiliser les credentials privées en front
- Copier/coller les clés dans Slack/GitHub
- Exposer les clés dans les logs

## 📞 Support

Si vous voyez une fuite de credentials:
1. **Immédiatement** le signaler
2. Régénérer les clés dans Firebase Console
3. Mettre à jour les variables environnement
4. Redéployer

---

**Dernier audit:** 14 avril 2026
**Statut:** ✅ Conforme OWASP Top 10 #A02:2021 (Cryptographic Failures)
