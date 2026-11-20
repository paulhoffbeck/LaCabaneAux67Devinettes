<script setup>
import { ref, computed, onMounted } from 'vue'
import { listThemes, dailyStatus, dailyLeaderboard } from './services/socketClient.js'
import PlayerView from './views/PlayerView.vue'
import HostView from './views/HostView.vue'
import ProposeView from './views/ProposeView.vue'
import AdminView from './views/AdminView.vue'
import ScoreBoard from './components/ScoreBoard.vue'

// Pas de routeur : l'écran affiché dépend de cette variable.
// home = accueil, room = partie perso (réglages et salle d'attente), game = écran de jeu,
// propose = proposer une question, admin = espace admin
const screen = ref('home')
const game = ref(null) // { mode, themeId?, themeName?, roomCode?, playerId?, firstQuestion? }
const joinCode = ref('')
const roomJoinCode = ref('') // code passé à HostView : vide = création

// Le pseudo est gardé dans le navigateur pour ne pas le retaper
const NICKNAME_KEY = 'quiz-clash:nickname'
function readNickname() {
  try {
    return localStorage.getItem(NICKNAME_KEY) ?? ''
  } catch {
    return ''
  }
}
const nickname = ref(readNickname())
const cleanNickname = computed(() => nickname.value.trim())
function saveNickname() {
  try {
    localStorage.setItem(NICKNAME_KEY, cleanNickname.value)
  } catch {
    // stockage indisponible (navigation privée) : on garde le pseudo en mémoire
  }
}

const themes = ref([])
const daily = ref(null) // { date, played, score? }
const leaderboard = ref([])
const error = ref('')

const today = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())

async function refreshDaily() {
  try {
    const [board, status] = await Promise.all([
      dailyLeaderboard(),
      cleanNickname.value ? dailyStatus(cleanNickname.value) : Promise.resolve(null),
    ])
    leaderboard.value = board.entries
    daily.value = status
  } catch (e) {
    error.value = `Impossible de joindre le serveur (${e.message}).`
  }
}

async function loadHome() {
  error.value = ''
  try {
    themes.value = (await listThemes()).themes
  } catch (e) {
    error.value = `Impossible de joindre le serveur (${e.message}).`
  }
  refreshDaily()
}

function play(mode, theme = null) {
  if (!cleanNickname.value) return
  saveNickname()
  game.value = { mode, themeId: theme?.id ?? null, themeName: theme?.name ?? null }
  screen.value = 'game'
}

function openPropose() {
  if (!cleanNickname.value) return
  saveNickname()
  screen.value = 'propose'
}

function createRoom() {
  if (!cleanNickname.value) return
  saveNickname()
  roomJoinCode.value = ''
  screen.value = 'room'
}

function joinRoom() {
  if (!cleanNickname.value || joinCode.value.trim().length < 4) return
  saveNickname()
  roomJoinCode.value = joinCode.value.trim().toUpperCase()
  screen.value = 'room'
}

// La salle d'attente a reçu la première question : on passe à l'écran de jeu
function roomStarted({ roomCode, playerId, firstQuestion }) {
  game.value = { mode: 'room', roomCode, playerId, firstQuestion }
  screen.value = 'game'
}

function backHome() {
  screen.value = 'home'
  game.value = null
  // Les thèmes peuvent avoir changé (question validée par un admin)
  loadHome()
}

onMounted(loadHome)
</script>

