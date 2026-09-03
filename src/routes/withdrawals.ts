import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'

const router = Router()

router.get('/', async (req: Request, res: Response) => {
  const { status, page = '1', limit = '50', startDate, endDate } = req.query
  const skip = (parseInt(page as string) - 1) * parseInt(limit as string)

  const where: Record<string, unknown> = {}
  if (status) where.status = status
  if (startDate || endDate) {
    where.createdAt = {
      ...(startDate ? { gte: new Date(startDate as string) } : {}),
      ...(endDate ? { lte: new Date(endDate as string) } : {}),
    }
  }

  const [requests, total] = await Promise.all([
    prisma.withdrawRequest.findMany({
      where,
      include: { user: { select: { id: true, name: true, mobile: true, walletBalance: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take: parseInt(limit as string),
    }),
    prisma.withdrawRequest.count({ where }),
  ])

  res.json({ requests, total })
})

router.post('/:id/approve', async (req: Request, res: Response) => {
  const withdrawal = await prisma.withdrawRequest.findUnique({
    where: { id: parseInt(req.params.id) },
    include: { user: true },
  })
  if (!withdrawal) { res.status(404).json({ error: 'Not found' }); return }
  if (withdrawal.status !== 'pending') {
    res.status(400).json({ error: 'Already processed' }); return
  }

  const amt = Number(withdrawal.amount)
  const before = Number(withdrawal.user.walletBalance)
  if (before < amt) { res.status(400).json({ error: 'Insufficient balance' }); return }
  const after = before - amt

  await prisma.$transaction([
    prisma.withdrawRequest.update({
      where: { id: withdrawal.id },
      data: { status: 'approved', processedAt: new Date(), adminRemark: req.body.remark },
    }),
    prisma.user.update({ where: { id: withdrawal.userId }, data: { walletBalance: after } }),
    prisma.walletTransaction.create({
      data: {
        userId: withdrawal.userId,
        type: 'debit',
        remark: `Withdrawal Approved (#${withdrawal.id})`,
        beforeBalance: before,
        amount: amt,
        afterBalance: after,
        referenceType: 'withdraw_request',
        referenceId: withdrawal.id,
      },
    }),
  ])

  res.json({ message: 'Withdrawal approved' })
})

router.post('/:id/reject', async (req: Request, res: Response) => {
  const withdrawal = await prisma.withdrawRequest.findUnique({ where: { id: parseInt(req.params.id) } })
  if (!withdrawal) { res.status(404).json({ error: 'Not found' }); return }
  if (withdrawal.status !== 'pending') {
    res.status(400).json({ error: 'Already processed' }); return
  }

  await prisma.withdrawRequest.update({
    where: { id: withdrawal.id },
    data: { status: 'rejected', processedAt: new Date(), adminRemark: req.body.remark },
  })
  res.json({ message: 'Withdrawal rejected' })
})

export default router
