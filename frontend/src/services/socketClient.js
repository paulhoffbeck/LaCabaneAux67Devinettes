import { io } from 'socket.io-client'

// en dev le back est sur le port 3000, en prod c'est Express qui sert le front donc même adresse
const SERVER_PORT = 3000
const SERVER_URL = import.meta.env.DEV
  ? `${window.location.protocol}//${window.location.hostname}:${SERVER_PORT}`
  : undefined

export const socket = io(SERVER_URL, { autoConnect: true })

function request(event, payload = {}, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    socket.timeout(timeoutMs).emit(event, payload, (err, response) => {
      if (err) return reject(new Error('TIMEOUT'))
      if (!response?.ok) return reject(new Error(response?.error ?? 'UNKNOWN_ERROR'))
      resolve(response)
    })
  })
}

export const listThemes = () => request('themes:list')
export const dailyStatus = (nickname) => request('daily:status', { nickname })
export const dailyLeaderboard = (date) => request('daily:leaderboard', date ? { date } : {})

export const soloStart = ({ mode, themeId, nickname }) => request('solo:start', { mode, themeId, nickname })
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

export function on(event, handler) {
  socket.on(event, handler)
  return () => socket.off(event, handler)
}

export function localDeadline({ durationMs }) {
  return Date.now() + durationMs
}
