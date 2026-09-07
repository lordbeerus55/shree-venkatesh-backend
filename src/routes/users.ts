import { Prisma, User } from '@prisma/client'
import { Router, Request, Response } from 'express'
import bcrypt from 'bcrypt'
import prisma from '../lib/prisma'
import { isUniqueViolation, lockUser, serializable } from '../lib/transactions'
import { MAX_BALANCE, parseAmount, parseId, parsePage } from '../lib/validation'

const router = Router()

function toSafeUser({ mpinHash: _mpinHash, passwordHash: _passwordHash, ...user }: User) {
  return user
}

function customerFields(body: Record<string, unknown>): { name: string; mobile: string; mpin: string; username: string; password: string } | null {
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const mobile = typeof body.mobile === 'string' ? body.mobile.trim() : ''
  const mpin = typeof body.mpin === 'string' ? body.mpin : ''
  const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (!name || name.length > 100 || !/^\d{10}$/.test(mobile) || !/^\d{4}$/.test(mpin) ||
      !/^[a-z][a-z0-9._-]{2,49}$/.test(username) || password.length < 12 || password.length > 128) return null
  return { name, mobile, mpin, username, password }
}

router.get('/', async (req: Request, res: Response) => {
  const pagination = parsePage(req.query as Record<string, unknown>)
  if (!pagination) { res.status(400).json({ error: 'Invalid pagination' }); return }
  const { search } = req.query
  const where = search ? { OR: [
    { name: { contains: search as string, mode: 'insensitive' as const } },
    { mobile: { contains: search as string } },
    { username: { contains: search as string, mode: 'insensitive' as const } },
  ] } : {}
  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where, skip: pagination.skip, take: pagination.limit, orderBy: { createdAt: 'desc' },
      select: { id: true, mobile: true, name: true, username: true, walletBalance: true, fundsReserved: true, isActive: true, isBanned: true, createdAt: true },
    }),
    prisma.user.count({ where }),
  ])
  res.json({ users, total, page: pagination.page, limit: pagination.limit })
})

router.post('/', async (req: Request, res: Response) => {
  const fields = customerFields(req.body)
  if (!fields) {
    res.status(400).json({ error: 'name, 10-digit mobile, 4-digit mpin, valid username and password of at least 12 characters are required' })
    return
  }
  try {
    const [mpinHash, passwordHash] = await Promise.all([bcrypt.hash(fields.mpin, 12), bcrypt.hash(fields.password, 12)])
    const user = await prisma.user.create({ data: { mobile: fields.mobile, name: fields.name, username: fields.username, mpinHash, passwordHash } })
    res.status(201).json(toSafeUser(user))
  } catch (error) {
    if (isUniqueViolation(error)) { res.status(409).json({ error: 'Mobile or username already registered' }); return }
    throw error
  }
})

router.get('/:id', async (req: Request, res: Response) => {
  const id = parseId(req.params.id)
  if (!id) { res.status(400).json({ error: 'Invalid user id' }); return }
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true, mobile: true, name: true, username: true, walletBalance: true, fundsReserved: true,
      isActive: true, isBanned: true, createdAt: true, updatedAt: true,
      walletTransactions: { orderBy: { createdAt: 'desc' }, take: 20 },
      depositRequests: { orderBy: { createdAt: 'desc' }, take: 10 },
      withdrawRequests: { orderBy: { createdAt: 'desc' }, take: 10 },
    },
  })
  if (!user) { res.status(404).json({ error: 'User not found' }); return }
  res.json(user)
})

