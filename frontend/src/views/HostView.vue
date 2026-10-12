<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { roomCreate, roomJoin, roomStart, on } from '../services/socketClient.js'
import PlayerBadge from '../components/PlayerBadge.vue'

// Partie perso : réglages (créateur), code à partager et salle d'attente (tout le monde).
// Dès que la première question arrive, on passe la main à l'écran de jeu.
const props = defineProps({
  nickname: { type: String, required: true },
  themes: { type: Array, default: () => [] },
  joinCode: { type: String, default: '' }, // rempli = on rejoint une partie existante
})
const emit = defineEmits(['started', 'exit'])

const ERRORS = {
  ROOM_NOT_FOUND: 'Aucune partie ne correspond à ce code.',
  NICKNAME_TAKEN: 'Ce pseudo est déjà pris dans cette partie.',
  GAME_STARTED: 'Cette partie a déjà commencé.',
  NOT_CREATOR: 'Seul le créateur peut lancer la partie.',
  TIMEOUT: 'Le serveur ne répond pas.',
}

// settings → lobby | joining → lobby | error | closed
const phase = ref(props.joinCode ? 'joining' : 'settings')
const error = ref('')
const settings = ref({ themeId: '', questionCount: 10, durationSec: 20 })
const roomCode = ref('')
const playerId = ref(null)
const players = ref([])
const starting = ref(false)

const me = computed(() => players.value.find((p) => p.id === playerId.value))
const isCreator = computed(() => me.value?.isCreator ?? false)
const creator = computed(() => players.value.find((p) => p.isCreator))
const themeName = (id) => props.themes.find((t) => t.id === id)?.name ?? 'Tous les thèmes'

function fail(e) {
  error.value = ERRORS[e.message] ?? `Erreur : ${e.message}`
  phase.value = 'error'
}

async function create() {
  try {
    const res = await roomCreate({
      nickname: props.nickname,
      themeId: settings.value.themeId || null,
      questionCount: settings.value.questionCount,
      durationSec: settings.value.durationSec,
    })
    roomCode.value = res.roomCode
    playerId.value = res.playerId
    phase.value = 'lobby'
  } catch (e) {
    fail(e)
  }
}

async function join() {
  try {
    const code = props.joinCode.trim().toUpperCase()
    const res = await roomJoin(code, props.nickname)
    roomCode.value = code
    playerId.value = res.playerId
    settings.value = { ...settings.value, ...res.settings }
    phase.value = 'lobby'
  } catch (e) {
    fail(e)
  }
}

async function start() {
  starting.value = true
  try {
    await roomStart(roomCode.value)
  } catch (e) {
    starting.value = false
    fail(e)
  }
}

const unsubscribers = []
onMounted(() => {
  unsubscribers.push(
    on('lobby:update', ({ players: list }) => {
      players.value = list
    }),
    on('question:show', ({ question }) => {
      emit('started', { roomCode: roomCode.value, playerId: playerId.value, firstQuestion: question })
    }),
    on('room:closed', () => {
      phase.value = 'closed'
    }),
  )
  if (props.joinCode) join()
})
onUnmounted(() => unsubscribers.forEach((off) => off()))
</script>

