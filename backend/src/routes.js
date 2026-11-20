// API HTTP classique. Le jeu passe entièrement par socket.io (sockets.js) :
// ici, seulement de quoi vérifier que le serveur et la base répondent.
import { Router } from 'express'

export function createRoutes(prisma) {
  const router = Router()

  // GET /api/health → { ok: true, questions: 84 }
  router.get('/health', async (req, res) => {
    try {
      const questions = await prisma.question.count()
      res.json({ ok: true, questions })
    } catch (e) {
      res.status(500).json({ ok: false, error: 'DATABASE' })
    }
  })

  return router
}
