import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { Server } from 'socket.io'
import { PrismaClient } from '@prisma/client'
import { createRoutes } from './routes.js'
import { registerSockets } from './sockets.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BACKEND_DIR = path.join(__dirname, '..')

const PORT = Number(process.env.PORT ?? 3000)
// si on passe par nginx, mettre HOST=127.0.0.1 dans le .env
const HOST = process.env.HOST ?? '0.0.0.0'
const IS_PROD = process.env.NODE_ENV === 'production'
const FRONT_DIST = path.resolve(BACKEND_DIR, process.env.FRONT_DIST ?? '../frontend/dist')
const QUESTIONS_FILE = path.resolve(BACKEND_DIR, process.env.QUESTIONS_FILE ?? 'prisma/questions.json')

const prisma = new PrismaClient()

// au premier lancement la base est vide, on la remplit avec questions.json
async function importQuestionsIfEmpty() {
  if ((await prisma.question.count()) > 0) return
  if (!fs.existsSync(QUESTIONS_FILE)) {
    console.warn(`Base vide et ${QUESTIONS_FILE} introuvable : aucune question importée.`)
    return
  }
  const data = JSON.parse(fs.readFileSync(QUESTIONS_FILE, 'utf8'))
  for (const l of data.labels ?? []) {
    await prisma.label.upsert({
      where: { slug: l.slug },
      update: { name: l.name, isTheme: l.isTheme ?? true },
      create: { slug: l.slug, name: l.name, isTheme: l.isTheme ?? true },
    })
  }
  let count = 0
  for (const q of data.questions ?? []) {
    await prisma.question.create({
      data: {
        type: q.type,
        text: q.text,
        choices: q.type === 'choice' ? JSON.stringify(q.choices) : null,
        answerIndex: q.type === 'choice' ? q.answerIndex : null,
        acceptedAnswers: q.type === 'text' ? JSON.stringify(q.acceptedAnswers) : null,
        labels: { connect: (q.labels ?? []).map((slug) => ({ slug })) },
      },
    })
    count++
  }
  console.log(`${count} questions importées depuis ${QUESTIONS_FILE}`)
}

const app = express()
const server = http.createServer(app)
const io = new Server(server, {
  // en dev le front tourne sur Vite (autre port) donc faut autoriser le cors
  cors: IS_PROD ? undefined : { origin: true },
})

app.disable('x-powered-by')
app.use(express.json())
app.use('/api', createRoutes(prisma))

if (fs.existsSync(FRONT_DIST)) {
  app.use(express.static(FRONT_DIST))
} else {
  console.warn(`${FRONT_DIST} introuvable : lance "npm run build" dans frontend/ pour servir le site.`)
}

registerSockets(io, prisma)

await importQuestionsIfEmpty()
server.listen(PORT, HOST, () => {
  console.log(`Quiz Clash en écoute sur http://${HOST}:${PORT}`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    io.close()
    await prisma.$disconnect()
    process.exit(0)
  })
}
