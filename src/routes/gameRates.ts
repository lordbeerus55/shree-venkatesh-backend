import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'

const router = Router()

router.get('/', async (_req: Request, res: Response) => {
  const rates = await prisma.gameRate.findFirst()
  res.json(rates)
})

router.put('/', async (req: Request, res: Response) => {
  const {
    single, jodi, singlePana, doublePana, triplePana,
    sp, dp, tp, fp, cp, halfSangam, fullSangam,
  } = req.body

  const existing = await prisma.gameRate.findFirst()
  let rates
  if (existing) {
    rates = await prisma.gameRate.update({
      where: { id: existing.id },
      data: { single, jodi, singlePana, doublePana, triplePana, sp, dp, tp, fp, cp, halfSangam, fullSangam },
    })
  } else {
    rates = await prisma.gameRate.create({
      data: { single, jodi, singlePana, doublePana, triplePana, sp, dp, tp, fp, cp, halfSangam, fullSangam },
    })
  }
  res.json(rates)
})

export default router
