import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'

const router = Router()

router.get('/', async (req: Request, res: Response) => {
  const { search, page = '1', limit = '50' } = req.query
  const skip = (parseInt(page as string) - 1) * parseInt(limit as string)

  const where = search
    ? {
        OR: [
          { name: { contains: search as string, mode: 'insensitive' as const } },
          { mobile: { contains: search as string } },
        ],
      }
    : {}

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip,
      take: parseInt(limit as string),
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, mobile: true, name: true, walletBalance: true,
        isActive: true, isBanned: true, createdAt: true,
      },
    }),
    prisma.user.count({ where }),
  ])

  res.json({ users, total, page: parseInt(page as string), limit: parseInt(limit as string) })
})

router.post('/', async (req: Request, res: Response) => {
  const { mobile, name, mpin } = req.body
  if (!mobile || !name || !mpin) {
    res.status(400).json({ error: 'mobile, name and mpin are required' })
    return
  }

  const existing = await prisma.user.findUnique({ where: { mobile } })
  if (existing) { res.status(409).json({ error: 'Mobile already registered' }); return }

  const user = await prisma.user.create({ data: { mobile, name, mpin } })
  res.status(201).json(user)
})

router.get('/:id', async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: parseInt(req.params.id) },
    include: {
      walletTransactions: { orderBy: { createdAt: 'desc' }, take: 20 },
      depositRequests: { orderBy: { createdAt: 'desc' }, take: 10 },
      withdrawRequests: { orderBy: { createdAt: 'desc' }, take: 10 },
    },
  })
  if (!user) { res.status(404).json({ error: 'User not found' }); return }
  res.json(user)
})

router.put('/:id', async (req: Request, res: Response) => {
  const { name, mobile, mpin } = req.body
  const user = await prisma.user.update({
    where: { id: parseInt(req.params.id) },
    data: { name, mobile, mpin },
  })
  res.json(user)
})

router.delete('/:id', async (req: Request, res: Response) => {
  await prisma.user.delete({ where: { id: parseInt(req.params.id) } })
  res.json({ message: 'User deleted' })
})

router.patch('/:id/ban', async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: parseInt(req.params.id) } })
  if (!user) { res.status(404).json({ error: 'Not found' }); return }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { isBanned: !user.isBanned },
  })
  res.json(updated)
})

router.post('/:id/add-points', async (req: Request, res: Response) => {
  const { amount, remark } = req.body
  const amt = parseFloat(amount)
  if (!amt || amt <= 0) { res.status(400).json({ error: 'Invalid amount' }); return }

  const user = await prisma.user.findUnique({ where: { id: parseInt(req.params.id) } })
  if (!user) { res.status(404).json({ error: 'Not found' }); return }

  const beforeBalance = Number(user.walletBalance)
  const afterBalance = beforeBalance + amt

  const [updatedUser] = await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { walletBalance: afterBalance },
    }),
    prisma.walletTransaction.create({
      data: {
        userId: user.id,
        type: 'credit',
        remark: remark || 'Deposit from Admin',
        beforeBalance,
        amount: amt,
        afterBalance,
        referenceType: 'admin_deposit',
      },
    }),
  ])
  res.json(updatedUser)
})

router.post('/:id/withdraw-points', async (req: Request, res: Response) => {
  const { amount, remark } = req.body
  const amt = parseFloat(amount)
  if (!amt || amt <= 0) { res.status(400).json({ error: 'Invalid amount' }); return }

  const user = await prisma.user.findUnique({ where: { id: parseInt(req.params.id) } })
  if (!user) { res.status(404).json({ error: 'Not found' }); return }

  const beforeBalance = Number(user.walletBalance)
  if (beforeBalance < amt) {
    res.status(400).json({ error: 'Insufficient balance' })
    return
  }
  const afterBalance = beforeBalance - amt

  const [updatedUser] = await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { walletBalance: afterBalance },
    }),
    prisma.walletTransaction.create({
      data: {
        userId: user.id,
        type: 'debit',
        remark: remark || 'Withdraw by Admin',
        beforeBalance,
        amount: amt,
        afterBalance,
        referenceType: 'admin_withdraw',
      },
    }),
  ])
  res.json(updatedUser)
})

export default router
