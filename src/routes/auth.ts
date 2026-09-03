import { Router, Request, Response } from 'express'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import prisma from '../lib/prisma'
import { requireAuth } from '../middleware/auth'

const router = Router()

// Add CORS headers to all auth routes
router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS')
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200)
  }
  next()
})

router.post('/login', async (req: Request, res: Response) => {
  const { username, password } = req.body
  if (!username || !password) {
    res.status(400).json({ error: 'Username and password required' })
    return
  }

  const admin = await prisma.admin.findUnique({ where: { username } })
  if (!admin) {
    res.status(401).json({ error: 'Invalid credentials' })
    return
  }

  const valid = await bcrypt.compare(password, admin.passwordHash)
  if (!valid) {
    res.status(401).json({ error: 'Invalid credentials' })
    return
  }

  const token = jwt.sign(
    { id: admin.id, username: admin.username },
    process.env.JWT_SECRET as string,
    { expiresIn: '7d' }
  )

  res.json({ token, admin: { id: admin.id, username: admin.username } })
})

router.get('/me', requireAuth, async (req: Request, res: Response) => {
  const admin = await prisma.admin.findUnique({
    where: { id: req.admin!.id },
    select: { id: true, username: true, walletBalance: true, createdAt: true },
  })
  res.json(admin)
})

router.post('/change-password', requireAuth, async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: 'Both fields required' })
    return
  }

  const admin = await prisma.admin.findUnique({ where: { id: req.admin!.id } })
  if (!admin) { res.status(404).json({ error: 'Not found' }); return }

  const valid = await bcrypt.compare(currentPassword, admin.passwordHash)
  if (!valid) { res.status(400).json({ error: 'Current password is incorrect' }); return }

  const passwordHash = await bcrypt.hash(newPassword, 10)
  await prisma.admin.update({ where: { id: admin.id }, data: { passwordHash } })
  res.json({ message: 'Password changed successfully' })
})

export default router
