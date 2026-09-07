import { Prisma } from '@prisma/client'
import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'
import { lockUser, serializable } from '../lib/transactions'
import { MAX_BALANCE, parseDate, parseId, parsePage } from '../lib/validation'

const router = Router()

router.get('/', async (req: Request, res: Response) => {
  const pagination = parsePage(req.query as Record<string, unknown>)
  const startDate = req.query.startDate === undefined ? null : parseDate(req.query.startDate)
  const endDate = req.query.endDate === undefined ? null : parseDate(req.query.endDate)
  if (!pagination || (req.query.startDate !== undefined && !startDate) || (req.query.endDate !== undefined && !endDate)) {
    res.status(400).json({ error: 'Invalid filters' }); return
  }
  const where: Prisma.DepositRequestWhereInput = {
    ...(req.query.status ? { status: String(req.query.status) } : {}),
    ...(startDate || endDate ? { createdAt: { ...(startDate ? { gte: startDate } : {}), ...(endDate ? { lte: endDate } : {}) } } : {}),
  }
  const [requests, total] = await Promise.all([
    prisma.depositRequest.findMany({ where, include: { user: { select: { id: true, name: true, mobile: true } } }, orderBy: { createdAt: 'desc' }, skip: pagination.skip, take: pagination.limit }),
    prisma.depositRequest.count({ where }),
  ])
  res.json({ requests, total })
})

router.post('/:id/approve', async (req: Request, res: Response) => {
  const id = parseId(req.params.id)
  if (!id) { res.status(400).json({ error: 'Invalid request id' }); return }
  const remark = typeof req.body.remark === 'string' ? req.body.remark.trim().slice(0, 250) : null
  try {
    await serializable(async (tx) => {
      const deposit = await tx.depositRequest.findUnique({ where: { id } })
      if (!deposit) throw new Error('NOT_FOUND')
      const claimed = await tx.depositRequest.updateMany({ where: { id, status: 'pending' }, data: { status: 'approved', processedAt: new Date(), adminRemark: remark } })
      if (claimed.count !== 1) throw new Error('ALREADY_PROCESSED')
      const balance = await lockUser(tx, deposit.userId)
      if (!balance) throw new Error('CUSTOMER_NOT_FOUND')
      const after = balance.walletBalance.plus(deposit.amount)
      if (after.plus(balance.fundsReserved).greaterThan(MAX_BALANCE)) throw new Error('BALANCE_LIMIT')
      await tx.user.update({ where: { id: deposit.userId }, data: { walletBalance: after } })
      await tx.walletTransaction.create({
        data: { userId: deposit.userId, type: 'credit', remark: `Deposit Approved (#${deposit.id})`, beforeBalance: balance.walletBalance, amount: deposit.amount, afterBalance: after, referenceType: 'deposit_request', referenceId: deposit.id },
      })
    })
    res.json({ message: 'Deposit approved' })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'NOT_FOUND') { res.status(404).json({ error: 'Not found' }); return }
    if (message === 'ALREADY_PROCESSED') { res.status(409).json({ error: 'Already processed' }); return }
    if (message === 'BALANCE_LIMIT') { res.status(409).json({ error: 'Customer balance limit exceeded' }); return }
    throw error
  }
})

router.post('/:id/reject', async (req: Request, res: Response) => {
  const id = parseId(req.params.id)
  if (!id) { res.status(400).json({ error: 'Invalid request id' }); return }
  const updated = await prisma.depositRequest.updateMany({
    where: { id, status: 'pending' },
    data: { status: 'rejected', processedAt: new Date(), adminRemark: typeof req.body.remark === 'string' ? req.body.remark.trim().slice(0, 250) : null },
  })
  if (updated.count === 0) {
    const exists = await prisma.depositRequest.findUnique({ where: { id }, select: { id: true } })
    res.status(exists ? 409 : 404).json({ error: exists ? 'Already processed' : 'Not found' }); return
  }
  res.json({ message: 'Deposit rejected' })
})

export default router
