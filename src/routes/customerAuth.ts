import { Router, Request, Response } from 'express'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { User } from '@prisma/client'
import prisma from '../lib/prisma'
import { isUniqueViolation } from '../lib/transactions'
import { customerFields } from '../lib/validation'
import { getJwtSecret, JWT_ISSUER } from '../middleware/auth'
import { CUSTOMER_JWT_AUDIENCE } from '../middleware/customerAuth'

const router = Router()
const MAX_ATTEMPTS = 5
const LOCKOUT_MS = 15 * 60 * 1000
const REGISTER_MAX_PER_HOUR = 5
const registerHits = new Map<string, { count: number; resetAt: number }>()

function registerRateLimited(ip: string): boolean {
  const now = Date.now()
  const hit = registerHits.get(ip)
  if (!hit || hit.resetAt <= now) {
    registerHits.set(ip, { count: 1, resetAt: now + 60 * 60 * 1000 })
    return false
  }
  hit.count += 1
  return hit.count > REGISTER_MAX_PER_HOUR
}

function customerSession(customer: Pick<User, 'id' | 'tokenVersion' | 'name' | 'username' | 'mobile' | 'walletBalance'>) {
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
  return {
    token,
    customer: {
      id: customer.id,
      name: customer.name,
      username: customer.username,
      mobile: customer.mobile,
      walletBalance: customer.walletBalance,
    },
  }
}

router.post('/register', async (req: Request, res: Response) => {
  if (registerRateLimited(req.ip ?? 'unknown')) {
    res.status(429).json({ error: 'Too many registration attempts. Try again later.' })
    return
  }
  const fields = customerFields(req.body)
  if (!fields) {
    res.status(400).json({ error: 'name, 10-digit mobile, 4-digit mpin, valid username and password of at least 12 characters are required' })
    return
  }
  try {
    const [mpinHash, passwordHash] = await Promise.all([bcrypt.hash(fields.mpin, 12), bcrypt.hash(fields.password, 12)])
    const customer = await prisma.user.create({
      data: {
        mobile: fields.mobile,
        name: fields.name,
        username: fields.username,
        mpinHash,
        passwordHash,
        adminAlerts: {
          create: {
            type: 'customer_registered',
            title: 'New customer registered',
            body: `${fields.name} (${fields.mobile}, username: ${fields.username}) signed up.`,
          },
        },
      },
    })
    res.status(201).json(customerSession(customer))
  } catch (error) {
    if (isUniqueViolation(error)) { res.status(409).json({ error: 'Mobile or username already registered' }); return }
    throw error
  }
})

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

  res.json(customerSession(customer))
})

export default router
