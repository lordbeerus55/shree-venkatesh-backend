import { Router, Request, Response } from 'express'
import multer from 'multer'
import path from 'path'
import prisma from '../lib/prisma'

const router = Router()

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, process.env.UPLOAD_DIR || 'uploads'),
  filename: (_req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9)
    cb(null, unique + path.extname(file.originalname))
  },
})
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } })

router.get('/', async (_req: Request, res: Response) => {
  const images = await prisma.sliderImage.findMany({ orderBy: { sortOrder: 'asc' } })
  res.json(images)
})

router.post('/', upload.single('image'), async (req: Request, res: Response) => {
  if (!req.file) { res.status(400).json({ error: 'Image file required' }); return }
  const imageUrl = `/uploads/${req.file.filename}`
  const { redirectUrl, sortOrder } = req.body

  const image = await prisma.sliderImage.create({
    data: { imageUrl, redirectUrl: redirectUrl || null, sortOrder: parseInt(sortOrder) || 0 },
  })
  res.status(201).json(image)
})

router.delete('/:id', async (req: Request, res: Response) => {
  await prisma.sliderImage.delete({ where: { id: parseInt(req.params.id) } })
  res.json({ message: 'Deleted' })
})

export default router
