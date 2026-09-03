import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'
import { calculateWin, derivePanaDigit, deriveJodi } from '../lib/winCalc'

const router = Router()

router.get('/', async (req: Request, res: Response) => {
  const { date, marketId, page = '1', limit = '50' } = req.query
  const skip = (parseInt(page as string) - 1) * parseInt(limit as string)

  const where: Record<string, unknown> = {}
  if (date) where.resultDate = new Date(date as string)
  if (marketId) where.marketId = parseInt(marketId as string)

  const [results, total] = await Promise.all([
    prisma.result.findMany({
      where,
      include: { market: { select: { id: true, name: true } } },
      orderBy: { resultDate: 'desc' },
      skip,
      take: parseInt(limit as string),
    }),
    prisma.result.count({ where }),
  ])

  res.json({ results, total })
})

router.post('/', async (req: Request, res: Response) => {
  const { marketId, resultDate, openPana, closePana } = req.body
  if (!marketId || !resultDate) {
    res.status(400).json({ error: 'marketId and resultDate required' })
    return
  }

  const openDigit = openPana ? derivePanaDigit(openPana) : null
  const closeDigit = closePana ? derivePanaDigit(closePana) : null
  const jodi =
    openDigit && closeDigit ? deriveJodi(openDigit, closeDigit) : null

  const result = await prisma.result.upsert({
    where: { marketId_resultDate: { marketId: parseInt(marketId), resultDate: new Date(resultDate) } },
    update: { openPana, openDigit, closePana, closeDigit, jodi, declaredAt: new Date() },
    create: {
      marketId: parseInt(marketId),
      resultDate: new Date(resultDate),
      openPana, openDigit, closePana, closeDigit, jodi,
      declaredAt: new Date(),
    },
  })

  // Process winning bids
  const rates = await prisma.gameRate.findFirst()
  if (rates && openPana && closePana) {
    const pendingBids = await prisma.bid.findMany({
      where: {
        marketId: parseInt(marketId),
        bidDate: new Date(resultDate),
        status: 'pending',
      },
    })

    for (const bid of pendingBids) {
      const winAmount = calculateWin(bid, result, rates)
      const won = winAmount > 0

      await prisma.bid.update({
        where: { id: bid.id },
        data: { status: won ? 'won' : 'lost', winningAmount: winAmount, resultId: result.id },
      })

      if (won) {
        const user = await prisma.user.findUnique({ where: { id: bid.userId } })
        if (user) {
          const before = Number(user.walletBalance)
          const after = before + winAmount
          await prisma.$transaction([
            prisma.user.update({ where: { id: user.id }, data: { walletBalance: after } }),
            prisma.walletTransaction.create({
              data: {
                userId: user.id,
                type: 'credit',
                remark: `Win ( ${result.openPana ?? ''} - ${result.closePana ?? ''} )`,
                beforeBalance: before,
                amount: winAmount,
                afterBalance: after,
                referenceType: 'win',
                referenceId: bid.id,
              },
            }),
          ])
        }
      }
    }
  }

  res.status(201).json(result)
})

router.put('/:id', async (req: Request, res: Response) => {
  const { openPana, closePana } = req.body

  const openDigit = openPana ? derivePanaDigit(openPana) : undefined
  const closeDigit = closePana ? derivePanaDigit(closePana) : undefined
  const jodi = openDigit && closeDigit ? deriveJodi(openDigit, closeDigit) : undefined

  const result = await prisma.result.update({
    where: { id: parseInt(req.params.id) },
    data: { openPana, openDigit, closePana, closeDigit, jodi, declaredAt: new Date() },
  })
  res.json(result)
})

export default router
