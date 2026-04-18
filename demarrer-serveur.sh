#!/bin/bash
clear
echo ""
echo " =========================================="
echo "  SALES COMPANION — Intelligence B2B"
echo " =========================================="
echo ""
echo " Démarrage du serveur..."
echo ""

cd "$(dirname "$0")"

# Vérifier Node.js
if ! command -v node &> /dev/null; then
    echo " ERREUR : Node.js n'est pas installé."
    echo " Téléchargez-le sur : https://nodejs.org"
    echo ""
    read -p "Appuyez sur Entrée pour quitter..."
    exit 1
fi

# Installer les dépendances si nécessaire
if [ ! -d "node_modules" ]; then
    echo " Installation des dépendances..."
    npm install
    echo ""
fi

# Trouver l'IP locale
if [[ "$OSTYPE" == "darwin"* ]]; then
    IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "localhost")
else
    IP=$(hostname -I | awk '{print $1}' 2>/dev/null || echo "localhost")
fi

echo " =========================================="
echo "  Serveur démarré avec succès !"
echo " =========================================="
echo ""
echo "  Panel Admin    : http://localhost:3210/admin"
echo "  App Mobile     : http://$IP:3210/mobile"
echo "  API            : http://localhost:3210"
echo ""
echo "  Login admin    : admin / admin123"
echo ""
echo "  Partagez ce lien avec vos utilisateurs :"
echo "  http://$IP:3210/mobile"
echo ""
echo " =========================================="
echo "  Ctrl+C pour arrêter"
echo " =========================================="
echo ""

node server/server-firebase.js
