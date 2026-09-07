import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'
import { parsePage } from '../lib/validation'

const router = Router()

router.get('/', async (req: Request, res: Response) => {
  const pagination = parsePage(req.query as Record<string, unknown>)
  if (!pagination) { res.status(400).json({ error: 'Invalid pagination' }); return }
  const admin = await prisma.admin.findUnique({ where: { id: req.admin!.id }, select: { alertsSeenAt: true } })
  const seenAt = admin?.alertsSeenAt ?? new Date(0)
  const [alerts, total, unreadCount] = await Promise.all([
    prisma.adminAlert.findMany({
      orderBy: { createdAt: 'desc' },
      skip: pagination.skip,
      take: pagination.limit,
      include: { user: { select: { id: true, name: true, mobile: true, username: true } } },
    }),
    prisma.adminAlert.count(),
    prisma.adminAlert.count({ where: { createdAt: { gt: seenAt } } }),
  ])
  res.json({ alerts, total, unreadCount, page: pagination.page, limit: pagination.limit })
})

router.post('/seen', async (req: Request, res: Response) => {
  await prisma.admin.update({ where: { id: req.admin!.id }, data: { alertsSeenAt: new Date() } })
  res.json({ message: 'Marked as seen' })
})

export default router
