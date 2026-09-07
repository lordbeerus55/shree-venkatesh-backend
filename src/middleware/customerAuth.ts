import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import prisma from '../lib/prisma'
import { getJwtSecret, JWT_ISSUER } from './auth'

export const CUSTOMER_JWT_AUDIENCE = 'shree-venkatesh-customer'

export interface CustomerPayload {
  id: number
  tokenVersion: number
  kind: 'customer'
}

declare global {
  namespace Express {
    interface Request {
      customer?: CustomerPayload
    }
  }
}

export async function requireCustomer(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  try {
    const payload = jwt.verify(authHeader.slice(7), getJwtSecret(), {
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
      audience: CUSTOMER_JWT_AUDIENCE,
    })
    if (typeof payload === 'string' || payload.kind !== 'customer' || !payload.sub) throw new Error('Invalid token')
    const id = Number(payload.sub)
    if (!Number.isSafeInteger(id)) throw new Error('Invalid token')
    const customer = await prisma.user.findUnique({
      where: { id },
      select: { id: true, tokenVersion: true, isActive: true, isBanned: true },
    })
    if (!customer || !customer.isActive || customer.isBanned || payload.tokenVersion !== customer.tokenVersion) {
      res.status(401).json({ error: 'Customer account is unavailable' })
      return
    }
    req.customer = { id: customer.id, tokenVersion: customer.tokenVersion, kind: 'customer' }
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}
