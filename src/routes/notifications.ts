import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'

const router = Router()

router.get('/', async (_req: Request, res: Response) => {
  const notifications = await prisma.notification.findMany({ orderBy: { createdAt: 'desc' } })
  res.json(notifications)
})

router.post('/', async (req: Request, res: Response) => {
  const { title, body } = req.body
  if (!title || !body) { res.status(400).json({ error: 'title and body required' }); return }
  const notification = await prisma.notification.create({ data: { title, body } })
  res.status(201).json(notification)
})

router.put('/:id', async (req: Request, res: Response) => {
  const { title, body } = req.body
  const notification = await prisma.notification.update({
    where: { id: parseInt(req.params.id) },
    data: { title, body },
  })
  res.json(notification)
})

router.delete('/:id', async (req: Request, res: Response) => {
  await prisma.notification.delete({ where: { id: parseInt(req.params.id) } })
  res.json({ message: 'Deleted' })
})

export default router
