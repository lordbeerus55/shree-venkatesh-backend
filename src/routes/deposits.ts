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
    prisma.depositRequest.findMany({
      where,
      include: { user: { select: { id: true, name: true, mobile: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take: parseInt(limit as string),
    }),
    prisma.depositRequest.count({ where }),
  ])

  res.json({ requests, total })
})

router.post('/:id/approve', async (req: Request, res: Response) => {
  const deposit = await prisma.depositRequest.findUnique({
    where: { id: parseInt(req.params.id) },
    include: { user: true },
  })
  if (!deposit) { res.status(404).json({ error: 'Not found' }); return }
  if (deposit.status !== 'pending') {
    res.status(400).json({ error: 'Already processed' }); return
  }

  const amt = Number(deposit.amount)
  const before = Number(deposit.user.walletBalance)
  const after = before + amt

  await prisma.$transaction([
    prisma.depositRequest.update({
      where: { id: deposit.id },
      data: { status: 'approved', processedAt: new Date(), adminRemark: req.body.remark },
    }),
    prisma.user.update({ where: { id: deposit.userId }, data: { walletBalance: after } }),
    prisma.walletTransaction.create({
      data: {
        userId: deposit.userId,
        type: 'credit',
        remark: `Deposit Approved (#${deposit.id})`,
        beforeBalance: before,
        amount: amt,
        afterBalance: after,
        referenceType: 'deposit_request',
        referenceId: deposit.id,
      },
    }),
  ])

  res.json({ message: 'Deposit approved' })
})

router.post('/:id/reject', async (req: Request, res: Response) => {
  const deposit = await prisma.depositRequest.findUnique({ where: { id: parseInt(req.params.id) } })
  if (!deposit) { res.status(404).json({ error: 'Not found' }); return }
  if (deposit.status !== 'pending') {
    res.status(400).json({ error: 'Already processed' }); return
  }

  await prisma.depositRequest.update({
    where: { id: deposit.id },
    data: { status: 'rejected', processedAt: new Date(), adminRemark: req.body.remark },
  })
  res.json({ message: 'Deposit rejected' })
})

export default router
