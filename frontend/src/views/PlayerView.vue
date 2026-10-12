<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { soloStart, soloNext, soloAnswer, roomAnswer, on, localDeadline } from '../services/socketClient.js'
import ScoreBoard from '../components/ScoreBoard.vue'
import '../web-components/TimerGauge.js'

const props = defineProps({
  mode: { type: String, required: true }, // 'daily' | 'theme' | 'room'
  themeId: { type: [String, Number], default: null },
  themeName: { type: String, default: null },
  nickname: { type: String, required: true },
  // Partie perso : la salle d'attente (HostView) nous passe la room et la première question
  roomCode: { type: String, default: '' },
  playerId: { type: String, default: '' },
  firstQuestion: { type: Object, default: null },
})
const emit = defineEmits(['exit'])

const LETTERS = ['A', 'B', 'C', 'D']
const ERRORS = {
  ALREADY_PLAYED: "Tu as déjà joué le quiz du jour. Reviens demain !",
  THEME_NOT_FOUND: "Ce thème n'existe plus.",
  TOO_LATE: 'Trop tard pour cette question.',
  TIMEOUT: 'Le serveur ne répond pas.',
}

// Solo : loading → question → sending → loading → … → done | error
// Partie perso : question → waiting (les autres répondent) → question → … → done
// La correction n'arrive qu'à la fin, dans le récapitulatif.
const phase = ref('loading')
const error = ref('')
const sessionId = ref(null)
const question = ref(null)
const deadline = ref(0)
const picked = ref(null) // index (QCM) ou texte saisi
const typed = ref('')
const final = ref(null) // { score, rank?, recap: [...] }
const textInput = ref(null)
const isRoom = props.mode === 'room'
const answered = ref({ answeredCount: 0, playerCount: 0 })
const leaderboard = ref([])

const title = computed(() => {
  if (isRoom) return `Partie ${props.roomCode}`
  return props.mode === 'daily' ? 'Quiz du jour' : props.themeName ?? 'Quiz à thème'
})
const goodCount = computed(() => final.value?.recap?.filter((r) => r.correct).length ?? 0)

function fail(e) {
  error.value = ERRORS[e.message] ?? `Erreur : ${e.message}`
  phase.value = 'error'
}

async function loadNext() {
  phase.value = 'loading'
  try {
    const res = await soloNext(sessionId.value)
    if (res.done) {
      final.value = res
      phase.value = 'done'
      return
    }
    showQuestion(res.question)
  } catch (e) {
    fail(e)
  }
}

async function showQuestion(q) {
  question.value = q
  deadline.value = localDeadline(q)
  picked.value = null
  typed.value = ''
  answered.value = { answeredCount: 0, playerCount: answered.value.playerCount }
  phase.value = 'question'
  if (q.type === 'text') {
    await nextTick()
    textInput.value?.focus()
  }
}

async function answer(value) {
  if (phase.value !== 'question') return
  picked.value = value
  phase.value = 'sending'
  try {
    if (isRoom) {
      // En partie perso, c'est le serveur qui envoie la question suivante
      phase.value = 'waiting'
      await roomAnswer(props.roomCode, question.value.questionId, value)
      return
    }
    await soloAnswer(sessionId.value, question.value.questionId, value)
    loadNext()
  } catch (e) {
    if (isRoom && e.message === 'TOO_LATE') return
    fail(e)
  }
}

function submitText() {
  const value = typed.value.trim()
  if (value) answer(value)
}

// Temps écoulé : en solo on envoie « pas de réponse » (0 point) et on passe à la suite ;
// en partie perso on attend simplement la question suivante du serveur.
function onTimeout() {
  if (phase.value !== 'question') return
  if (isRoom) phase.value = 'waiting'
  else answer(null)
}

const unsubscribers = []


onMounted(async () => {
  if (isRoom) {
    unsubscribers.push(
      on('question:show', ({ question: q }) => showQuestion(q)),
      on('question:answered', (counts) => {
        answered.value = counts
      }),
      on('game:over', ({ leaderboard: list }) => {
        leaderboard.value = list
      }),
      on('game:recap', (data) => {
        final.value = data
        phase.value = 'done'
      }),
      on('room:closed', () => {
        error.value = 'Le créateur a quitté la partie.'
        phase.value = 'error'
      }),
    )
    if (props.firstQuestion) showQuestion(props.firstQuestion)
    return
  }
  try {
    const res = await soloStart({ mode: props.mode, themeId: props.themeId, nickname: props.nickname })
    sessionId.value = res.sessionId
    loadNext()
  } catch (e) {
    fail(e)
  }
})

