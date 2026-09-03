import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'

const router = Router()

router.get('/', async (req: Request, res: Response) => {
  const { userId, type, page = '1', limit = '50' } = req.query
  const skip = (parseInt(page as string) - 1) * parseInt(limit as string)

  const where: Record<string, unknown> = {}
  if (userId) where.userId = parseInt(userId as string)
  if (type) where.type = type

  const [transactions, total] = await Promise.all([
    prisma.walletTransaction.findMany({
      where,
      include: { user: { select: { id: true, name: true, mobile: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take: parseInt(limit as string),
    }),
    prisma.walletTransaction.count({ where }),
  ])

  res.json({ transactions, total })
})

router.get('/user/:userId', async (req: Request, res: Response) => {
  const transactions = await prisma.walletTransaction.findMany({
    where: { userId: parseInt(req.params.userId) },
    orderBy: { createdAt: 'desc' },
  })
  res.json(transactions)
})

export default router
