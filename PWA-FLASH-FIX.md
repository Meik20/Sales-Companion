# Correction du Flash de Connexion PWA

## ✅ Problème Résolu

**Issue:** L'application mobile PWA affichait brièvement l'écran de connexion au redémarrage, même si l'utilisateur était déjà authentifié.

**Cause:** L'écran d'authentification était visible par défaut (`display:flex` dans le CSS), et la vérification du token se faisait après l'affichage initial.

## 🔧 Solution Implémentée

### 1. CSS - Écran Auth Caché par Défaut
```css
.auth-screen {
  display: none; /* ← Changé de 'flex' à 'none' */
}
```

### 2. Nouvelle Fonction `showAuth()`
```javascript
function showAuth() {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('topbar').style.display = 'none';
  document.getElementById('content').style.display = 'none';
  document.getElementById('bottom-nav').style.display = 'none';
}
```

### 3. Logique DOMContentLoaded Améliorée
```javascript
document.addEventListener('DOMContentLoaded', async () => {
  const tokenIsValid = await checkCachedToken();
  if (tokenIsValid) {
    // Token valide → Afficher l'app directement
    updateCities();
    return;
  }
  
  // Pas de token valide → Afficher l'écran d'auth
  showAuth();
  
  // Configurer Firebase auth listener pour nouveaux logins
  // ...
});
```

### 4. Simplification de `doLogout()`
Utilise maintenant `showAuth()` au lieu de définir manuellement tous les styles.

## 📱 Résultat

- **Avant:** Écran de connexion visible → Vérification token → Flash désagréable
- **Après:** Vérification token d'abord → Écran approprié affiché directement

## 🔍 Flux d'Initialisation

1. **Chargement de la page:** Écran d'auth caché par défaut
2. **DOMContentLoaded:** Vérification du token localStorage
3. **Token valide:** `showApp()` → Interface utilisateur affichée
4. **Token invalide/expiré:** `showAuth()` → Écran de connexion affiché
5. **Nouvelle connexion:** Firebase auth listener → `showApp()`

## ✅ Test Cases

- [ ] Redémarrage app avec token valide → Pas de flash
- [ ] Redémarrage app avec token expiré → Écran auth affiché
- [ ] Nouvelle connexion → Transition fluide vers l'app
- [ ] Déconnexion → Retour à l'écran auth