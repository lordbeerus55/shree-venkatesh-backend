import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'

const router = Router()

router.get('/', async (_req: Request, res: Response) => {
  const markets = await prisma.market.findMany({
    include: { schedules: true },
    orderBy: { id: 'asc' },
  })
  res.json(markets)
})

router.post('/', async (req: Request, res: Response) => {
  const { name, type = 'main', schedules } = req.body
  if (!name) { res.status(400).json({ error: 'name required' }); return }

  const market = await prisma.market.create({
    data: {
      name,
      type,
      schedules: schedules
        ? { create: schedules }
        : undefined,
    },
    include: { schedules: true },
  })
  res.status(201).json(market)
})

router.get('/:id', async (req: Request, res: Response) => {
  const market = await prisma.market.findUnique({
    where: { id: parseInt(req.params.id) },
    include: { schedules: true },
  })
  if (!market) { res.status(404).json({ error: 'Not found' }); return }
  res.json(market)
})

router.put('/:id', async (req: Request, res: Response) => {
  const { name, type, isActive } = req.body
  const market = await prisma.market.update({
    where: { id: parseInt(req.params.id) },
    data: { name, type, isActive },
    include: { schedules: true },
  })
  res.json(market)
})

router.delete('/:id', async (req: Request, res: Response) => {
  await prisma.market.delete({ where: { id: parseInt(req.params.id) } })
  res.json({ message: 'Market deleted' })
})

router.post('/:id/schedules', async (req: Request, res: Response) => {
  const { dayOfWeek, openTime, closeTime, isActive = true } = req.body
  if (!dayOfWeek || !openTime || !closeTime) {
    res.status(400).json({ error: 'dayOfWeek, openTime and closeTime are required' }); return
  }
  const schedule = await prisma.marketSchedule.create({
    data: { marketId: parseInt(req.params.id), dayOfWeek, openTime, closeTime, isActive },
  })
  res.status(201).json(schedule)
})

router.put('/:id/schedules/:scheduleId', async (req: Request, res: Response) => {
  const { openTime, closeTime, isActive } = req.body
  const schedule = await prisma.marketSchedule.update({
    where: { id: parseInt(req.params.scheduleId) },
    data: { openTime, closeTime, isActive },
  })
  res.json(schedule)
})

export default router
