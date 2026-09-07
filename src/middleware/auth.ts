import { AccessRole } from '@prisma/client'
import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import prisma from '../lib/prisma'

export const JWT_ISSUER = 'shree-venkatesh-backend'
export const JWT_AUDIENCE = 'shree-venkatesh-dashboard'

export interface AdminPayload {
  id: number
  username: string
  role: AccessRole
  tokenVersion: number
}

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error('JWT_SECRET must be at least 32 bytes')
  }
  return secret
}

declare global {
  namespace Express {
    interface Request {
      admin?: AdminPayload
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  try {
    const payload = jwt.verify(authHeader.slice(7), getJwtSecret(), {
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    })
    if (typeof payload === 'string' || !payload.sub) throw new Error('Invalid token payload')

    const account = await prisma.admin.findUnique({
      where: { id: Number(payload.sub) },
      select: { id: true, username: true, role: true, tokenVersion: true },
    })
    if (!account || payload.tokenVersion !== account.tokenVersion) {
      res.status(401).json({ error: 'Account is unavailable' })
      return
    }

    req.admin = account
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.admin?.role === AccessRole.ADMIN) {
    next()
    return
  }
  res.status(403).json({ error: 'Administrator access required' })
}

export function requireWriteAccess(req: Request, res: Response, next: NextFunction): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.admin?.role === AccessRole.ADMIN) {
    next()
    return
  }
  res.status(403).json({ error: 'This account has read-only access' })
}