router.put('/:id', async (req: Request, res: Response) => {
  const id = parseId(req.params.id)
  const fields = customerFields(req.body)
  if (!id || !fields) {
    res.status(400).json({ error: 'name, 10-digit mobile, 4-digit mpin, valid username and password of at least 12 characters are required' })
    return
  }
  try {
    const [mpinHash, passwordHash] = await Promise.all([bcrypt.hash(fields.mpin, 12), bcrypt.hash(fields.password, 12)])
    const user = await prisma.user.update({
      where: { id },
      data: { name: fields.name, mobile: fields.mobile, username: fields.username, mpinHash, passwordHash, tokenVersion: { increment: 1 }, failedLoginCount: 0, lockedUntil: null },
    })
    res.json(toSafeUser(user))
  } catch (error) {
    if (isUniqueViolation(error)) { res.status(409).json({ error: 'Mobile or username already registered' }); return }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') { res.status(404).json({ error: 'User not found' }); return }
    throw error
  }
})

router.delete('/:id', async (req: Request, res: Response) => {
  const id = parseId(req.params.id)
  if (!id) { res.status(400).json({ error: 'Invalid user id' }); return }
  await prisma.user.delete({ where: { id } })
  res.json({ message: 'User deleted' })
})

router.patch('/:id/ban', async (req: Request, res: Response) => {
  const id = parseId(req.params.id)
  if (!id) { res.status(400).json({ error: 'Invalid user id' }); return }
  const user = await prisma.user.findUnique({ where: { id } })
  if (!user) { res.status(404).json({ error: 'Not found' }); return }
  const updated = await prisma.user.update({ where: { id }, data: { isBanned: !user.isBanned, tokenVersion: { increment: 1 } } })
  res.json(toSafeUser(updated))
})

router.post('/:id/add-points', async (req: Request, res: Response) => {
  const id = parseId(req.params.id)
  const amount = parseAmount(req.body.amount)
  const remark = typeof req.body.remark === 'string' ? req.body.remark.trim().slice(0, 250) : ''
  if (!id || !amount) { res.status(400).json({ error: 'Invalid user or amount' }); return }
  try {
    const updatedUser = await serializable(async (tx) => {
      const balance = await lockUser(tx, id)
      if (!balance) throw new Error('NOT_FOUND')
      const after = balance.walletBalance.plus(amount)
      if (after.plus(balance.fundsReserved).greaterThan(MAX_BALANCE)) throw new Error('BALANCE_LIMIT')
      const user = await tx.user.update({ where: { id }, data: { walletBalance: after } })
      await tx.walletTransaction.create({ data: { userId: id, type: 'credit', remark: remark || 'Deposit from Admin', beforeBalance: balance.walletBalance, amount, afterBalance: after, referenceType: 'admin_deposit' } })
      return user
    })
    res.json(toSafeUser(updatedUser))
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'NOT_FOUND') { res.status(404).json({ error: 'Not found' }); return }
    if (message === 'BALANCE_LIMIT') { res.status(409).json({ error: 'Customer balance limit exceeded' }); return }
    throw error
  }
})

router.post('/:id/withdraw-points', async (req: Request, res: Response) => {
  const id = parseId(req.params.id)
  const amount = parseAmount(req.body.amount)
  const remark = typeof req.body.remark === 'string' ? req.body.remark.trim().slice(0, 250) : ''
  if (!id || !amount) { res.status(400).json({ error: 'Invalid user or amount' }); return }
  try {
    const updatedUser = await serializable(async (tx) => {
      const balance = await lockUser(tx, id)
      if (!balance) throw new Error('NOT_FOUND')
      if (balance.walletBalance.lessThan(amount)) throw new Error('INSUFFICIENT_FUNDS')
      const after = balance.walletBalance.minus(amount)
      const user = await tx.user.update({ where: { id }, data: { walletBalance: after } })
      await tx.walletTransaction.create({ data: { userId: id, type: 'debit', remark: remark || 'Withdraw by Admin', beforeBalance: balance.walletBalance, amount, afterBalance: after, referenceType: 'admin_withdraw' } })
      return user
    })
    res.json(toSafeUser(updatedUser))
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'NOT_FOUND') { res.status(404).json({ error: 'Not found' }); return }
    if (message === 'INSUFFICIENT_FUNDS') { res.status(409).json({ error: 'Insufficient balance' }); return }
    throw error
  }
})

export default router
