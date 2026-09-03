import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'

export interface AdminPayload {
  id: number
  username: string
}

declare global {
  namespace Express {
    interface Request {
      admin?: AdminPayload
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const token = authHeader.slice(7)
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET as string) as AdminPayload
    req.admin = payload
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}
