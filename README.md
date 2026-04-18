# 🏢 SALES COMPANION — Intelligence B2B Cameroun
**Version 2.0 — Package de déploiement**

---

## Contenu du package

```
SalesCompanion/
├── server/          → Serveur backend (à déployer une seule fois)
├── mobile/          → Application mobile PWA (Android & iPhone)
├── client/          → Application desktop Windows/Mac/Linux
└── README.md        → Ce guide
```

---

## DÉMARRAGE RAPIDE (5 minutes)

### Prérequis
- **Node.js v18+** → https://nodejs.org (téléchargez la version LTS)
- **Clé API Groq gratuite** → https://console.groq.com/keys (assistant IA)

---

## ÉTAPE 1 — Démarrer le serveur

```bash
npm install
npm start
```

✅ Le serveur démarre sur **http://localhost:3210**

**Panel Admin :** http://localhost:3210/admin
- Login : `admin`
- Mot de passe : `admin123`  
  ⚠️ **Changez ce mot de passe dès la première connexion**

---

## ÉTAPE 2 — Configuration initiale (Panel Admin)

1. Ouvrez http://localhost:3210/admin
2. Allez dans **Configuration** → saisissez votre clé API Groq (`gsk_...`)
3. Allez dans **Import données** → importez votre fichier Excel d'entreprises

**Colonnes Excel reconnues automatiquement :**
| Colonne | Description |
|---|---|
| RAISON_SOCIALE | Nom de l'entreprise (**obligatoire**) |
| SIGLE | Abréviation / acronyme |
| NIU | Numéro fiscal (dédoublonnage automatique) |
| ACTIVITE_PRINCIPALE | Secteur auto-détecté |
| CENTRE_DE_RATTACHEMENT | Région/Ville auto-détectées |
| TELEPHONE, EMAIL, DIRIGEANT, RCCM | Si disponibles |

---

## ÉTAPE 3A — Application Mobile (Android & iPhone)

### Si le serveur est en réseau local
1. Trouvez l'IP de votre PC : tapez `ipconfig` (Windows) ou `ifconfig` (Mac/Linux)
2. Sur votre téléphone, ouvrez le navigateur et allez sur :
   ```
   http://[votre-IP]:3210/mobile
   ```
   Exemple : `http://192.168.1.10:3210/mobile`

### Installer comme application native
- **Android (Chrome)** → Menu ⋮ → "Ajouter à l'écran d'accueil"
- **iPhone (Safari)** → Bouton partage ↑ → "Sur l'écran d'accueil"

L'application apparaît alors avec son icône, comme une vraie application installée.

---

## ÉTAPE 3B — Application Desktop (Windows)

```bash
cd client
npm install
npm start              # Lancer pour tester
npm run build:win      # Compiler en .exe portable
```

Le fichier `.exe` est généré dans `client/dist/`

---

## Plans & Tarification

| Plan | Recherches/jour | Prix/mois recommandé |
|---|---|---|
| Gratuit | 10 | — |
| Starter | 200 | 5 000 FCFA |
| Pro | 500 | 15 000 FCFA |
| Entreprise | Illimité | 50 000 FCFA |

Gérez les plans depuis le **Panel Admin → Utilisateurs**

---

## Déploiement en ligne (pour accès depuis n'importe où)

Pour que vos utilisateurs se connectent depuis partout (pas seulement en réseau local) :

1. **Louez un VPS** (5-10$/mois) : DigitalOcean, Contabo, OVH
2. Copiez le dossier `server/` sur le VPS
3. Installez Node.js sur le VPS
4. Lancez avec PM2 (redémarrage automatique) :
   ```bash
   npm install -g pm2
   cd server && npm install
   pm2 start server.js --name "sales-companion"
   pm2 startup && pm2 save
   ```
5. L'URL devient : `http://votre-domaine.com:3210`

---

## Support & Contacts

Pour toute assistance technique, contactez votre administrateur.

---

*Sales Companion v2.0 — © 2025*
# Sales-Companion
