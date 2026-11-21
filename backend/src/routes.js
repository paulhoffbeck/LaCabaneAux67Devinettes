import { Router } from 'express'

export function createRoutes(prisma) {
  const router = Router()

  // juste pour checker que le serveur et la bdd marchent
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
