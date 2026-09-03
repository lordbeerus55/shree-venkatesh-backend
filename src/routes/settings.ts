import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'

const router = Router()

router.get('/', async (_req: Request, res: Response) => {
  const rows = await prisma.setting.findMany()
  const settings: Record<string, string | null> = {}
  rows.forEach((r: { key: string; value: string | null }) => { settings[r.key] = r.value })
  res.json(settings)
})

router.put('/', async (req: Request, res: Response) => {
  const updates = req.body as Record<string, string>
  await Promise.all(
    Object.entries(updates).map(([key, value]) =>
      prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } })
    )
  )
  res.json({ message: 'Settings updated' })
})

export default router
