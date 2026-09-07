import { Router, Request, Response } from 'express'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import prisma from '../lib/prisma'
import { getJwtSecret, JWT_ISSUER } from '../middleware/auth'
import { CUSTOMER_JWT_AUDIENCE } from '../middleware/customerAuth'

const router = Router()
const MAX_ATTEMPTS = 5
const LOCKOUT_MS = 15 * 60 * 1000

router.post('/login', async (req: Request, res: Response) => {
  const identifier = typeof req.body.identifier === 'string' ? req.body.identifier.trim() : ''
  const credential = typeof req.body.credential === 'string' ? req.body.credential : ''
  if (!identifier || identifier.length > 100 || !credential || credential.length > 128) {
    res.status(400).json({ error: 'Identifier and credential are required' })
    return
  }

  const customer = await prisma.user.findUnique({ where: { username: identifier.toLowerCase() } })
    ?? await prisma.user.findUnique({ where: { mobile: identifier } })
  if (customer?.lockedUntil && customer.lockedUntil > new Date()) {
    res.status(429).json({ error: 'Too many failed attempts. Try again later.' })
    return
  }

  const passwordValid = customer?.passwordHash ? await bcrypt.compare(credential, customer.passwordHash) : false
  const mpinValid = customer ? await bcrypt.compare(credential, customer.mpinHash) : false
  if (!customer || (!passwordValid && !mpinValid)) {
    if (customer) {
      const resetExpiredLock = customer.lockedUntil && customer.lockedUntil <= new Date()
      const failed = await prisma.user.update({
        where: { id: customer.id },
        data: {
          failedLoginCount: resetExpiredLock ? 1 : { increment: 1 },
          lockedUntil: resetExpiredLock ? null : undefined,
        },
        select: { failedLoginCount: true },
      })
      if (failed.failedLoginCount >= MAX_ATTEMPTS) {
        await prisma.user.update({
          where: { id: customer.id },
          data: { lockedUntil: new Date(Date.now() + LOCKOUT_MS) },
        })
      }
    }
    res.status(401).json({ error: 'Invalid credentials' })
    return
  }
  if (!customer.isActive || customer.isBanned) {
    res.status(401).json({ error: 'Customer account is unavailable' })
    return
  }
  if (customer.failedLoginCount || customer.lockedUntil) {
    await prisma.user.update({
      where: { id: customer.id },
      data: { failedLoginCount: 0, lockedUntil: null },
    })
  }

  const token = jwt.sign(
    { kind: 'customer', tokenVersion: customer.tokenVersion },
    getJwtSecret(),
    {
      algorithm: 'HS256',
      subject: String(customer.id),
      issuer: JWT_ISSUER,
      audience: CUSTOMER_JWT_AUDIENCE,
      expiresIn: '7d',
    }
  )
  res.json({
    token,
    customer: {
      id: customer.id,
      name: customer.name,
      username: customer.username,
      mobile: customer.mobile,
      walletBalance: customer.walletBalance,
    },
  })
})

export default router
