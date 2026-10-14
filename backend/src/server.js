// backend/src/server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

// Import Prisma sécurisé : ne fait JAMAIS planter Node si Prisma n'est pas généré
let prisma = null;
try {
  const { PrismaClient } = require('@prisma/client');
  prisma = new PrismaClient();
  console.log('[Prisma] Client chargé');
} catch (e) {
  console.warn('[Prisma] BDD non disponible, exécution en mode mémoire');
}

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const soloSessions = new Map();

io.on('connection', (socket) => {
  console.log('[Backend] Joueur connecté :', socket.id);

  // 1. Thèmes
  socket.on('themes:list', async (payload, callback) => {
    let themes = [];
    if (prisma) {
      try {
        const dbThemes = await prisma.theme.findMany({
          include: { _count: { select: { questions: true } } }
        });
        themes = dbThemes.map(t => ({
          id: String(t.id),
          name: t.name,
          questionCount: t._count.questions
        }));
      } catch (e) { console.error(e.message); }
    }

    if (!themes.length) {
      themes = [
        { id: '1', name: 'Culture Générale', questionCount: 10 },
        { id: '2', name: 'Histoire & Géographie', questionCount: 10 }
      ];
    }
    callback?.({ ok: true, themes });
  });

  // 2. Solo Start
  socket.on('solo:start', async ({ mode, themeId, nickname }, callback) => {
    let questions = [];
    if (prisma) {
      try {
        questions = await prisma.question.findMany({ take: 10 });
      } catch (e) { console.error(e.message); }
    }

    if (!questions.length) {
      questions = [
        { id: 1, text: 'Quelle est la capitale de la France ?', choices: JSON.stringify(['Paris', 'Lyon', 'Marseille', 'Bordeaux']), answerIndex: 0 },
        { id: 2, text: 'Combien font 7 x 8 ?', choices: JSON.stringify(['54', '56', '62', '64']), answerIndex: 1 }
      ];
    }

    const sessionId = 'session_' + Date.now();
    soloSessions.set(sessionId, { nickname, questions, currentIndex: 0, score: 0 });
    callback?.({ ok: true, sessionId });
  });

  // 3. Solo Next
  socket.on('solo:next', async ({ sessionId }, callback) => {
    const session = soloSessions.get(sessionId);
    if (!session) return callback?.({ ok: false, error: 'SESSION_NOT_FOUND' });

    const q = session.questions[session.currentIndex];
    if (!q) {
      return callback?.({ ok: true, done: true, score: session.score, total: session.questions.length });
    }

    let choices = [];
    try { choices = typeof q.choices === 'string' ? JSON.parse(q.choices) : q.choices; }
    catch (e) { choices = ['Option A', 'Option B', 'Option C', 'Option D']; }

    callback?.({
      ok: true,
      question: {
        id: q.id,
        text: q.text,
        choices,
        type: 'qcm',
        durationMs: 15000,
        totalQuestions: session.questions.length,
        currentIndex: session.currentIndex + 1
      }
    });
  });

  // 4. Solo Answer
  socket.on('solo:answer', async ({ sessionId, questionId, answer }, callback) => {
    const session = soloSessions.get(sessionId);
    if (!session) return callback?.({ ok: false, error: 'SESSION_NOT_FOUND' });

    const q = session.questions[session.currentIndex];
    const isCorrect = String(q.answerIndex) === String(answer);

    if (isCorrect) session.score += 10;
    session.currentIndex += 1;

    callback?.({ ok: true, correct: isCorrect, correctAnswer: q.answerIndex, currentScore: session.score });
  });

  socket.on('daily:status', (d, cb) => cb?.({ ok: true, status: { played: false, score: 0 } }));
  socket.on('daily:leaderboard', (d, cb) => cb?.({ ok: true, entries: [] }));
  socket.on('disconnect', () => console.log('[Backend] Déconnexion :', socket.id));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Serveur Backend prêt sur le port ${PORT}`);
});