onUnmounted(() => unsubscribers.forEach((off) => off()))
</script>

<template>
  <main class="game">
    <header class="bar">
      <button class="quit" type="button" @click="emit('exit')">← Accueil</button>
      <span class="title">{{ title }}</span>
      <span class="count">
        <template v-if="question && phase !== 'done'">{{ question.index }} / {{ question.total }}</template>
      </span>
    </header>

    <!-- Question : on valide et on enchaîne, sans correction -->
    <section v-if="question && ['question', 'sending', 'waiting'].includes(phase)" class="play">
      <div class="progress" aria-hidden="true">
        <span
          v-for="n in question.total"
          :key="n"
          :class="{ done: n < question.index, now: n === question.index }"
        ></span>
      </div>

      <div class="head">
        <p class="meta">
          Question {{ question.index }} sur {{ question.total }}
          <span v-if="question.theme"> · {{ question.theme }}</span>
        </p>
        <timer-gauge
          v-if="phase !== 'waiting'"
          class="gauge"
          :durationMs="question.durationMs"
          :deadline="deadline"
          @timeout="onTimeout"
        ></timer-gauge>
      </div>

      <h1 class="question">{{ question.text }}</h1>

      <!-- QCM -->
      <div v-if="question.type === 'choice'" class="choices">
        <button
          v-for="(choice, i) in question.choices"
          :key="i"
          type="button"
          class="choice"
          :class="{ picked: picked === i }"
          :disabled="phase !== 'question'"
          @click="answer(i)"
        >
          <span class="letter">{{ LETTERS[i] }}</span>
          <span class="label">{{ choice }}</span>
        </button>
      </div>

      <!-- Réponse libre -->
      <form v-else class="free" @submit.prevent="submitText">
        <input
          ref="textInput"
          v-model="typed"
          class="field"
          placeholder="Tape ta réponse"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          :disabled="phase !== 'question'"
        />
        <button class="btn primary" type="submit" :disabled="phase !== 'question' || !typed.trim()">Valider</button>
      </form>

      <p v-if="phase === 'waiting'" class="waiting" role="status">
        {{ picked === null ? 'Temps écoulé.' : 'Réponse enregistrée.' }}
        On attend les autres joueurs
        <template v-if="answered.playerCount">({{ answered.answeredCount }} / {{ answered.playerCount }})</template>…
      </p>
    </section>

    <!-- Fin de partie : score puis correction complète -->
    <section v-else-if="phase === 'done'" class="end">
      <div class="summary">
        <p class="eyebrow">{{ isRoom ? 'Partie terminée' : `${title} terminé` }}</p>
        <p class="final">{{ final.score.toLocaleString('fr-FR') }} <span>pts</span></p>
        <p class="sub">
          {{ goodCount }} bonne{{ goodCount > 1 ? 's' : '' }} réponse{{ goodCount > 1 ? 's' : '' }} sur {{ final.recap.length }}
          <template v-if="final.rank">
            · <strong>{{ final.rank }}<sup>{{ final.rank === 1 ? 'er' : 'e' }}</sup></strong>
            {{ isRoom ? `sur ${leaderboard.length}` : 'au classement du jour' }}
          </template>
        </p>
      </div>

      <template v-if="isRoom && leaderboard.length">
        <h2 class="recap-title">Classement de la partie</h2>
        <div class="board">
          <ScoreBoard :leaderboard="leaderboard" :highlight="playerId" />
        </div>
      </template>

      <h2 class="recap-title">La correction</h2>
      <ol class="recap">
        <li v-for="item in final.recap" :key="item.questionId" :class="item.correct ? 'ok' : 'ko'">
          <span class="num">{{ item.index }}</span>
          <div class="body">
            <p class="q">{{ item.text }}</p>
            <div class="answers">
              <p class="mine">
                <span class="tag">Ta réponse</span>
                <span class="val">{{ item.yourAnswer ?? 'Pas de réponse' }}</span>
              </p>
              <p class="truth">
                <span class="tag">Bonne réponse</span>
                <span class="val">{{ item.correctAnswer }}</span>
              </p>
            </div>
          </div>
          <span class="pts">{{ item.correct ? `+${item.points}` : '0' }}</span>
        </li>
      </ol>

      <button class="btn primary back" type="button" @click="emit('exit')">Retour à l'accueil</button>
    </section>

    <section v-else-if="phase === 'error'" class="center">
      <p class="err">{{ error }}</p>
      <button class="btn" type="button" @click="emit('exit')">Retour à l'accueil</button>
    </section>

    <section v-else class="center">
      <p class="meta">Chargement…</p>
    </section>
  </main>
