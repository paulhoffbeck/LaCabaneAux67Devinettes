import { io } from 'socket.io-client'

// Le backend tourne sur la même machine que le front, sur son propre port.
// Depuis un téléphone, location.hostname vaut l'IP du PC : ça marche sans configuration.
const SERVER_PORT = 3000
const SERVER_URL = `${window.location.protocol}//${window.location.hostname}:${SERVER_PORT}`

// Une seule connexion pour toute l'application
export const socket = io(SERVER_URL, { autoConnect: true })

// Envoie un événement et attend l'accusé de réception du serveur.
// Le serveur répond { ok: true, ... } ou { ok: false, error: 'CODE' }.
function request(event, payload = {}, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    socket.timeout(timeoutMs).emit(event, payload, (err, response) => {
      if (err) return reject(new Error('TIMEOUT'))
      if (!response?.ok) return reject(new Error(response?.error ?? 'UNKNOWN_ERROR'))
      resolve(response)
    })
  })
}

// --- Accueil ---
export const listThemes = () => request('themes:list')
export const dailyStatus = (nickname) => request('daily:status', { nickname })
export const dailyLeaderboard = (date) => request('daily:leaderboard', date ? { date } : {})

// --- Modes solo (quiz du jour, thèmes) ---
// mode : 'daily' | 'theme'
export const soloStart = ({ mode, themeId, nickname }) => request('solo:start', { mode, themeId, nickname })
export const soloNext = (sessionId) => request('solo:next', { sessionId })
// answer : numéro 0-3 (QCM), texte (réponse libre) ou null (temps écoulé)
export const soloAnswer = (sessionId, questionId, answer) =>
  request('solo:answer', { sessionId, questionId, answer })

// --- Partie perso (temps réel) ---
export const roomCreate = (settings) => request('room:create', settings)
export const roomJoin = (roomCode, nickname) => request('room:join', { roomCode, nickname })
export const roomStart = (roomCode) => request('room:start', { roomCode })
export const roomAnswer = (roomCode, questionId, answer) =>
  request('room:answer', { roomCode, questionId, answer })

// --- Propositions de questions ---
export const listLabels = () => request('labels:list')
export const proposalQuota = (nickname) => request('proposal:quota', { nickname })
// proposal : { nickname, type, text, choices?, answerIndex?, acceptedAnswers?, labelIds }
export const submitProposal = (proposal) => request('proposal:submit', proposal)
export const myProposals = (nickname) => request('proposal:mine', { nickname })

// --- Admin ---
export const adminLogin = (name, password) => request('admin:login', { name, password })
export const adminPending = (token) => request('admin:pending', { token })
// decision : 'approve' | 'reject' ; edits : champs corrigés avant validation
export const adminReview = (token, proposalId, decision, { edits, reason } = {}) =>
  request('admin:review', { token, proposalId, decision, edits, reason })

// Abonnement à un événement serveur ; renvoie la fonction de désabonnement
// (à appeler dans onUnmounted).
export function on(event, handler) {
  socket.on(event, handler)
  return () => socket.off(event, handler)
}

// Les horloges du serveur et du joueur ne sont jamais parfaitement d'accord.
// On convertit donc la durée reçue en échéance locale, au moment de la réception.
export function localDeadline({ durationMs }) {
  return Date.now() + durationMs
}
