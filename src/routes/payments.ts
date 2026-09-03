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
  const payments = await prisma.manualPayment.findMany({ orderBy: { id: 'asc' } })
  res.json(payments)
})

router.post('/', upload.single('qrImage'), async (req: Request, res: Response) => {
  const qrImageUrl = req.file ? `/uploads/${req.file.filename}` : null
  const payment = await prisma.manualPayment.create({
    data: { qrImageUrl, isActive: true },
  })
  res.status(201).json(payment)
})

router.put('/:id', async (req: Request, res: Response) => {
  const { paymentType, holderName, accountNumber, ifscCode, upiId, qrImageUrl, isActive } = req.body
  const payment = await prisma.manualPayment.update({
    where: { id: parseInt(req.params.id) },
    data: { paymentType, holderName, accountNumber, ifscCode, upiId, qrImageUrl, isActive },
  })
  res.json(payment)
})

router.delete('/:id', async (req: Request, res: Response) => {
  await prisma.manualPayment.delete({ where: { id: parseInt(req.params.id) } })
  res.json({ message: 'Deleted' })
})

export default router