</template>

<style scoped>
.game {
  max-width: 46rem;
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
  gap: 0.8rem;
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

.count {
  justify-self: end;
  font-weight: 700;
  color: var(--ink-soft);
  font-variant-numeric: tabular-nums;
}

.play {
  display: flex;
  flex-direction: column;
  gap: 1.2rem;
}

.progress {
  display: flex;
  gap: 4px;
}

.progress span {
  flex: 1;
  height: 5px;
  border-radius: 3px;
  background: var(--line);
}

.progress .done {
  background: var(--accent);
}

.progress .now {
  background: var(--gold);
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  min-height: 5.5rem;
}

.meta {
  margin: 0;
  color: var(--ink-soft);
  font-weight: 600;
}

.gauge {
  width: 8.5rem;
  flex: none;
  font-size: 0.8rem;
  border: 1px solid var(--line);
}

.question {
  margin: 0;
  font-family: var(--serif);
  font-weight: 600;
  font-size: clamp(1.5rem, 4.5vw, 2.1rem);
  line-height: 1.25;
  text-wrap: balance;
}

.choices {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.8rem;
}

.choice {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  padding: 1rem;
  min-height: 4.2rem;
  border: 1.5px solid var(--line);
  border-radius: 0.7rem;
  background: var(--card);
  color: var(--ink);
  text-align: left;
  font-size: 1.05rem;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, opacity 0.2s;
}

.choice:not(:disabled):hover {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.choice:disabled {
  cursor: default;
}

.letter {
  flex: none;
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border-radius: 0.4rem;
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 800;
}

.choice.picked {
  border-color: var(--accent);
  background: var(--accent-soft);
}






.free {
  display: flex;
  gap: 0.6rem;
}

.field {
  flex: 1;
  min-width: 0;
  font: inherit;
  font-size: 1.15rem;
  font-weight: 600;
  padding: 0.85rem 1rem;
  border: 1.5px solid var(--line);
  border-radius: 0.6rem;
  background: var(--card);
  color: var(--ink);
}










.center {
  min-height: 50vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  text-align: center;
}

.waiting {
  margin: 0;
  padding: 0.9rem 1rem;
  border-radius: 0.6rem;
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}

.board {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 0.9rem;
  padding: 0.6rem 1rem;
}

.end {
  display: flex;
  flex-direction: column;
  gap: 1.2rem;
}

.summary {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
  padding: 1.5rem 1rem;
  text-align: center;
  background: var(--card);
  border: 1px solid var(--line);
  border-top: 4px solid var(--gold);
  border-radius: 0.9rem;
}

.sub {
  margin: 0;
  color: var(--ink-soft);
}

.recap-title {
  margin: 0.4rem 0 0;
  font-size: 1.1rem;
}

.recap {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}

.recap li {
  display: grid;
  grid-template-columns: 2rem minmax(0, 1fr) auto;
  gap: 0.8rem;
  align-items: start;
  padding: 1rem;
  background: var(--card);
  border: 1px solid var(--line);
  border-left: 5px solid;
  border-radius: 0.7rem;
}

.recap li.ok {
  border-left-color: var(--good);
}

.recap li.ko {
  border-left-color: var(--bad);
}

.num {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border-radius: 50%;
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 800;
}

.q {
  margin: 0 0 0.6rem;
  font-family: var(--serif);
  font-size: 1.1rem;
  font-weight: 600;
  line-height: 1.3;
}

.answers {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.6rem;
}

.answers p {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.5rem 0.7rem;
  border-radius: 0.5rem;
}

.ok .mine {
  background: var(--good-soft);
}

.ko .mine {
  background: var(--bad-soft);
}

.truth {
  background: var(--paper);
}

.tag {
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--ink-soft);
}

.val {
  font-weight: 700;
  overflow-wrap: anywhere;
}

.ko .mine .val {
  color: var(--bad);
}

.ok .mine .val {
  color: var(--good);
}

.pts {
  font-weight: 800;
  color: var(--gold);
  font-variant-numeric: tabular-nums;
}

.ko .pts {
  color: var(--ink-soft);
}

.back {
  align-self: center;
}

.eyebrow {
  margin: 0;
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--accent);
}

.final {
  margin: 0;
  font-family: var(--serif);
  font-size: 4rem;
  font-weight: 700;
  color: var(--ink);
}

.final span {
  font-size: 1.5rem;
  color: var(--gold);
}


.err {
  color: var(--bad);
  font-weight: 600;
}

@media (max-width: 520px) {
  .choices,
  .answers {
    grid-template-columns: 1fr;
  }
}
</style>
