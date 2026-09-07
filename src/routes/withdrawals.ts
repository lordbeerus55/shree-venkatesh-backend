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
  const where: Prisma.WithdrawRequestWhereInput = {
    ...(req.query.status ? { status: String(req.query.status) } : {}),
    ...(startDate || endDate ? { createdAt: { ...(startDate ? { gte: startDate } : {}), ...(endDate ? { lte: endDate } : {}) } } : {}),
  }
  const [requests, total] = await Promise.all([
    prisma.withdrawRequest.findMany({ where, include: { user: { select: { id: true, name: true, mobile: true, walletBalance: true, fundsReserved: true } } }, orderBy: { createdAt: 'desc' }, skip: pagination.skip, take: pagination.limit }),
    prisma.withdrawRequest.count({ where }),
  ])
  res.json({ requests, total })
})

router.post('/:id/approve', async (req: Request, res: Response) => {
  const id = parseId(req.params.id)
  if (!id) { res.status(400).json({ error: 'Invalid request id' }); return }
  const remark = typeof req.body.remark === 'string' ? req.body.remark.trim().slice(0, 250) : null
  try {
    await serializable(async (tx) => {
      const withdrawal = await tx.withdrawRequest.findUnique({ where: { id } })
      if (!withdrawal) throw new Error('NOT_FOUND')
      const claimed = await tx.withdrawRequest.updateMany({ where: { id, status: 'pending' }, data: { status: 'approved', processedAt: new Date(), adminRemark: remark } })
      if (claimed.count !== 1) throw new Error('ALREADY_PROCESSED')
      const balance = await lockUser(tx, withdrawal.userId)
      if (!balance) throw new Error('CUSTOMER_NOT_FOUND')
      if (withdrawal.fundsReserved) {
        if (balance.fundsReserved.lessThan(withdrawal.amount)) throw new Error('RESERVATION_MISMATCH')
        await tx.user.update({ where: { id: withdrawal.userId }, data: { fundsReserved: balance.fundsReserved.minus(withdrawal.amount) } })
      } else {
        if (balance.walletBalance.lessThan(withdrawal.amount)) throw new Error('INSUFFICIENT_FUNDS')
        const after = balance.walletBalance.minus(withdrawal.amount)
        await tx.user.update({ where: { id: withdrawal.userId }, data: { walletBalance: after } })
        await tx.walletTransaction.create({
          data: { userId: withdrawal.userId, type: 'debit', remark: `Withdrawal Approved (#${withdrawal.id})`, beforeBalance: balance.walletBalance, amount: withdrawal.amount, afterBalance: after, referenceType: 'withdraw_request', referenceId: withdrawal.id },
        })
      }
    })
    res.json({ message: 'Withdrawal approved' })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'NOT_FOUND') { res.status(404).json({ error: 'Not found' }); return }
    if (message === 'ALREADY_PROCESSED') { res.status(409).json({ error: 'Already processed' }); return }
    if (message === 'INSUFFICIENT_FUNDS') { res.status(409).json({ error: 'Insufficient balance' }); return }
    throw error
  }
})

router.post('/:id/reject', async (req: Request, res: Response) => {
  const id = parseId(req.params.id)
  if (!id) { res.status(400).json({ error: 'Invalid request id' }); return }
  const remark = typeof req.body.remark === 'string' ? req.body.remark.trim().slice(0, 250) : null
  try {
    await serializable(async (tx) => {
      const withdrawal = await tx.withdrawRequest.findUnique({ where: { id } })
      if (!withdrawal) throw new Error('NOT_FOUND')
      const claimed = await tx.withdrawRequest.updateMany({ where: { id, status: 'pending' }, data: { status: 'rejected', processedAt: new Date(), adminRemark: remark } })
      if (claimed.count !== 1) throw new Error('ALREADY_PROCESSED')
      if (withdrawal.fundsReserved) {
        const balance = await lockUser(tx, withdrawal.userId)
        if (!balance || balance.fundsReserved.lessThan(withdrawal.amount)) throw new Error('RESERVATION_MISMATCH')
        const after = balance.walletBalance.plus(withdrawal.amount)
        const reservedAfter = balance.fundsReserved.minus(withdrawal.amount)
        if (after.plus(reservedAfter).greaterThan(MAX_BALANCE)) throw new Error('BALANCE_LIMIT')
        await tx.user.update({ where: { id: withdrawal.userId }, data: { walletBalance: after, fundsReserved: reservedAfter } })
        await tx.walletTransaction.create({
          data: { userId: withdrawal.userId, type: 'credit', remark: `Withdrawal Released (#${withdrawal.id})`, beforeBalance: balance.walletBalance, amount: withdrawal.amount, afterBalance: after, referenceType: 'withdrawal_release', referenceId: withdrawal.id },
        })
      }
    })
    res.json({ message: 'Withdrawal rejected' })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'NOT_FOUND') { res.status(404).json({ error: 'Not found' }); return }
    if (message === 'ALREADY_PROCESSED') { res.status(409).json({ error: 'Already processed' }); return }
    if (message === 'BALANCE_LIMIT') { res.status(409).json({ error: 'Customer balance limit exceeded' }); return }
    throw error
  }
})

export default router