<template>
  <div class="app">
    <header class="top">
      <button class="brand" type="button" @click="screen === 'home' || backHome()">
        Quiz <span>Clash</span>
      </button>
      <span v-if="cleanNickname && screen !== 'home'" class="who">{{ cleanNickname }}</span>
    </header>

    <!-- Accueil -->
    <main v-if="screen === 'home'" class="home">
      <section class="intro">
        <h1>Chaque jour, dix questions pour tester ta culture générale.</h1>
        <label class="nick" for="nickname">
          <span>Ton pseudo</span>
          <input
            id="nickname"
            v-model="nickname"
            maxlength="16"
            autocomplete="nickname"
            placeholder="ex. Robin"
            @change="saveNickname(); refreshDaily()"
          />
        </label>
        <p v-if="!cleanNickname" class="hint">Choisis un pseudo pour jouer et apparaître au classement.</p>
      </section>

      <p v-if="error" class="error">{{ error }}</p>

      <div class="layout">
        <div class="modes">
          <article class="card daily">
            <p class="eyebrow">Quiz du jour</p>
            <h2 class="date">{{ today }}</h2>
            <p class="desc">10 questions de culture générale, les mêmes pour tout le monde. Une seule partie par jour.</p>
            <p v-if="daily?.played" class="played">
              Déjà joué aujourd'hui : <strong>{{ daily.score }} pts</strong>
            </p>
            <button v-else class="btn primary" type="button" :disabled="!cleanNickname" @click="play('daily')">
              Jouer le quiz du jour
            </button>
          </article>

          <section class="themes">
            <h2 class="section-title">Quiz à thème</h2>
            <div class="theme-grid">
              <button
                v-for="theme in themes"
                :key="theme.id"
                class="theme"
                type="button"
                :disabled="!cleanNickname"
                @click="play('theme', theme)"
              >
                <span class="theme-name">{{ theme.name }}</span>
                <span class="theme-count">{{ theme.questionCount }} questions</span>
              </button>
            </div>
          </section>

          <article class="card room">
            <p class="eyebrow">Partie perso</p>
            <p class="desc">Crée une partie avec un code et défie tes amis en direct, ou rejoins la leur.</p>
            <div class="room-actions">
              <button class="btn primary" type="button" :disabled="!cleanNickname" @click="createRoom">
                Créer une partie
              </button>
              <form class="join" @submit.prevent="joinRoom">
                <input
                  id="join-code"
                  v-model="joinCode"
                  maxlength="4"
                  placeholder="CODE"
                  autocomplete="off"
                  autocapitalize="characters"
                  aria-label="Code de la partie"
                />
                <button class="btn" type="submit" :disabled="!cleanNickname || joinCode.trim().length < 4">
                  Rejoindre
                </button>
              </form>
            </div>
          </article>

          <article class="card propose">
            <p class="eyebrow">Ta question dans le quiz</p>
            <p class="desc">Propose une question une fois par jour. Si un admin la valide, elle entre dans les quiz.</p>
            <button class="btn" type="button" :disabled="!cleanNickname" @click="openPropose">Proposer une question</button>
          </article>
        </div>

        <aside class="board">
          <h2 class="section-title">Classement du jour</h2>
          <ScoreBoard v-if="leaderboard.length" :leaderboard="leaderboard" :highlight="cleanNickname" />
          <p v-else class="hint">Personne n'a encore joué aujourd'hui.</p>
        </aside>
      </div>

      <footer class="foot">
        <button class="admin-link" type="button" @click="screen = 'admin'">Espace admin</button>
      </footer>
    </main>

    <!-- Proposer une question -->
    <ProposeView v-else-if="screen === 'propose'" :nickname="cleanNickname" @exit="backHome" />

    <!-- Espace admin -->
    <AdminView v-else-if="screen === 'admin'" @exit="backHome" />

    <!-- Partie perso : réglages et salle d'attente -->
    <HostView
      v-else-if="screen === 'room'"
      :nickname="cleanNickname"
      :themes="themes"
      :join-code="roomJoinCode"
      @started="roomStarted"
      @exit="backHome"
    />

    <!-- Écran de jeu -->
    <PlayerView
      v-else-if="screen === 'game'"
      :mode="game.mode"
      :theme-id="game.themeId"
      :theme-name="game.themeName"
      :nickname="cleanNickname"
      :room-code="game.roomCode"
      :player-id="game.playerId"
      :first-question="game.firstQuestion"
      @exit="backHome"
    />
  </div>
</template>

<style>
/* Palette « plateau de culture générale » : encre bleu nuit sur papier clair, or pour les points */
:root {
  --paper: #f4f5f9;
  --card: #ffffff;
  --ink: #18223a;
  --ink-soft: #5b6478;
  --line: #dde1ea;
  --accent: #2f5d8a;
  --accent-soft: #e6eef7;
  --gold: #c8901a;
  --good: #2b8a3e;
  --good-soft: #e3f4e6;
  --bad: #c0392b;
  --bad-soft: #fbe7e4;
  --serif: 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif;
  --sans: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  color-scheme: light;
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  min-height: 100%;
  background: var(--paper);
  color: var(--ink);
  font-family: var(--sans);
  -webkit-font-smoothing: antialiased;
}

