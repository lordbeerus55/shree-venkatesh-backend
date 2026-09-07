import { Prisma } from '@prisma/client'
import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'

const router = Router()
const rateFields = ['single', 'jodi', 'singlePana', 'doublePana', 'triplePana', 'sp', 'dp', 'tp', 'fp', 'cp', 'halfSangam', 'fullSangam'] as const

router.get('/', async (_req: Request, res: Response) => {
  const rates = await prisma.gameRate.findFirst({ orderBy: { id: 'asc' } })
  res.json(rates)
})

router.put('/', async (req: Request, res: Response) => {
  const data: Record<string, number> = {}
  for (const field of rateFields) {
    const value = req.body[field]
    if (!Number.isSafeInteger(value) || value <= 0 || value > 1000000) {
      res.status(400).json({ error: `Invalid rate: ${field}` })
      return
    }
    data[field] = value
  }
  const existing = await prisma.gameRate.findFirst({ orderBy: { id: 'asc' } })
  const rates = existing
    ? await prisma.gameRate.update({ where: { id: existing.id }, data })
    : await prisma.gameRate.create({ data: data as Prisma.GameRateCreateInput })
  res.json(rates)
})

export default router
