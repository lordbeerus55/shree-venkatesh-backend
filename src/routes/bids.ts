import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'

const router = Router()

router.get('/', async (req: Request, res: Response) => {
  const { userId, marketId, date, status, page = '1', limit = '50' } = req.query
  const skip = (parseInt(page as string) - 1) * parseInt(limit as string)

  const where: Record<string, unknown> = {}
  if (userId) where.userId = parseInt(userId as string)
  if (marketId) where.marketId = parseInt(marketId as string)
  if (date) where.bidDate = new Date(date as string)
  if (status) where.status = status

  const [bids, total] = await Promise.all([
    prisma.bid.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, mobile: true } },
        market: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: parseInt(limit as string),
    }),
    prisma.bid.count({ where }),
  ])

  res.json({ bids, total })
})

router.post('/:id/revert', async (req: Request, res: Response) => {
  const bid = await prisma.bid.findUnique({
    where: { id: parseInt(req.params.id) },
    include: { user: true },
  })
  if (!bid) { res.status(404).json({ error: 'Bid not found' }); return }
  if (bid.status === 'reverted') {
    res.status(400).json({ error: 'Bid already reverted' }); return
  }

  const user = bid.user
  const before = Number(user.walletBalance)
  const refund = Number(bid.amount)
  const after = before + refund

  await prisma.$transaction([
    prisma.bid.update({ where: { id: bid.id }, data: { status: 'reverted' } }),
    prisma.user.update({ where: { id: user.id }, data: { walletBalance: after } }),
    prisma.walletTransaction.create({
      data: {
        userId: user.id,
        type: 'credit',
        remark: `Bid Revert ( ${bid.number} )`,
        beforeBalance: before,
        amount: refund,
        afterBalance: after,
        referenceType: 'bid',
        referenceId: bid.id,
      },
    }),
  ])

  res.json({ message: 'Bid reverted and amount refunded' })
})

export default router
