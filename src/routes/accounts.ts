import { AccessRole } from '@prisma/client'
import { Router, Request, Response } from 'express'
import bcrypt from 'bcrypt'
import prisma from '../lib/prisma'

const router = Router()

router.get('/', async (_req: Request, res: Response) => {
  const accounts = await prisma.admin.findMany({
    select: { id: true, username: true, role: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  })
  res.json(accounts)
})

router.post('/', async (req: Request, res: Response) => {
  const username = typeof req.body.username === 'string' ? req.body.username.trim() : ''
  const password = typeof req.body.password === 'string' ? req.body.password : ''
  if (!/^[a-zA-Z0-9._-]{3,50}$/.test(username) || password.length < 12) {
    res.status(400).json({ error: 'Username must be 3-50 characters and password must be at least 12 characters' })
    return
  }

  const existing = await prisma.admin.findUnique({ where: { username } })
  if (existing) {
    res.status(409).json({ error: 'Username already exists' })
    return
  }

  const passwordHash = await bcrypt.hash(password, 12)
  const account = await prisma.admin.create({
    data: { username, passwordHash, role: AccessRole.VIEWER },
    select: { id: true, username: true, role: true, createdAt: true },
  })
  res.status(201).json(account)
})

router.put('/:id/password', async (req: Request, res: Response) => {
  const password = typeof req.body.password === 'string' ? req.body.password : ''
  if (password.length < 12) {
    res.status(400).json({ error: 'Password must be at least 12 characters' })
    return
  }

  const passwordHash = await bcrypt.hash(password, 12)
  await prisma.admin.update({
    where: { id: parseInt(req.params.id) },
    data: {
      passwordHash,
      tokenVersion: { increment: 1 },
      failedLoginCount: 0,
      lockedUntil: null,
    }
  })
  res.json({ message: 'Password reset successfully' })
})

router.delete('/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id)
  if (id === req.admin!.id) {
    res.status(400).json({ error: 'You cannot delete your own account' })
    return
  }

  const account = await prisma.admin.findUnique({ where: { id } })
  if (!account) {
    res.status(404).json({ error: 'Account not found' })
    return
  }
  if (account.role !== AccessRole.VIEWER) {
    res.status(400).json({ error: 'Administrator accounts cannot be deleted here' })
    return
  }

  await prisma.admin.delete({ where: { id } })
  res.json({ message: 'Viewer account deleted' })
})

export default router
