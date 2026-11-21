import crypto from 'node:crypto'

const QUIZ_LENGTH = 10 // nb de questions en solo (quiz du jour et thèmes)
const SOLO_DURATION_MS = 20_000 // 20 s par question en solo
const GRACE_MS = 1500 // petite marge pour la latence, sinon on refuse des réponses envoyées à temps
const ROOM_NEXT_DELAY_MS = 1500 // quand tout le monde a répondu, on attend 1,5 s avant la suivante
const ROOM_MAX_PLAYERS = 50
const ROOM_COUNTS = [5, 10, 15]
const ROOM_DURATIONS = [10, 20, 30]
const ROOM_CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ' // pas de I ni de O, on les confond trop avec 1 et 0
const ADMIN_TOKEN_TTL_MS = 12 * 60 * 60 * 1000
const LOGIN_MAX_FAILURES = 10
const LOGIN_WINDOW_MS = 15 * 60 * 1000
const TIME_ZONE = process.env.QUIZ_TIME_ZONE ?? 'Europe/Paris'

// erreurs "normales" du jeu, le code part direct au front qui affiche le bon message
class GameError extends Error {}
const fail = (code) => {
  throw new GameError(code)
}

// date au format AAAA-MM-JJ, le quiz du jour change à minuit (heure de Paris)
function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date())
}

function randomId() {
  return crypto.randomBytes(12).toString('hex')
}

function shuffle(list) {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function cleanNickname(value) {
  const nickname = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
  if (nickname.length < 1 || nickname.length > 20) fail('INVALID_NICKNAME')
  return nickname
}

const parseList = (json) => (json ? JSON.parse(json) : [])

function toQuestion(row) {
  return {
    id: row.id,
    type: row.type,
    text: row.text,
    choices: parseList(row.choices),
    answerIndex: row.answerIndex,
    acceptedAnswers: parseList(row.acceptedAnswers),
    labels: row.labels ?? [],
  }
}

// ce qu'on envoie au joueur, donc évidemment sans la réponse
function publicQuestion(q, index, total, durationMs) {
  const theme = q.labels.find((l) => l.isTheme) ?? q.labels[0]
  return {
    questionId: q.id,
    index: index + 1,
    total,
    type: q.type,
    text: q.text,
    ...(q.type === 'choice' ? { choices: q.choices } : {}),
    theme: theme?.name ?? null,
    durationMs,
  }
}

// pour comparer les réponses libres : on vire accents, majuscules, ponctuation et articles
function normalize(text) {
  return text
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^(le|la|les|l|un|une|des|du|de la|de|d|the) /, '')
}

function levenshtein(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return row[b.length]
}

// on laisse passer une faute de frappe si le mot est assez long, mais pas pour les nombres
function textMatches(answer, accepted) {
  const a = normalize(answer)
  if (!a) return false
  return accepted.some((expected) => {
    const e = normalize(expected)
    if (a === e) return true
    if (/^\d+$/.test(e) || e.length < 5) return false
    return levenshtein(a, e) <= 1
  })
}

function cleanAnswer(q, answer) {
  if (q.type === 'choice') return Number.isInteger(answer) && answer >= 0 && answer < q.choices.length ? answer : null
  return typeof answer === 'string' && answer.trim() ? answer.trim().slice(0, 100) : null
}

function isCorrect(q, answer) {
  if (answer === null) return false
  return q.type === 'choice' ? answer === q.answerIndex : textMatches(answer, q.acceptedAnswers)
}

// 500 pts pour une bonne réponse, + jusqu'à 500 si on répond vite
function pointsFor(correct, elapsedMs, durationMs) {
  if (!correct) return 0
  const speed = Math.max(0, 1 - elapsedMs / durationMs)
  return Math.round((500 + 500 * speed) / 10) * 10
}

function scoreAnswer(q, rawAnswer, elapsedMs, durationMs) {
  const answer = elapsedMs > durationMs + GRACE_MS ? null : cleanAnswer(q, rawAnswer)
  const correct = isCorrect(q, answer)
  return { answer, correct, points: pointsFor(correct, elapsedMs, durationMs) }
}

function buildRecap(questions, answers) {
  return questions.map((q, i) => {
    const a = answers[i] ?? { answer: null, correct: false, points: 0 }
    const yourAnswer = a.answer === null ? null : q.type === 'choice' ? q.choices[a.answer] : a.answer
    return {
      questionId: q.id,
      index: i + 1,
      text: q.text,
      yourAnswer,
      correctAnswer: q.type === 'choice' ? q.choices[q.answerIndex] : q.acceptedAnswers[0],
      correct: a.correct,
      points: a.points,
    }
  })
}

