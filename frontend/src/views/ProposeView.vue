<script setup>
import { ref, watch, onMounted } from 'vue'
import { listLabels, proposalQuota, submitProposal, myProposals } from '../services/socketClient.js'

// Un joueur propose une question ; un admin la validera, la corrigera ou la refusera.
// Le serveur limite à une proposition par jour.
const props = defineProps({
  nickname: { type: String, required: true },
})
const emit = defineEmits(['exit'])

const LETTERS = ['A', 'B', 'C', 'D']
const FIELD_ERRORS = {
  text: 'La question doit faire entre 10 et 200 caractères.',
  choices: 'Remplis les 4 réponses, toutes différentes.',
  answerIndex: 'Indique la bonne réponse.',
  acceptedAnswers: 'Donne au moins une réponse acceptée.',
  labelIds: 'Choisis au moins un thème.',
  type: 'Choisis le type de question.',
}
const STATUS = { pending: 'En attente', approved: 'Validée', rejected: 'Refusée' }

const labels = ref([])
const quota = ref(null) // { canPropose, nextAt? }
const mine = ref([])
const error = ref('')
const sent = ref(false)
const sending = ref(false)

const form = ref({ type: 'choice', text: '', choices: ['', '', '', ''], answerIndex: null, acceptedAnswers: [''], labelIds: [] })


// Même règles que le serveur, pour prévenir avant l'envoi
function check(f) {
  const text = f.text.trim()
  if (text.length < 10 || text.length > 200) return 'text'
  if (f.type === 'choice') {
    const c = f.choices.map((x) => x.trim().toLowerCase())
    if (c.some((x) => !x) || new Set(c).size !== 4) return 'choices'
    if (f.answerIndex === null) return 'answerIndex'
  } else if (!f.acceptedAnswers.some((a) => a.trim())) return 'acceptedAnswers'
  if (!f.labelIds.length) return 'labelIds'
  return null
}

// Le message d'erreur disparaît dès que le joueur corrige le formulaire
watch(form, () => (error.value = ''), { deep: true })

function toggleLabel(id) {
  const ids = form.value.labelIds
  form.value.labelIds = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
}

function addAccepted() {
  if (form.value.acceptedAnswers.length < 5) form.value.acceptedAnswers.push('')
}

function removeAccepted(i) {
  form.value.acceptedAnswers.splice(i, 1)
  if (!form.value.acceptedAnswers.length) form.value.acceptedAnswers.push('')
}

async function refresh() {
  const [q, m] = await Promise.all([proposalQuota(props.nickname), myProposals(props.nickname)])
  quota.value = q
  mine.value = m.proposals
}

async function submit() {
  error.value = ''
  const field = check(form.value)
  if (field) {
    error.value = FIELD_ERRORS[field]
    return
  }
  const f = form.value
  sending.value = true
  try {
    await submitProposal({
      nickname: props.nickname,
      type: f.type,
      text: f.text.trim(),
      labelIds: f.labelIds,
      ...(f.type === 'choice'
        ? { choices: f.choices.map((x) => x.trim()), answerIndex: f.answerIndex }
        : { acceptedAnswers: f.acceptedAnswers.map((x) => x.trim()).filter(Boolean) }),
    })
    await refresh()
    sent.value = true
  } catch (e) {
    if (e.message === 'DAILY_LIMIT') await refresh()
    error.value = e.message === 'DAILY_LIMIT' ? 'Tu as déjà proposé une question aujourd\'hui.' : `Erreur : ${e.message}`
  } finally {
    sending.value = false
  }
}

onMounted(async () => {
  try {
    labels.value = (await listLabels()).labels
    await refresh()
  } catch (e) {
    error.value = `Impossible de joindre le serveur (${e.message}).`
  }
})
</script>

