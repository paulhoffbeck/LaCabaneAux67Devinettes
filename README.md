# Quiz Clash
**Accéder au Quizz**
Pour accéder au site du quizz, entrer cette ip dans un navigateur : 
http://179.237.127.236/

**Présentation**
Petit jeu de quiz de culture générale dans le navigateur. On choisit un pseudo, puis on peut :

- jouer le **quiz du jour** (10 questions, une partie par jour, classement du jour) ;
- lancer un **quiz à thème** ;
- créer une **partie perso** avec un code à 4 lettres pour jouer en direct avec des amis ;
- **proposer une question** (une par jour), qu'un admin relit, corrige puis valide ou refuse.
- Identifiant admin : admin/admin (cet identifiant donne uniquement accès à l'acceptation des questions. Il n'a aucun droit sur le site ou le serveur en lui même)

Le front est en Vue 3 (Vite), le back en Node/Express avec Socket.io. Toute la communication passe par Socket.io (pas d'API REST) : le client envoie un événement et attend la réponse dans un callback.

## Lancer le projet

Il faut Node.js (une version récente, Vite 8 en demande une à jour).

**Backend** (port 3000) :

```bash
cd backend
npm install
npx prisma generate
npx prisma db push   # crée prisma/dev.db (SQLite)
npm run dev          # nodemon, ou npm start
```

Si Prisma n'est pas généré ou que la base n'est pas joignable, le serveur démarre quand même et utilise les données en dur.

**Frontend** (port 5173) :

```bash
cd frontend
npm install
npm run dev
```

Vite redirige `/socket.io` vers `localhost:3000`, donc il faut que le back tourne en même temps. `host: true` est activé : l'appli est accessible depuis un téléphone sur le même réseau via l'IP de la machine.

Le port du back se change avec la variable `PORT`.

## Organisation

```text
backend/
  src/server.js          serveur Express + tous les handlers Socket.io
  prisma/schema.prisma   modèles Theme et Question (SQLite)

frontend/
  vite.config.js         proxy Socket.io, déclaration des custom elements
  src/
    App.vue              accueil + bascule entre les écrans (pas de routeur)
    services/socketClient.js   connexion Socket.io et une fonction par événement
    views/
      PlayerView.vue     écran de jeu (solo et partie perso)
      HostView.vue       création / connexion à une partie perso, salle d'attente
      ProposeView.vue    formulaire de proposition (QCM ou réponse libre)
      AdminView.vue      connexion admin et relecture des propositions
    components/
      ScoreBoard.vue, PlayerBadge.vue
    web-components/
      TimerGauge.js      <timer-gauge>, composant Lit qui affiche le chrono avec jcb-gauge
```

Quelques détails :

- Le pseudo est gardé dans le `localStorage`, le jeton admin dans le `sessionStorage`.
- `<timer-gauge>` passe du vert à l'orange sous 50 % du temps restant, puis au rouge sous 25 %, et émet un événement `timeout` à la fin.
- `socketClient.js` logue tous les événements entrants et sortants dans la console.

## Dépendances principales

- Front : Vue 3, Vite, Lit, jcb-gauge, socket.io-client
- Back : Express 5, Socket.io, Prisma (SQLite), cors


## Note sur le Github
Ce github ne contient que la version de base. Il ne contient pas les questions ajoutées par les utilisateurs sur le serveur. 