button {
  font: inherit;
}

.btn {
  font-weight: 700;
  padding: 0.85rem 1.4rem;
  border-radius: 0.6rem;
  border: 1px solid var(--line);
  background: var(--card);
  color: var(--ink);
  cursor: pointer;
}

.btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.btn:focus-visible,
button:focus-visible,
input:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--accent) 40%, transparent);
  outline-offset: 2px;
}
</style>

<style scoped>
.app {
  min-height: 100vh;
}

.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.9rem 16px;
  max-width: 68rem;
  margin: 0 auto;
}

.brand {
  border: none;
  background: none;
  padding: 0;
  cursor: pointer;
  font-family: var(--serif);
  font-size: 1.6rem;
  font-weight: 700;
  color: var(--ink);
  letter-spacing: -0.01em;
}

.brand span {
  color: var(--gold);
  font-style: italic;
}

.who {
  font-weight: 600;
  color: var(--ink-soft);
}

.home {
  max-width: 68rem;
  margin: 0 auto;
  padding: 0 16px 3rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.intro {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  padding: 1rem 0 0.5rem;
}

h1 {
  font-family: var(--serif);
  font-weight: 600;
  font-size: clamp(1.6rem, 4vw, 2.4rem);
  line-height: 1.15;
  margin: 0;
  max-width: 24ch;
  text-wrap: balance;
}

.nick {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  flex-wrap: wrap;
}

.nick span {
  font-weight: 600;
  color: var(--ink-soft);
}

.nick input {
  font: inherit;
  font-size: 1.05rem;
  font-weight: 600;
  padding: 0.6rem 0.9rem;
  border: 1px solid var(--line);
  border-radius: 0.5rem;
  background: var(--card);
  color: var(--ink);
  width: min(100%, 16rem);
}

.hint {
  margin: 0;
  color: var(--ink-soft);
}

.error {
  margin: 0;
  color: var(--bad);
  font-weight: 600;
}

.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(16rem, 22rem);
  gap: 1.5rem;
  align-items: start;
}

.modes {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  min-width: 0;
}

.card {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 0.9rem;
  padding: 1.4rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  align-items: flex-start;
}

.daily {
  border-top: 4px solid var(--gold);
}

.eyebrow {
  margin: 0;
  font-size: 0.78rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--accent);
}

.date {
  margin: 0;
  font-family: var(--serif);
  font-size: 1.7rem;
  font-weight: 600;
}

.date::first-letter {
  text-transform: uppercase;
}

.desc {
  margin: 0;
  color: var(--ink-soft);
  line-height: 1.5;
  max-width: 50ch;
}

.played {
  margin: 0.3rem 0 0;
  padding: 0.6rem 0.9rem;
  border-radius: 0.5rem;
  background: var(--accent-soft);
}

.section-title {
  margin: 0 0 0.8rem;
  font-size: 1.05rem;
  font-weight: 700;
}

.theme-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
  gap: 0.8rem;
}

.theme {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.2rem;
  padding: 1rem;
  border: 1px solid var(--line);
  border-radius: 0.7rem;
  background: var(--card);
  color: var(--ink);
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s, transform 0.15s;
}

.theme:not(:disabled):hover {
  border-color: var(--accent);
  transform: translateY(-2px);
}

.theme:disabled {
  opacity: 0.5;
  cursor: default;
}

.theme-name {
  font-family: var(--serif);
  font-size: 1.15rem;
  font-weight: 600;
}

.theme-count {
  font-size: 0.85rem;
  color: var(--ink-soft);
}

.room-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.8rem;
}

.join {
  display: flex;
  gap: 0.5rem;
}

.join input {
  width: 6.5rem;
  font: inherit;
  font-weight: 700;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  text-align: center;
  padding: 0.75rem 0.6rem;
  border: 1px solid var(--line);
  border-radius: 0.6rem;
  background: var(--card);
  color: var(--ink);
}

.foot {
  display: flex;
  justify-content: center;
  padding-top: 1rem;
}

.admin-link {
  border: none;
  background: none;
  color: var(--ink-soft);
  font-size: 0.9rem;
  text-decoration: underline;
  cursor: pointer;
}

.board {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 0.9rem;
  padding: 1.2rem;
  min-width: 0;
}

@media (max-width: 760px) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
