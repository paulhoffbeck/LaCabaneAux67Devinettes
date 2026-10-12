<script setup>
import { ref, onMounted } from 'vue'
import { adminLogin, adminPending, adminReview, listLabels } from '../services/socketClient.js'

// Espace admin : relire les questions proposées, les corriger, puis les valider ou les refuser.
const emit = defineEmits(['exit'])

const LETTERS = ['A', 'B', 'C', 'D']
const FIELD_ERRORS = {
  text: 'La question doit faire entre 10 et 200 caractères.',
  choices: 'Il faut 4 réponses non vides et différentes.',
  answerIndex: 'Indique la bonne réponse.',
  acceptedAnswers: 'Il faut au moins une réponse acceptée.',
  labelIds: 'Il faut au moins un thème.',
}

// Le jeton ne vit que le temps de l'onglet
const TOKEN_KEY = 'quiz-clash:admin-token'
function readToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}
function saveToken(value) {
  try {
    if (value) sessionStorage.setItem(TOKEN_KEY, value)
    else sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    // stockage indisponible : on garde le jeton en mémoire
  }
}

const token = ref(readToken())
const name = ref('')
const password = ref('')
const loginError = ref('')
const labels = ref([])
const items = ref([]) // propositions en attente, chacune avec son brouillon modifiable
const notice = ref('')
const loading = ref(false)

// Brouillon éditable : on ne touche pas à l'original tant que l'admin n'a pas validé
function toDraft(p) {
  return {
    original: p,
    draft: {
      text: p.text,
      choices: p.type === 'choice' ? [...p.choices] : [],
      answerIndex: p.answerIndex ?? null,
      accepted: p.type === 'text' ? p.acceptedAnswers.join('\n') : '',
      labelIds: [...p.labelIds],
    },
    rejecting: false,
    reason: '',
    error: '',
    busy: false,
  }
}

async function load() {
  loading.value = true
  try {
    const [pending, l] = await Promise.all([adminPending(token.value), listLabels()])
    items.value = pending.proposals.map(toDraft)
    labels.value = l.labels
  } catch (e) {
    if (e.message === 'UNAUTHORIZED') logout()
    else notice.value = `Erreur : ${e.message}`
  } finally {
    loading.value = false
  }
}

async function login() {
  loginError.value = ''
  try {
    const res = await adminLogin(name.value.trim(), password.value)
    token.value = res.token
    saveToken(res.token)
    password.value = ''
    load()
  } catch (e) {
    loginError.value = e.message === 'BAD_CREDENTIALS' ? 'Identifiant ou mot de passe incorrect.' : `Erreur : ${e.message}`
  }
}

function logout() {
  token.value = ''
  saveToken('')
  items.value = []
}

const labelName = (id) => labels.value.find((l) => l.id === id)?.name ?? id
const when = (ts) =>
  new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(ts)

function toggleLabel(item, id) {
  const ids = item.draft.labelIds
  item.draft.labelIds = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
}

// Les champs modifiés par l'admin, envoyés avec la validation
function editsOf(item) {
  const { original: p, draft: d } = item
  const edits = { text: d.text.trim(), labelIds: d.labelIds }
  if (p.type === 'choice') Object.assign(edits, { choices: d.choices.map((c) => c.trim()), answerIndex: d.answerIndex })
  else edits.acceptedAnswers = d.accepted.split('\n').map((a) => a.trim()).filter(Boolean)
  return edits
}

async function review(item, decision) {
  item.error = ''
  item.busy = true
  try {
    await adminReview(token.value, item.original.id, decision, decision === 'approve' ? { edits: editsOf(item) } : { reason: item.reason })
    items.value = items.value.filter((x) => x !== item)
    notice.value = decision === 'approve' ? 'Question validée : elle entre dans les quiz.' : 'Proposition refusée.'
  } catch (e) {
    if (e.message === 'UNAUTHORIZED') return logout()
    item.error = e.message === 'INVALID' ? 'Corrige la question avant de la valider.' : `Erreur : ${e.message}`
  } finally {
    item.busy = false
  }
}

onMounted(() => {
  if (token.value) load()
})
</script>

