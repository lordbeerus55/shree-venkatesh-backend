import { Prisma } from '@prisma/client'
import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'
import { parseId, parsePage } from '../lib/validation'

const router = Router()

router.get('/', async (req: Request, res: Response) => {
  const pagination = parsePage(req.query as Record<string, unknown>)
  const userId = req.query.userId === undefined ? null : parseId(req.query.userId)
  if (!pagination || (req.query.userId !== undefined && !userId) ||
      (req.query.type !== undefined && !['credit', 'debit'].includes(String(req.query.type)))) {
    res.status(400).json({ error: 'Invalid filters' })
    return
  }

  const where: Prisma.WalletTransactionWhereInput = {
    ...(userId ? { userId } : {}),
    ...(req.query.type ? { type: String(req.query.type) } : {}),
  }
  const [transactions, total] = await Promise.all([
    prisma.walletTransaction.findMany({
      where,
      include: { user: { select: { id: true, name: true, mobile: true } } },
      orderBy: { createdAt: 'desc' },
      skip: pagination.skip,
      take: pagination.limit,
    }),
    prisma.walletTransaction.count({ where }),
  ])

  res.json({ transactions, total, page: pagination.page, limit: pagination.limit })
})

router.get('/user/:userId', async (req: Request, res: Response) => {
  const userId = parseId(req.params.userId)
  if (!userId) {
    res.status(400).json({ error: 'Invalid user id' })
    return
  }
  const transactions = await prisma.walletTransaction.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  })
  res.json(transactions)
})

export default router