<template>
  <main class="room">
    <header class="bar">
      <button class="quit" type="button" @click="emit('exit')">← Accueil</button>
      <span class="title">Partie perso</span>
      <span></span>
    </header>

    <!-- Réglages du créateur -->
    <form v-if="phase === 'settings'" class="card" @submit.prevent="create">
      <h1>Créer une partie</h1>
      <label class="field" for="room-theme">
        <span>Thème</span>
        <select id="room-theme" v-model="settings.themeId">
          <option value="">Tous les thèmes</option>
          <option v-for="t in themes" :key="t.id" :value="t.id">{{ t.name }}</option>
        </select>
      </label>
      <div class="row">
        <label class="field" for="room-count">
          <span>Questions</span>
          <select id="room-count" v-model.number="settings.questionCount">
            <option v-for="n in [5, 10, 15]" :key="n" :value="n">{{ n }}</option>
          </select>
        </label>
        <label class="field" for="room-duration">
          <span>Temps par question</span>
          <select id="room-duration" v-model.number="settings.durationSec">
            <option v-for="s in [10, 20, 30]" :key="s" :value="s">{{ s }} secondes</option>
          </select>
        </label>
      </div>
      <button class="btn primary" type="submit">Créer la partie</button>
    </form>

    <!-- Salle d'attente -->
    <section v-else-if="phase === 'lobby'" class="lobby">
      <div class="card code-card">
        <p class="eyebrow">Code de la partie</p>
        <p class="code">{{ roomCode }}</p>
        <p class="muted">Tes amis le saisissent sur l'accueil, dans « Rejoindre ».</p>
        <p class="settings">
          {{ themeName(settings.themeId) }} · {{ settings.questionCount }} questions · {{ settings.durationSec }} s par question
        </p>
      </div>

      <div class="card">
        <h2>{{ players.length }} joueur{{ players.length > 1 ? 's' : '' }}</h2>
        <TransitionGroup tag="ul" name="pop" class="players">
          <li v-for="p in players" :key="p.id" :class="{ me: p.id === playerId }">
            <PlayerBadge :player="p" />
            <span v-if="p.isCreator" class="tag">Créateur</span>
          </li>
        </TransitionGroup>
      </div>

      <button v-if="isCreator" class="btn primary start" type="button" :disabled="starting" @click="start">
        {{ starting ? 'Lancement…' : 'Lancer la partie' }}
      </button>
      <p v-else class="muted wait">En attente que {{ creator?.nickname ?? 'le créateur' }} lance la partie…</p>
    </section>

    <section v-else-if="phase === 'joining'" class="center">
      <p class="muted">Connexion à la partie {{ joinCode.toUpperCase() }}…</p>
    </section>

    <section v-else class="center">
      <p class="err">{{ phase === 'closed' ? 'Le créateur a quitté la partie.' : error }}</p>
      <button class="btn" type="button" @click="emit('exit')">Retour à l'accueil</button>
    </section>
  </main>
</template>

<style scoped>
.room {
  max-width: 40rem;
  margin: 0 auto;
  padding: 0 16px 2.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.2rem;
}

.bar {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
}

.quit {
  justify-self: start;
  border: none;
  background: none;
  color: var(--ink-soft);
  font-weight: 600;
  cursor: pointer;
  padding: 0.3rem 0;
}

.title {
  font-weight: 700;
}

.card {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 0.9rem;
  padding: 1.4rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

h1,
h2 {
  margin: 0;
  font-family: var(--serif);
  font-weight: 600;
}

h1 {
  font-size: 1.7rem;
}

h2 {
  font-size: 1.2rem;
}

.row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-weight: 600;
  color: var(--ink-soft);
}

select {
  font: inherit;
  font-weight: 600;
  padding: 0.65rem 0.8rem;
  border: 1px solid var(--line);
  border-radius: 0.5rem;
  background: var(--card);
  color: var(--ink);
}

.lobby {
  display: flex;
  flex-direction: column;
  gap: 1.2rem;
}

.code-card {
  align-items: center;
  text-align: center;
  gap: 0.4rem;
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

.code {
  margin: 0;
  font-family: var(--serif);
  font-size: 3.4rem;
  font-weight: 700;
  letter-spacing: 0.18em;
}

.settings {
  margin: 0.4rem 0 0;
  font-weight: 600;
}

.muted {
  margin: 0;
  color: var(--ink-soft);
}

.players {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.players li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  padding: 0.55rem 0.4rem;
  border-bottom: 1px solid var(--line);
}

.players li:last-child {
  border-bottom: none;
}

.players li.me {
  background: var(--accent-soft);
  border-radius: 0.4rem;
}

.tag {
  font-size: 0.75rem;
  font-weight: 700;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
}

.start {
  align-self: center;
}

.wait {
  text-align: center;
}

.center {
  min-height: 40vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  text-align: center;
}

.err {
  color: var(--bad);
  font-weight: 600;
}

.pop-enter-active {
  transition: all 0.3s ease;
}

.pop-enter-from {
  opacity: 0;
  transform: translateY(-0.4rem);
}

@media (max-width: 480px) {
  .row {
    grid-template-columns: 1fr;
  }
}
</style>