<template>
  <main class="propose">
    <header class="bar">
      <button class="quit" type="button" @click="emit('exit')">← Accueil</button>
      <span class="title">Proposer une question</span>
      <span></span>
    </header>

    <!-- Envoyée -->
    <section v-if="sent" class="card done">
      <h1>Merci {{ nickname }} !</h1>
      <p class="muted">Ta question est en attente de validation par un admin. Tu peux suivre son statut ci-dessous.</p>
    </section>

    <!-- Limite atteinte -->
    <section v-else-if="quota && !quota.canPropose" class="card done">
      <h1>Une question par jour</h1>
      <p class="muted">Tu as déjà proposé une question aujourd'hui. Tu pourras en proposer une autre demain.</p>
    </section>

    <!-- Formulaire -->
    <form v-else-if="quota" class="card" @submit.prevent="submit">
      <p class="muted">Une proposition par jour. Un admin la relit avant qu'elle n'entre dans les quiz.</p>

      <fieldset class="types">
        <legend>Type de question</legend>
        <label :class="{ on: form.type === 'choice' }">
          <input v-model="form.type" type="radio" name="type" value="choice" /> QCM à 4 réponses
        </label>
        <label :class="{ on: form.type === 'text' }">
          <input v-model="form.type" type="radio" name="type" value="text" /> Réponse libre
        </label>
      </fieldset>

      <label class="field" for="p-text">
        <span>Question</span>
        <textarea id="p-text" v-model="form.text" rows="3" maxlength="200" placeholder="ex. Quel est le plus long fleuve d'Europe ?"></textarea>
        <small>{{ form.text.trim().length }} / 200</small>
      </label>

      <fieldset v-if="form.type === 'choice'" class="field">
        <legend>Réponses <small>(coche la bonne)</small></legend>
        <div v-for="(c, i) in form.choices" :key="i" class="choice-row" :class="{ right: form.answerIndex === i }">
          <input
            :id="`p-correct-${i}`"
            v-model="form.answerIndex"
            type="radio"
            name="correct"
            :value="i"
            :aria-label="`Réponse ${LETTERS[i]} est la bonne`"
          />
          <span class="letter">{{ LETTERS[i] }}</span>
          <input :id="`p-choice-${i}`" v-model="form.choices[i]" class="input" maxlength="80" :placeholder="`Réponse ${LETTERS[i]}`" />
        </div>
      </fieldset>

      <fieldset v-else class="field">
        <legend>Réponses acceptées <small>(variantes : « Napoléon », « Bonaparte »…)</small></legend>
        <div v-for="(a, i) in form.acceptedAnswers" :key="i" class="accepted-row">
          <input :id="`p-accepted-${i}`" v-model="form.acceptedAnswers[i]" class="input" maxlength="80" placeholder="Une réponse acceptée" />
          <button v-if="form.acceptedAnswers.length > 1" class="icon" type="button" :aria-label="`Retirer la variante ${i + 1}`" @click="removeAccepted(i)">×</button>
        </div>
        <button v-if="form.acceptedAnswers.length < 5" class="link" type="button" @click="addAccepted">+ Ajouter une variante</button>
      </fieldset>

      <fieldset class="field">
        <legend>Thème(s)</legend>
        <div class="chips">
          <button
            v-for="l in labels"
            :key="l.id"
            type="button"
            class="chip"
            :class="{ on: form.labelIds.includes(l.id) }"
            :aria-pressed="form.labelIds.includes(l.id)"
            @click="toggleLabel(l.id)"
          >
            {{ l.name }}
          </button>
        </div>
      </fieldset>

      <p v-if="error" class="err" role="alert">{{ error }}</p>
      <button class="btn primary send" type="submit" :disabled="sending">
        {{ sending ? 'Envoi…' : 'Envoyer ma proposition' }}
      </button>
    </form>

    <p v-else-if="error" class="err">{{ error }}</p>

    <!-- Suivi -->
    <section v-if="mine.length" class="card">
      <h2>Mes propositions</h2>
      <ul class="mine">
        <li v-for="p in mine" :key="p.id">
          <span class="q">{{ p.text }}</span>
          <span class="status" :class="p.status">{{ STATUS[p.status] }}</span>
          <span v-if="p.rejectReason" class="reason">Motif : {{ p.rejectReason }}</span>
        </li>
      </ul>
    </section>
  </main>
</template>

<style scoped>
.propose {
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
  gap: 1.1rem;
}

.done {
  border-top: 4px solid var(--gold);
}

h1,
h2 {
  margin: 0;
  font-family: var(--serif);
  font-weight: 600;
}

h1 {
  font-size: 1.6rem;
}

h2 {
  font-size: 1.15rem;
}

.muted {
  margin: 0;
  color: var(--ink-soft);
  line-height: 1.5;
}

fieldset {
  border: none;
  margin: 0;
  padding: 0;
}

legend,
.field > span {
  font-weight: 700;
  margin-bottom: 0.45rem;
  padding: 0;
}

legend small {
  font-weight: 500;
  color: var(--ink-soft);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.field small {
  align-self: flex-end;
  color: var(--ink-soft);
}

.types {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
}

.types legend {
  width: 100%;
}

.types label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 0.9rem;
  border: 1.5px solid var(--line);
  border-radius: 0.6rem;
  font-weight: 600;
  cursor: pointer;
}

.types label.on {
  border-color: var(--accent);
  background: var(--accent-soft);
}

textarea,
.input {
  font: inherit;
  font-size: 1rem;
  padding: 0.7rem 0.85rem;
  border: 1px solid var(--line);
  border-radius: 0.5rem;
  background: var(--card);
  color: var(--ink);
  width: 100%;
  min-width: 0;
}

textarea {
  resize: vertical;
  font-family: var(--serif);
  font-size: 1.1rem;
}

.choice-row,
.accepted-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.choice-row input[type='radio'] {
  width: 1.2rem;
  height: 1.2rem;
  accent-color: var(--good);
  flex: none;
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

.icon {
  flex: none;
  width: 2.2rem;
  height: 2.2rem;
  border: 1px solid var(--line);
  border-radius: 0.5rem;
  background: var(--card);
  color: var(--ink-soft);
  font-size: 1.2rem;
  cursor: pointer;
}

.link {
  align-self: flex-start;
  border: none;
  background: none;
  padding: 0.2rem 0;
  color: var(--accent);
  font-weight: 700;
  cursor: pointer;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.chip {
  padding: 0.45rem 0.85rem;
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

.send {
  align-self: flex-start;
}

.err {
  margin: 0;
  color: var(--bad);
  font-weight: 600;
}

.mine {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.mine li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.3rem 0.8rem;
  align-items: center;
  padding: 0.65rem 0;
  border-bottom: 1px solid var(--line);
}

.mine li:last-child {
  border-bottom: none;
}

.mine .q {
  font-weight: 600;
}

.status {
  font-size: 0.78rem;
  font-weight: 700;
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
}

.status.approved {
  background: var(--good-soft);
  color: var(--good);
}

.status.rejected {
  background: var(--bad-soft);
  color: var(--bad);
}

.reason {
  grid-column: 1 / -1;
  font-size: 0.9rem;
  color: var(--ink-soft);
}
</style>