const totalScore = (answers) => answers.reduce((sum, a) => sum + (a?.points ?? 0), 0)

// mêmes règles que dans ProposeView.vue (à garder synchro)
function validateQuestion(input) {
  const type = input.type
  const text = typeof input.text === 'string' ? input.text.trim() : ''
  if (!['choice', 'text'].includes(type)) return null
  if (text.length < 10 || text.length > 200) return null
  const labelIds = Array.isArray(input.labelIds) ? [...new Set(input.labelIds.map(Number))] : []
  if (!labelIds.length || labelIds.some((id) => !Number.isInteger(id))) return null

  if (type === 'choice') {
    const choices = Array.isArray(input.choices) ? input.choices.map((c) => (typeof c === 'string' ? c.trim() : '')) : []
    if (choices.length !== 4 || choices.some((c) => !c || c.length > 80)) return null
    if (new Set(choices.map((c) => c.toLowerCase())).size !== 4) return null
    if (!Number.isInteger(input.answerIndex) || input.answerIndex < 0 || input.answerIndex > 3) return null
    return { type, text, labelIds, choices, answerIndex: input.answerIndex, acceptedAnswers: [] }
  }
  const acceptedAnswers = Array.isArray(input.acceptedAnswers)
    ? input.acceptedAnswers.filter((a) => typeof a === 'string').map((a) => a.trim()).filter(Boolean)
    : []
  if (!acceptedAnswers.length || acceptedAnswers.length > 5 || acceptedAnswers.some((a) => a.length > 80)) return null
  return { type, text, labelIds, choices: [], answerIndex: null, acceptedAnswers }
}

function questionFields(q) {
  return {
    type: q.type,
    text: q.text,
    choices: q.type === 'choice' ? JSON.stringify(q.choices) : null,
    answerIndex: q.type === 'choice' ? q.answerIndex : null,
    acceptedAnswers: q.type === 'text' ? JSON.stringify(q.acceptedAnswers) : null,
  }
}

