import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'

const router = Router()

router.get('/', async (_req: Request, res: Response) => {
  const timings = await prisma.timing.findMany()
  res.json(timings)
})

router.put('/:type', async (req: Request, res: Response) => {
  const { type } = req.params
  const { openTime, closeTime } = req.body
  const timing = await prisma.timing.upsert({
    where: { type },
    update: { openTime, closeTime },
    create: { type, openTime, closeTime },
  })
  res.json(timing)
})

export default router
