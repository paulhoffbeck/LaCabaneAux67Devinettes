# 🎮 Quiz Clash - Projet Web Temps Réel

Jeu de quiz multijoueur interactif où un écran principal (la "télé") affiche les questions, et les joueurs utilisent leurs smartphones comme manettes pour répondre le plus vite possible.

## 🛠️ Stack Technique

Ce projet est construit avec les technologies et modules suivants :

**Frontend (Client) :**
*   **Vite :** Outil de build ultra-rapide pour le développement.
*   **Vue.js :** Framework JavaScript réactif pour gérer l'affichage conditionnel (Lobby, Questions, Scores).
*   **Lit / LitElement :** Création de Web Components natifs.
*   **jcb-gauge :** Composant web (jauge) utilisé pour afficher le chronomètre de manière visuelle.

**Backend (Serveur) :**
*   **Node.js & Express :** Serveur web pour gérer les requêtes et héberger l'API.
*   **Prisma :** ORM (Object-Relational Mapping) pour simplifier les requêtes vers la base de données.
*   **SQL (SQLite ou PostgreSQL) :** Base de données relationnelle pour stocker les questions et les scores.

**Communication :**
*   **WebSockets (Socket.io) :** Synchronisation bidirectionnelle en temps réel entre le serveur, l'écran principal et les manettes des joueurs.

---

## 📂 Architecture du Projet (Tree)

Voici comment le code est organisé. Le projet est divisé en deux parties principales : `backend` et `frontend`.

```text
quiz-clash/
│
├── README.md                  # Documentation du projet
│
├── backend/                   # 🧠 LOGIQUE SERVEUR & BASE DE DONNÉES
│   ├── package.json           # Dépendances Node (express, socket.io, prisma)
│   ├── prisma/
│   │   ├── schema.prisma      # Définition des tables SQL (Questions, Scores)
│   │   └── dev.db             # Base de données SQLite (générée automatiquement)
│   ├── src/
│   │   ├── server.js          # Point d'entrée : lance Express et le serveur WebSocket
│   │   ├── sockets.js         # Logique du jeu en temps réel (rooms, timers, scores)
│   │   └── routes.js          # (Optionnel) API classique pour gérer la DB (CRUD questions)
│   └── .env                   # Variables d'environnement (Port, URL de la DB)
│
└── frontend/                  # 🎨 INTERFACE UTILISATEUR & VUE.JS
    ├── package.json           # Dépendances front (vue, vite, lit, jcb-gauge, socket.io-client)
    ├── vite.config.js         # Configuration de Vite
    ├── index.html             # Point d'entrée HTML
    ├── public/                # Fichiers statiques (images, favicon, sons)
    └── src/
        ├── main.js            # Initialisation de Vue.js
        ├── App.vue            # Composant racine Vue
        ├── services/
        │   └── socketClient.js # Fichier centralisant la connexion Socket.io vers le backend
        ├── views/             # Les écrans principaux
        │   ├── HostView.vue   # Partie perso : réglages, code à partager, salle d'attente
        │   ├── PlayerView.vue # L'écran de jeu (question, réponses, chrono, correction)
        │   ├── ProposeView.vue # Proposer une question (une par jour)
        │   └── AdminView.vue  # Espace admin : valider, modifier ou refuser les propositions
        ├── components/        # Composants Vue réutilisables
        │   ├── ScoreBoard.vue # Tableau des scores
        │   └── PlayerBadge.vue # Petit macaron pour afficher un joueur
        └── web-components/    # Standard Web Components (Lit)
            └── TimerGauge.js  # Wrapper personnalisé LitElement utilisant "jcb-gauge"
