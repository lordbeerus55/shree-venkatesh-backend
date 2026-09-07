import { Router, Request, Response } from 'express'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import prisma from '../lib/prisma'
import { getJwtSecret, JWT_AUDIENCE, JWT_ISSUER, requireAuth } from '../middleware/auth'

const router = Router()
const failedLogins = new Map<string, { count: number; blockedUntil: number }>()
const MAX_ATTEMPTS = 5
const LOCKOUT_MS = 15 * 60 * 1000

router.post('/login', async (req: Request, res: Response) => {
  const username = typeof req.body.username === 'string' ? req.body.username.trim() : ''
  const password = typeof req.body.password === 'string' ? req.body.password : ''
  if (!username || !password) {
    res.status(400).json({ error: 'Username and password required' })
    return
  }

  const attemptKey = `${req.ip}:${username.toLowerCase()}`
  const attempt = failedLogins.get(attemptKey)
  if (attempt?.blockedUntil && attempt.blockedUntil > Date.now()) {
    res.status(429).json({ error: 'Too many failed attempts. Try again later.' })
    return
  }

  try {
    const account = await prisma.admin.findUnique({ where: { username } })
    if (account?.lockedUntil && account.lockedUntil > new Date()) {
      res.status(429).json({ error: 'Too many failed attempts. Try again later.' })
      return
    }

    const valid = account ? await bcrypt.compare(password, account.passwordHash) : false
    if (!account || !valid) {
      if (account) {
        if (account.lockedUntil) {
          await prisma.admin.update({
            where: { id: account.id },
            data: { failedLoginCount: 0, lockedUntil: null },
          })
        }
        const failed = await prisma.admin.update({
          where: { id: account.id },
          data: { failedLoginCount: { increment: 1 } },
          select: { failedLoginCount: true },
        })
        if (failed.failedLoginCount >= MAX_ATTEMPTS) {
          await prisma.admin.update({
            where: { id: account.id },
            data: { lockedUntil: new Date(Date.now() + LOCKOUT_MS) },
          })
        }
      } else {
        const count = (attempt?.blockedUntil && attempt.blockedUntil <= Date.now() ? 0 : attempt?.count || 0) + 1
        failedLogins.set(attemptKey, {
          count,
          blockedUntil: count >= MAX_ATTEMPTS ? Date.now() + LOCKOUT_MS : 0,
        })
      }
      res.status(401).json({ error: 'Invalid credentials' })
      return
    }

    failedLogins.delete(attemptKey)
    if (account.failedLoginCount || account.lockedUntil) {
      await prisma.admin.update({
        where: { id: account.id },
        data: { failedLoginCount: 0, lockedUntil: null },
      })
    }
    const token = jwt.sign(
      { username: account.username, role: account.role, tokenVersion: account.tokenVersion },
      getJwtSecret(),
      {
        algorithm: 'HS256',
        subject: String(account.id),
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        expiresIn: '7d',
      }
    )
    const authenticatedAccount = {
      id: account.id,
      username: account.username,
      role: account.role,
    }

    res.json({ token, admin: authenticatedAccount })
  } catch (error) {
    console.error('Login failed:', error)
    res.status(500).json({ error: 'Login failed' })
  }
})

router.get('/me', requireAuth, async (req: Request, res: Response) => {
  const account = await prisma.admin.findUnique({
    where: { id: req.admin!.id },
    select: {
      id: true,
      username: true,
      role: true,
      walletBalance: true,
      createdAt: true,
    },
  })
  if (!account) {
    res.status(404).json({ error: 'Account not found' })
    return
  }
  res.json(account)
})

router.post('/change-password', requireAuth, async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body
  if (!currentPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
    res.status(400).json({ error: 'Current password and a new password of at least 8 characters are required' })
    return
  }

  const account = await prisma.admin.findUnique({ where: { id: req.admin!.id } })
  if (!account) { res.status(404).json({ error: 'Not found' }); return }

  const valid = await bcrypt.compare(currentPassword, account.passwordHash)
  if (!valid) { res.status(400).json({ error: 'Current password is incorrect' }); return }

  const passwordHash = await bcrypt.hash(newPassword, 12)
  await prisma.admin.update({
    where: { id: account.id },
    data: {
      passwordHash,
      tokenVersion: { increment: 1 },
      failedLoginCount: 0,
      lockedUntil: null,
    }
  })
  res.json({ message: 'Password changed successfully' })
})

export default router