export function registerSockets(io, prisma) {
  const soloSessions = new Map()
  const rooms = new Map()
  const adminTokens = new Map()
  const loginFailures = new Map()
  const proposing = new Set() // pour éviter qu'un double clic envoie 2 propositions

  // les comptes admin sont dans le .env : ADMINS="robin:motdepasse,alex:autremotdepasse"
  const admins = new Map(
    (process.env.ADMINS ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const i = entry.indexOf(':')
        return [entry.slice(0, i).trim(), entry.slice(i + 1)]
      })
      .filter(([name, password]) => name && password),
  )
  if (!admins.size) console.warn('Aucun compte admin (variable ADMINS vide) : l\'espace admin est désactivé.')

  const withLabels = { labels: true }

  async function questionsByIds(ids) {
    const rows = await prisma.question.findMany({ where: { id: { in: ids } }, include: withLabels })
    const byId = new Map(rows.map((r) => [r.id, toQuestion(r)]))
    return ids.map((id) => byId.get(id)).filter(Boolean)
  }

  async function randomQuestions(count, labelId = null) {
    const where = labelId ? { labels: { some: { id: labelId } } } : {}
    const ids = (await prisma.question.findMany({ where, select: { id: true } })).map((r) => r.id)
    return questionsByIds(shuffle(ids).slice(0, count))
  }

  async function dailyQuestions(date) {
    let quiz = await prisma.dailyQuiz.findUnique({ where: { date } })
    if (!quiz) {
      const picked = await randomQuestions(QUIZ_LENGTH)
      try {
        quiz = await prisma.dailyQuiz.create({ data: { date, questionIds: JSON.stringify(picked.map((q) => q.id)) } })
      } catch {
        // cas où 2 joueurs lancent le 1er quiz du jour en même temps, on reprend celui déjà créé
        quiz = await prisma.dailyQuiz.findUnique({ where: { date } })
      }
    }
    return questionsByIds(JSON.parse(quiz.questionIds))
  }

  async function findTheme(themeId) {
    const id = Number(themeId)
    const label = Number.isInteger(id) ? await prisma.label.findUnique({ where: { id } }) : null
    if (!label) fail('THEME_NOT_FOUND')
    return label
  }

  async function dailyRank(date, score) {
    return (await prisma.score.count({ where: { date, finishedAt: { not: null }, score: { gt: score } } })) + 1
  }

  // --- admin ---

  function requireAdmin(token) {
    const session = typeof token === 'string' ? adminTokens.get(token) : null
    if (!session || session.expiresAt < Date.now()) {
      if (session) adminTokens.delete(token)
      fail('UNAUTHORIZED')
    }
    return session.name
  }

  function sameSecret(a, b) {
    const ha = crypto.createHash('sha256').update(String(a)).digest()
    const hb = crypto.createHash('sha256').update(String(b)).digest()
    return crypto.timingSafeEqual(ha, hb)
  }

  function clientIp(socket) {
    const forwarded = socket.handshake.headers['x-forwarded-for']
    return (typeof forwarded === 'string' && forwarded.split(',')[0].trim()) || socket.handshake.address
  }

  // --- parties perso ---

  function newRoomCode() {
    let code
    do {
      code = Array.from({ length: 4 }, () => ROOM_CODE_LETTERS[crypto.randomInt(ROOM_CODE_LETTERS.length)]).join('')
    } while (rooms.has(code))
    return code
  }

  const channel = (room) => `room:${room.code}`
  const connectedPlayers = (room) => [...room.players.values()].filter((p) => p.connected)

  function emitLobby(room) {
    const players = connectedPlayers(room).map((p) => ({ id: p.id, nickname: p.nickname, isCreator: p.id === room.creatorId }))
    io.to(channel(room)).emit('lobby:update', { players })
  }

  function emitAnswered(room) {
    const players = connectedPlayers(room)
    io.to(channel(room)).emit('question:answered', {
      answeredCount: players.filter((p) => p.answers[room.index]).length,
      playerCount: players.length,
    })
  }

  function closeRoom(room) {
    clearTimeout(room.timer)
    rooms.delete(room.code)
    io.in(channel(room)).socketsLeave(channel(room))
  }

  function nextRoomQuestion(room) {
    clearTimeout(room.timer)
    room.advancing = false
    room.index++
    if (room.index >= room.questions.length) return endRoom(room)
    room.shownAt = Date.now()
    const q = room.questions[room.index]
    io.to(channel(room)).emit('question:show', {
      question: publicQuestion(q, room.index, room.questions.length, room.durationMs),
    })
    emitAnswered(room)
    room.timer = setTimeout(() => nextRoomQuestion(room), room.durationMs + GRACE_MS)
  }

  function advanceIfAllAnswered(room) {
    if (room.status !== 'playing' || room.advancing) return
    const players = connectedPlayers(room)
    if (players.length && players.every((p) => p.answers[room.index])) {
      room.advancing = true
      clearTimeout(room.timer)
      room.timer = setTimeout(() => nextRoomQuestion(room), ROOM_NEXT_DELAY_MS)
    }
  }

  function endRoom(room) {
    room.status = 'over'
    const leaderboard = connectedPlayers(room)
      .map((p) => ({ id: p.id, nickname: p.nickname, score: totalScore(p.answers) }))
      .sort((a, b) => b.score - a.score)
    io.to(channel(room)).emit('game:over', { leaderboard })
    for (const p of connectedPlayers(room)) {
      const score = totalScore(p.answers)
      io.to(p.socketId).emit('game:recap', {
        score,
        rank: leaderboard.filter((e) => e.score > score).length + 1,
        recap: buildRecap(room.questions, p.answers),
      })
    }
    closeRoom(room)
  }

  function leaveRoom(socket) {
    const current = socket.data.room
    socket.data.room = null
    if (!current) return
    const room = rooms.get(current.code)
    if (!room) return
    socket.leave(channel(room))
    if (current.playerId === room.creatorId) {
      socket.to(channel(room)).emit('room:closed')
      return closeRoom(room)
    }
    if (room.status === 'lobby') {
      room.players.delete(current.playerId)
      return emitLobby(room)
    }
    const player = room.players.get(current.playerId)
    if (player) player.connected = false
    emitAnswered(room)
    advanceIfAllAnswered(room)
  }

  function playerOf(socket, roomCode) {
    const code = typeof roomCode === 'string' ? roomCode.trim().toUpperCase() : ''
    const room = rooms.get(code)
    if (!room) fail('ROOM_NOT_FOUND')
    const current = socket.data.room
    const player = current?.code === code ? room.players.get(current.playerId) : null
    if (!player) fail('NOT_IN_ROOM')
    return { room, player }
  }

  // --- événements socket ---

  io.on('connection', (socket) => {
    const mySessions = new Set()

    function handle(event, fn) {
      socket.on(event, async (payload, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {}
        try {
          const result = await fn(payload && typeof payload === 'object' ? payload : {})
          reply({ ok: true, ...result })
        } catch (e) {
          if (e instanceof GameError) return reply({ ok: false, error: e.message })
          console.error(`[${event}]`, e)
          reply({ ok: false, error: 'SERVER_ERROR' })
        }
      })
    }

    // --- accueil ---

    handle('themes:list', async () => {
      const labels = await prisma.label.findMany({
        where: { isTheme: true },
        include: { _count: { select: { questions: true } } },
        orderBy: { name: 'asc' },
      })
      return {
        themes: labels
          .filter((l) => l._count.questions > 0)
          .map((l) => ({ id: l.id, name: l.name, questionCount: l._count.questions })),
      }
    })

    handle('labels:list', async () => {
      const labels = await prisma.label.findMany({ orderBy: { name: 'asc' } })
      return { labels: labels.map((l) => ({ id: l.id, name: l.name })) }
    })

    handle('daily:status', async ({ nickname }) => {
      const date = today()
      const row = await prisma.score.findUnique({ where: { nickname_date: { nickname: cleanNickname(nickname), date } } })
      return row ? { date, played: true, score: row.score } : { date, played: false }
    })

    handle('daily:leaderboard', async ({ date }) => {
      const day = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today()
      const rows = await prisma.score.findMany({
        where: { date: day, finishedAt: { not: null } },
        orderBy: [{ score: 'desc' }, { finishedAt: 'asc' }],
        take: 50,
      })
      let rank = 0
      const entries = rows.map((r, i) => {
        if (i === 0 || r.score !== rows[i - 1].score) rank = i + 1
        return { nickname: r.nickname, score: r.score, rank }
      })
      return { date: day, entries }
    })

    // --- solo (quiz du jour + quiz à thème) ---

    handle('solo:start', async ({ mode, themeId, nickname }) => {
      const name = cleanNickname(nickname)
      const date = today()
      let questions
      if (mode === 'daily') {
        // on crée le score dès le début, comme ça pas de 2e essai en rechargeant la page
        try {
          await prisma.score.create({ data: { nickname: name, date } })
        } catch {
          fail('ALREADY_PLAYED')
        }
        questions = await dailyQuestions(date)
      } else if (mode === 'theme') {
        const label = await findTheme(themeId)
        questions = await randomQuestions(QUIZ_LENGTH, label.id)
      } else {
        fail('INVALID_MODE')
      }
      if (!questions.length) fail('NO_QUESTIONS')

      const sessionId = randomId()
      soloSessions.set(sessionId, { mode, nickname: name, date, questions, index: -1, answers: [], shownAt: 0, waiting: false, final: null })
      mySessions.add(sessionId)
      return { sessionId }
    })

    function soloSession(sessionId) {
      const session = mySessions.has(sessionId) ? soloSessions.get(sessionId) : null
      if (!session) fail('SESSION_NOT_FOUND')
      return session
    }

    handle('solo:next', async ({ sessionId }) => {
      const s = soloSession(sessionId)
      if (s.final) return s.final
      const total = s.questions.length

      // si la question a déjà été envoyée sans réponse, on la renvoie avec le temps qui reste
      if (s.waiting) {
        const left = Math.max(0, SOLO_DURATION_MS - (Date.now() - s.shownAt))
        return { done: false, question: publicQuestion(s.questions[s.index], s.index, total, left) }
      }

      s.index++
      if (s.index < total) {
        s.shownAt = Date.now()
        s.waiting = true
        return { done: false, question: publicQuestion(s.questions[s.index], s.index, total, SOLO_DURATION_MS) }
      }

      const score = totalScore(s.answers)
      let rank = null
      if (s.mode === 'daily') {
        await prisma.score.update({
          where: { nickname_date: { nickname: s.nickname, date: s.date } },
          data: { score, finishedAt: new Date() },
        })
        rank = await dailyRank(s.date, score)
      }
      s.final = { done: true, score, rank, recap: buildRecap(s.questions, s.answers) }
      return s.final
    })

    handle('solo:answer', async ({ sessionId, questionId, answer }) => {
      const s = soloSession(sessionId)
      const q = s.questions[s.index]
      if (!s.waiting || q?.id !== questionId) fail('TOO_LATE')
      s.answers[s.index] = scoreAnswer(q, answer ?? null, Date.now() - s.shownAt, SOLO_DURATION_MS)
      s.waiting = false
      return {}
    })

    // --- parties perso ---

    handle('room:create', async ({ nickname, themeId, questionCount, durationSec }) => {
      const name = cleanNickname(nickname)
      const label = themeId ? await findTheme(themeId) : null
      leaveRoom(socket)
      const room = {
        code: newRoomCode(),
        creatorId: randomId(),
        settings: {
          themeId: label?.id ?? null,
          questionCount: ROOM_COUNTS.includes(questionCount) ? questionCount : 10,
          durationSec: ROOM_DURATIONS.includes(durationSec) ? durationSec : 20,
        },
        players: new Map(),
        status: 'lobby',
        questions: [],
        index: -1,
        shownAt: 0,
        timer: null,
        advancing: false,
      }
      room.durationMs = room.settings.durationSec * 1000
      room.players.set(room.creatorId, { id: room.creatorId, nickname: name, socketId: socket.id, connected: true, answers: [] })
      rooms.set(room.code, room)
      socket.data.room = { code: room.code, playerId: room.creatorId }
      socket.join(channel(room))
      setImmediate(() => emitLobby(room))
      return { roomCode: room.code, playerId: room.creatorId }
    })

    handle('room:join', async ({ roomCode, nickname }) => {
      const name = cleanNickname(nickname)
      const code = typeof roomCode === 'string' ? roomCode.trim().toUpperCase() : ''
      const room = rooms.get(code)
      if (!room) fail('ROOM_NOT_FOUND')
      if (room.status !== 'lobby') fail('GAME_STARTED')
      const players = connectedPlayers(room)
      if (players.some((p) => p.nickname.toLowerCase() === name.toLowerCase())) fail('NICKNAME_TAKEN')
      if (players.length >= ROOM_MAX_PLAYERS) fail('ROOM_FULL')
      leaveRoom(socket)
      const playerId = randomId()
      room.players.set(playerId, { id: playerId, nickname: name, socketId: socket.id, connected: true, answers: [] })
      socket.data.room = { code, playerId }
      socket.join(channel(room))
      setImmediate(() => emitLobby(room))
      return { playerId, settings: room.settings }
    })

    handle('room:start', async ({ roomCode }) => {
      const { room, player } = playerOf(socket, roomCode)
      if (player.id !== room.creatorId) fail('NOT_CREATOR')
      if (room.status !== 'lobby') fail('GAME_STARTED')
      room.status = 'starting'
      const questions = await randomQuestions(room.settings.questionCount, room.settings.themeId)
      if (!rooms.has(room.code)) fail('ROOM_NOT_FOUND') // le créateur a quitté pendant le tirage
      if (!questions.length) {
        room.status = 'lobby'
        fail('NO_QUESTIONS')
      }
      room.questions = questions
      room.status = 'playing'
      setImmediate(() => nextRoomQuestion(room))
      return {}
    })

    handle('room:answer', async ({ roomCode, questionId, answer }) => {
      const { room, player } = playerOf(socket, roomCode)
      const q = room.questions[room.index]
      const elapsed = Date.now() - room.shownAt
      if (room.status !== 'playing' || q?.id !== questionId || player.answers[room.index] || elapsed > room.durationMs + GRACE_MS) {
        fail('TOO_LATE')
      }
      player.answers[room.index] = scoreAnswer(q, answer ?? null, elapsed, room.durationMs)
      emitAnswered(room)
      advanceIfAllAnswered(room)
      return {}
    })

    // --- propositions de questions ---

    async function hasProposedToday(nickname, date) {
      return (await prisma.proposal.count({ where: { nickname, date } })) > 0
    }

    handle('proposal:quota', async ({ nickname }) => {
      return { canPropose: !(await hasProposedToday(cleanNickname(nickname), today())) }
    })

    handle('proposal:submit', async (payload) => {
      const nickname = cleanNickname(payload.nickname)
      const date = today()
      const q = validateQuestion(payload)
      if (!q) fail('INVALID')
      if ((await prisma.label.count({ where: { id: { in: q.labelIds } } })) !== q.labelIds.length) fail('INVALID')

      const key = `${nickname}|${date}`
      if (proposing.has(key)) fail('DAILY_LIMIT')
      proposing.add(key)
      try {
        if (await hasProposedToday(nickname, date)) fail('DAILY_LIMIT')
        const proposal = await prisma.proposal.create({
          data: { nickname, date, ...questionFields(q), labels: { connect: q.labelIds.map((id) => ({ id })) } },
        })
        return { proposalId: proposal.id }
      } finally {
        proposing.delete(key)
      }
    })

    handle('proposal:mine', async ({ nickname }) => {
      const rows = await prisma.proposal.findMany({
        where: { nickname: cleanNickname(nickname) },
        orderBy: { createdAt: 'desc' },
        take: 20,
      })
      return {
        proposals: rows.map((p) => ({ id: p.id, text: p.text, status: p.status, rejectReason: p.rejectReason, createdAt: p.createdAt.getTime() })),
      }
    })

    // --- admin ---

    handle('admin:login', async ({ name, password }) => {
      const ip = clientIp(socket)
      const failures = loginFailures.get(ip)
      if (failures && Date.now() - failures.since > LOGIN_WINDOW_MS) loginFailures.delete(ip)
      if ((loginFailures.get(ip)?.count ?? 0) >= LOGIN_MAX_FAILURES) fail('TOO_MANY_ATTEMPTS')

      const expected = typeof name === 'string' ? admins.get(name.trim()) : undefined
      // on compare même si le compte existe pas, sinon on pourrait deviner les identifiants valides
      const valid = sameSecret(password ?? '', expected ?? randomId()) && expected !== undefined
      if (!valid) {
        const f = loginFailures.get(ip) ?? { count: 0, since: Date.now() }
        f.count++
        loginFailures.set(ip, f)
        fail('BAD_CREDENTIALS')
      }
      loginFailures.delete(ip)
      const token = randomId() + randomId()
      adminTokens.set(token, { name: name.trim(), expiresAt: Date.now() + ADMIN_TOKEN_TTL_MS })
      return { token }
    })

    handle('admin:pending', async ({ token }) => {
      requireAdmin(token)
      const rows = await prisma.proposal.findMany({
        where: { status: 'pending' },
        include: withLabels,
        orderBy: { createdAt: 'asc' },
      })
      return {
        proposals: rows.map((p) => ({
          id: p.id,
          nickname: p.nickname,
          createdAt: p.createdAt.getTime(),
          type: p.type,
          text: p.text,
          ...(p.type === 'choice' ? { choices: parseList(p.choices), answerIndex: p.answerIndex } : { acceptedAnswers: parseList(p.acceptedAnswers) }),
          labelIds: p.labels.map((l) => l.id),
        })),
      }
    })

    handle('admin:review', async ({ token, proposalId, decision, edits, reason }) => {
      const adminName = requireAdmin(token)
      const proposal = await prisma.proposal.findUnique({ where: { id: Number(proposalId) }, include: withLabels })
      if (!proposal || proposal.status !== 'pending') fail('NOT_FOUND')

      if (decision === 'reject') {
        const why = typeof reason === 'string' ? reason.trim().slice(0, 120) : ''
        await prisma.proposal.update({
          where: { id: proposal.id },
          data: { status: 'rejected', rejectReason: why || null, reviewedBy: adminName, reviewedAt: new Date() },
        })
        return {}
      }
      if (decision !== 'approve') fail('INVALID')

      const original = {
        type: proposal.type,
        text: proposal.text,
        choices: parseList(proposal.choices),
        answerIndex: proposal.answerIndex,
        acceptedAnswers: parseList(proposal.acceptedAnswers),
        labelIds: proposal.labels.map((l) => l.id),
      }
      const q = validateQuestion({ ...original, ...(edits && typeof edits === 'object' ? edits : {}), type: proposal.type })
      if (!q) fail('INVALID')
      if ((await prisma.label.count({ where: { id: { in: q.labelIds } } })) !== q.labelIds.length) fail('INVALID')

      await prisma.$transaction(async (tx) => {
        const question = await tx.question.create({
          data: { ...questionFields(q), labels: { connect: q.labelIds.map((id) => ({ id })) } },
        })
        await tx.proposal.update({
          where: { id: proposal.id },
          data: {
            ...questionFields(q),
            labels: { set: q.labelIds.map((id) => ({ id })) },
            status: 'approved',
            reviewedBy: adminName,
            reviewedAt: new Date(),
            questionId: question.id,
          },
        })
      })
      return {}
    })

    socket.on('disconnect', () => {
      leaveRoom(socket)
      for (const id of mySessions) soloSessions.delete(id)
    })
  })
}
