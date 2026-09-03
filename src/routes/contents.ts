import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'

const router = Router()

router.get('/', async (_req: Request, res: Response) => {
  const rows = await prisma.content.findMany()
  const contents: Record<string, string | null> = {}
  rows.forEach((r: { key: string; body: string | null }) => { contents[r.key] = r.body })
  res.json(contents)
})

router.put('/:key', async (req: Request, res: Response) => {
  const { key } = req.params
  const { body } = req.body
  const content = await prisma.content.upsert({
    where: { key },
    update: { body },
    create: { key, body },
  })
  res.json(content)
})

export default router
