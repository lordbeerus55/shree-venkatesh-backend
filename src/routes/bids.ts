import { Prisma } from '@prisma/client'
import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'
import { lockUser, serializable } from '../lib/transactions'
import { MAX_BALANCE, parseDate, parseId, parsePage } from '../lib/validation'

const router = Router()

router.get('/', async (req: Request, res: Response) => {
  const pagination = parsePage(req.query as Record<string, unknown>)
  const userId = req.query.userId === undefined ? null : parseId(req.query.userId)
  const marketId = req.query.marketId === undefined ? null : parseId(req.query.marketId)
  const date = req.query.date === undefined ? null : parseDate(req.query.date)
  if (!pagination || (req.query.userId !== undefined && !userId) || (req.query.marketId !== undefined && !marketId) || (req.query.date !== undefined && !date)) {
    res.status(400).json({ error: 'Invalid filters' }); return
  }
  const where: Prisma.BidWhereInput = { ...(userId ? { userId } : {}), ...(marketId ? { marketId } : {}), ...(date ? { bidDate: date } : {}), ...(req.query.status ? { status: String(req.query.status) } : {}) }
  const [bids, total] = await Promise.all([
    prisma.bid.findMany({ where, include: { user: { select: { id: true, name: true, mobile: true } }, market: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' }, skip: pagination.skip, take: pagination.limit }),
    prisma.bid.count({ where }),
  ])
  res.json({ bids, total })
})

router.post('/:id/revert', async (req: Request, res: Response) => {
  const id = parseId(req.params.id)
  if (!id) { res.status(400).json({ error: 'Invalid bid id' }); return }
  try {
    await serializable(async (tx) => {
      const bid = await tx.bid.findUnique({ where: { id } })
      if (!bid) throw new Error('NOT_FOUND')
      if (bid.status !== 'pending') throw new Error('NOT_PENDING')
      const claimed = await tx.bid.updateMany({ where: { id, status: 'pending' }, data: { status: 'reverted' } })
      if (claimed.count !== 1) throw new Error('NOT_PENDING')
      const balance = await lockUser(tx, bid.userId)
      if (!balance) throw new Error('CUSTOMER_NOT_FOUND')
      const after = balance.walletBalance.plus(bid.amount)
      if (after.plus(balance.fundsReserved).greaterThan(MAX_BALANCE)) throw new Error('BALANCE_LIMIT')
      await tx.user.update({ where: { id: bid.userId }, data: { walletBalance: after } })
      await tx.walletTransaction.create({
        data: { userId: bid.userId, type: 'credit', remark: `Bid Revert (${bid.number})`, beforeBalance: balance.walletBalance, amount: bid.amount, afterBalance: after, referenceType: 'bid_revert', referenceId: bid.id },
      })
    })
    res.json({ message: 'Bid reverted and amount refunded' })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'NOT_FOUND') { res.status(404).json({ error: 'Bid not found' }); return }
    if (message === 'NOT_PENDING') { res.status(409).json({ error: 'Only pending bids can be reverted' }); return }
    if (message === 'BALANCE_LIMIT') { res.status(409).json({ error: 'Customer balance limit exceeded' }); return }
    throw error
  }
})

export default router
