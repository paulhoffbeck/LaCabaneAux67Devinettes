import { io } from 'socket.io-client'

// 1. Configuration & Connexion unique
const SERVER_PORT = 3000
const SERVER_URL = `${window.location.protocol}//${window.location.hostname}:${SERVER_PORT}`

export const socket = io('/', { autoConnect: true })

// --- LOGS & ÉCOUTEURS DE DÉBOGAGE WEBSOCKET ---
socket.on('connect', () => {
  console.log('[Socket] Connecté au serveur ! ID :', socket.id)
})

socket.on('connect_error', (err) => {
  console.error('[Socket] Erreur de connexion :', err.message, err)
})

socket.on('disconnect', (reason) => {
  console.warn('[Socket] Déconnecté :', reason)
})

socket.onAnyOutgoing((event, ...args) => {
  console.log(`[Socket OUT] "${event}"`, args)
})

socket.onAny((event, ...args) => {
  console.log(`[Socket IN] "${event}"`, args)
})

// --- FONCTION REQUEST VERBEUSE ---
function request(event, payload = {}, timeoutMs = 5000) {
  console.log(`[API Request] Envoi de "${event}" :`, payload)
  return new Promise((resolve, reject) => {
    socket.timeout(timeoutMs).emit(event, payload, (err, response) => {
      if (err) {
        console.error(`[API Timeout] Aucune réponse du serveur après ${timeoutMs}ms pour "${event}"`)
        return reject(new Error('TIMEOUT'))
      }
      console.log(`[API Response] Réponse pour "${event}" :`, response)
      if (!response?.ok) {
        console.error(`[API Error] Le serveur a répondu non-ok pour "${event}" :`, response?.error)
        return reject(new Error(response?.error ?? 'UNKNOWN_ERROR'))
      }
      resolve(response)
    })
  })
}

// --- UTILITAIRES D'ÉCOUTE ET D'HORLOGE ---
export function on(event, handler) {
  socket.on(event, handler)
  return () => socket.off(event, handler)
}

export function localDeadline({ durationMs }) {
  return Date.now() + durationMs
}

export const socketUtils = { on, localDeadline }

// --- EXPORTS INDIVIDUELS (Pour PlayerView, HostView, etc.) ---
export const listThemes = () => request('themes:list')
export const dailyStatus = (nickname) => request('daily:status', { nickname })
export const dailyLeaderboard = (date) => request('daily:leaderboard', date ? { date } : {})

export const soloStart = (params) => request('solo:start', params)
export const soloNext = (sessionId) => request('solo:next', { sessionId })
export const soloAnswer = (sessionId, questionId, answer) =>
  request('solo:answer', { sessionId, questionId, answer })

export const roomCreate = (settings) => request('room:create', settings)
export const roomJoin = (roomCode, nickname) => request('room:join', { roomCode, nickname })
export const roomStart = (roomCode) => request('room:start', { roomCode })
export const roomAnswer = (roomCode, questionId, answer) =>
  request('room:answer', { roomCode, questionId, answer })

export const listLabels = () => request('labels:list')
export const proposalQuota = (nickname) => request('proposal:quota', { nickname })
export const submitProposal = (proposal) => request('proposal:submit', proposal)
export const myProposals = (nickname) => request('proposal:mine', { nickname })

export const adminLogin = (name, password) => request('admin:login', { name, password })
export const adminPending = (token) => request('admin:pending', { token })
export const adminReview = (token, proposalId, decision, { edits, reason } = {}) =>
  request('admin:review', { token, proposalId, decision, edits, reason })

// --- EXPORT STRUCTURÉ ---
export const api = {
  themes: { list: listThemes },
  daily: { getStatus: dailyStatus, getLeaderboard: dailyLeaderboard },
  solo: { start: soloStart, next: soloNext, answer: soloAnswer },
  room: { create: roomCreate, join: roomJoin, start: roomStart, answer: roomAnswer },
  proposals: { listLabels, getQuota: proposalQuota, submit: submitProposal, getMine: myProposals },
  admin: { login: adminLogin, getPending: adminPending, review: adminReview },
}