<template>
  <main class="admin">
    <header class="bar">
      <button class="quit" type="button" @click="emit('exit')">← Accueil</button>
      <span class="title">Espace admin</span>
      <button v-if="token" class="quit right" type="button" @click="logout">Se déconnecter</button>
      <span v-else></span>
    </header>

    <!-- Connexion -->
    <form v-if="!token" class="card login" @submit.prevent="login">
      <h1>Connexion admin</h1>
      <label class="field" for="a-name">
        <span>Identifiant</span>
        <input id="a-name" v-model="name" class="input" autocomplete="username" />
      </label>
      <label class="field" for="a-password">
        <span>Mot de passe</span>
        <input id="a-password" v-model="password" class="input" type="password" autocomplete="current-password" />
      </label>
      <p v-if="loginError" class="err" role="alert">{{ loginError }}</p>
      <button class="btn primary" type="submit" :disabled="!name.trim() || !password">Se connecter</button>
    </form>

    <!-- Propositions en attente -->
    <template v-else>
      <div class="head">
        <h1>{{ items.length }} proposition{{ items.length > 1 ? 's' : '' }} en attente</h1>
        <button class="btn" type="button" :disabled="loading" @click="load">Actualiser</button>
      </div>
      <p v-if="notice" class="notice" role="status">{{ notice }}</p>
      <p v-if="!items.length && !loading" class="muted">Rien à relire pour le moment.</p>

      <article v-for="item in items" :key="item.original.id" class="card item">
        <p class="meta">
          Proposée par <strong>{{ item.original.nickname }}</strong> · {{ when(item.original.createdAt) }} ·
          {{ item.original.type === 'choice' ? 'QCM' : 'Réponse libre' }}
        </p>

        <label class="field" :for="`t-${item.original.id}`">
          <span>Question</span>
          <textarea :id="`t-${item.original.id}`" v-model="item.draft.text" rows="2" maxlength="200"></textarea>
        </label>

        <fieldset v-if="item.original.type === 'choice'" class="field">
          <legend>Réponses <small>(la bonne est cochée)</small></legend>
          <div v-for="(c, i) in item.draft.choices" :key="i" class="choice-row" :class="{ right: item.draft.answerIndex === i }">
            <input
              v-model="item.draft.answerIndex"
              type="radio"
              :name="`correct-${item.original.id}`"
              :value="i"
              :aria-label="`Réponse ${LETTERS[i]} est la bonne`"
            />
            <span class="letter">{{ LETTERS[i] }}</span>
            <input v-model="item.draft.choices[i]" class="input" maxlength="80" :aria-label="`Réponse ${LETTERS[i]}`" />
          </div>
        </fieldset>

        <label v-else class="field" :for="`a-${item.original.id}`">
          <span>Réponses acceptées <small>(une par ligne)</small></span>
          <textarea :id="`a-${item.original.id}`" v-model="item.draft.accepted" rows="3"></textarea>
        </label>

        <fieldset class="field">
          <legend>Thème(s)</legend>
          <div class="chips">
            <button
              v-for="l in labels"
              :key="l.id"
              type="button"
              class="chip"
              :class="{ on: item.draft.labelIds.includes(l.id) }"
              :aria-pressed="item.draft.labelIds.includes(l.id)"
              @click="toggleLabel(item, l.id)"
            >
              {{ labelName(l.id) }}
            </button>
          </div>
        </fieldset>

        <p v-if="item.error" class="err" role="alert">{{ item.error }}</p>

        <div v-if="!item.rejecting" class="actions">
          <button class="btn primary" type="button" :disabled="item.busy" @click="review(item, 'approve')">Valider</button>
          <button class="btn danger" type="button" :disabled="item.busy" @click="item.rejecting = true">Refuser</button>
        </div>
        <div v-else class="actions reject">
          <input v-model="item.reason" class="input" maxlength="120" placeholder="Motif (facultatif), visible par le joueur" :aria-label="`Motif du refus`" />
          <button class="btn danger" type="button" :disabled="item.busy" @click="review(item, 'reject')">Confirmer le refus</button>
          <button class="btn" type="button" @click="item.rejecting = false">Annuler</button>
        </div>
      </article>
    </template>
  </main>
</template>

<style scoped>
.admin {
  max-width: 46rem;
  margin: 0 auto;
  padding: 0 16px 2.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
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

.quit.right {
  justify-self: end;
}

.title {
  font-weight: 700;
}

.card {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 0.9rem;
  padding: 1.3rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.login {
  max-width: 24rem;
  width: 100%;
  align-self: center;
}

h1 {
  margin: 0;
  font-family: var(--serif);
  font-weight: 600;
  font-size: 1.4rem;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.muted {
  margin: 0;
  color: var(--ink-soft);
}

.notice {
  margin: 0;
  padding: 0.7rem 1rem;
  border-radius: 0.6rem;
  background: var(--good-soft);
  color: var(--good);
  font-weight: 600;
}

.meta {
  margin: 0;
  color: var(--ink-soft);
}

fieldset {
  border: none;
  margin: 0;
  padding: 0;
}

legend,
.field > span {
  font-weight: 700;
  margin-bottom: 0.4rem;
  padding: 0;
}

legend small,
.field > span small {
  font-weight: 500;
  color: var(--ink-soft);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

textarea,
.input {
  font: inherit;
  font-size: 1rem;
  padding: 0.65rem 0.8rem;
  border: 1px solid var(--line);
  border-radius: 0.5rem;
  background: var(--card);
  color: var(--ink);
  width: 100%;
  min-width: 0;
}

textarea {
  resize: vertical;
}

.choice-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.choice-row input[type='radio'] {
  width: 1.2rem;
  height: 1.2rem;
  flex: none;
  accent-color: var(--good);
}

.choice-row.right .input {
  border-color: var(--good);
  background: var(--good-soft);
}

.letter {
  flex: none;
  display: grid;
  place-items: center;
  width: 1.9rem;
  height: 1.9rem;
  border-radius: 0.4rem;
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 800;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.chip {
  padding: 0.4rem 0.8rem;
  border: 1.5px solid var(--line);
  border-radius: 999px;
  background: var(--card);
  color: var(--ink);
  font-weight: 600;
  cursor: pointer;
}

.chip.on {
  border-color: var(--accent);
  background: var(--accent);
  color: #fff;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
}

.actions.reject .input {
  flex: 1 1 14rem;
}

.btn.danger {
  border-color: var(--bad);
  color: var(--bad);
}

.err {
  margin: 0;
  color: var(--bad);
  font-weight: 600;
}
</style>
