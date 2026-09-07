import { User } from '@prisma/client'
import { Router, Request, Response } from 'express'
import bcrypt from 'bcrypt'
import prisma from '../lib/prisma'

const router = Router()

function toSafeUser({ mpinHash: _mpinHash, ...user }: User) {
  return user
}

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
  const mobile = typeof req.body.mobile === 'string' ? req.body.mobile.trim() : ''
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : ''
  const mpin = typeof req.body.mpin === 'string' ? req.body.mpin : ''
  if (!/^\d{10}$/.test(mobile) || !name || !/^\d{4}$/.test(mpin)) {
    res.status(400).json({ error: 'A name, 10-digit mobile number and 4-digit MPIN are required' })
    return
  }

  const existing = await prisma.user.findUnique({ where: { mobile } })
  if (existing) { res.status(409).json({ error: 'Mobile already registered' }); return }

  const mpinHash = await bcrypt.hash(mpin, 12)
  const user = await prisma.user.create({ data: { mobile, name, mpinHash } })
  res.status(201).json({
    id: user.id,
    mobile: user.mobile,
    name: user.name,
    walletBalance: user.walletBalance,
    isActive: user.isActive,
    isBanned: user.isBanned,
    createdAt: user.createdAt,
  })
})

router.get('/:id', async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: parseInt(req.params.id) },
    select: {
      id: true,
      mobile: true,
      name: true,
      walletBalance: true,
      isActive: true,
      isBanned: true,
      createdAt: true,
      updatedAt: true,
      walletTransactions: { orderBy: { createdAt: 'desc' }, take: 20 },
      depositRequests: { orderBy: { createdAt: 'desc' }, take: 10 },
      withdrawRequests: { orderBy: { createdAt: 'desc' }, take: 10 },
    },
  })
  if (!user) { res.status(404).json({ error: 'User not found' }); return }
  res.json(user)
})

router.put('/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id)
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : undefined
  const mobile = typeof req.body.mobile === 'string' ? req.body.mobile.trim() : undefined
  const mpin = typeof req.body.mpin === 'string' && req.body.mpin ? req.body.mpin : undefined
  if (mobile && !/^\d{10}$/.test(mobile)) {
    res.status(400).json({ error: 'Mobile must contain 10 digits' })
    return
  }
  if (mpin && !/^\d{4}$/.test(mpin)) {
    res.status(400).json({ error: 'MPIN must contain 4 digits' })
    return
  }

  const mpinHash = mpin ? await bcrypt.hash(mpin, 12) : undefined
  const user = await prisma.user.update({
    where: { id },
    data: { name, mobile, mpinHash },
  })
  res.json({
    id: user.id,
    mobile: user.mobile,
    name: user.name,
    walletBalance: user.walletBalance,
    isActive: user.isActive,
    isBanned: user.isBanned,
    createdAt: user.createdAt,
  })
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
  res.json(toSafeUser(updated))
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
  res.json(toSafeUser(updatedUser))
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
  res.json(toSafeUser(updatedUser))
})

export default router
