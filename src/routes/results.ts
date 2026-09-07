import { Prisma, Result } from '@prisma/client'
import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'
import { lockUser, serializable } from '../lib/transactions'
import { MAX_BALANCE, parseDate, parseId, parsePage, isPana } from '../lib/validation'
import { calculateWin, derivePanaDigit, deriveJodi } from '../lib/winCalc'

const router = Router()
const COMBINED_GAMES = ['jodi', 'half_sangam', 'full_sangam']

type Declaration = {
  marketId: number
  resultDate: Date
  openPana?: string
  closePana?: string
}

async function declareResult(declaration: Declaration): Promise<{ result: Result; created: boolean }> {
  return serializable(async (tx) => {
    const existing = await tx.result.findUnique({
      where: { marketId_resultDate: { marketId: declaration.marketId, resultDate: declaration.resultDate } },
    })
    const changesPublishedValue = Boolean(
      (declaration.openPana && existing?.openPana && declaration.openPana !== existing.openPana) ||
      (declaration.closePana && existing?.closePana && declaration.closePana !== existing.closePana)
    )
    if (changesPublishedValue) {
      const settled = await tx.bid.count({
        where: { marketId: declaration.marketId, bidDate: declaration.resultDate, status: { in: ['won', 'lost'] } },
      })
      if (settled > 0) throw new Error('RESULT_ALREADY_SETTLED')
    }

    const openPana = declaration.openPana ?? existing?.openPana ?? null
    const closePana = declaration.closePana ?? existing?.closePana ?? null
    const openDigit = openPana ? derivePanaDigit(openPana) : null
    const closeDigit = closePana ? derivePanaDigit(closePana) : null
    const jodi = openDigit && closeDigit ? deriveJodi(openDigit, closeDigit) : null
    const result = existing
      ? await tx.result.update({
          where: { id: existing.id },
          data: { openPana, openDigit, closePana, closeDigit, jodi, declaredAt: existing.declaredAt ?? new Date() },
        })
      : await tx.result.create({
          data: {
            marketId: declaration.marketId,
            resultDate: declaration.resultDate,
            openPana,
            openDigit,
            closePana,
            closeDigit,
            jodi,
            declaredAt: new Date(),
          },
        })

    const stageFilter: Prisma.BidWhereInput = openPana && closePana
      ? {}
      : openPana
        ? { OR: [{ session: 'open', gameType: { notIn: COMBINED_GAMES } }] }
        : { OR: [{ session: 'close', gameType: { notIn: COMBINED_GAMES } }] }
    const pendingBids = await tx.bid.findMany({
      where: {
        marketId: declaration.marketId,
        bidDate: declaration.resultDate,
        status: 'pending',
        ...stageFilter,
      },
      orderBy: { id: 'asc' },
    })
    for (const bid of pendingBids) {
      const winningAmount = calculateWin(bid, result)
      const won = winningAmount.greaterThan(0)
      const claimed = await tx.bid.updateMany({
        where: { id: bid.id, status: 'pending' },
        data: { status: won ? 'won' : 'lost', winningAmount, resultId: result.id },
      })
      if (claimed.count !== 1) throw new Error('BID_SETTLEMENT_CONFLICT')
      if (won) {
        const balance = await lockUser(tx, bid.userId)
        if (!balance) throw new Error('CUSTOMER_NOT_FOUND')
        const after = balance.walletBalance.plus(winningAmount)
        if (after.plus(balance.fundsReserved).greaterThan(MAX_BALANCE)) throw new Error('BALANCE_LIMIT')
        await tx.user.update({ where: { id: bid.userId }, data: { walletBalance: after } })
        await tx.walletTransaction.create({
          data: {
            userId: bid.userId,
            type: 'credit',
            remark: `Win (${result.openPana ?? '---'} - ${result.closePana ?? '---'})`,
            beforeBalance: balance.walletBalance,
            amount: winningAmount,
            afterBalance: after,
            referenceType: 'win',
            referenceId: bid.id,
          },
        })
      }
    }
    return { result, created: !existing }
  })
}

router.get('/', async (req: Request, res: Response) => {
  const pagination = parsePage(req.query as Record<string, unknown>)
  const date = req.query.date === undefined ? null : parseDate(req.query.date)
  const marketId = req.query.marketId === undefined ? null : parseId(req.query.marketId)
  if (!pagination || (req.query.date !== undefined && !date) || (req.query.marketId !== undefined && !marketId)) {
    res.status(400).json({ error: 'Invalid filters' }); return
  }
  const where: Prisma.ResultWhereInput = { ...(date ? { resultDate: date } : {}), ...(marketId ? { marketId } : {}) }
  const [results, total] = await Promise.all([
    prisma.result.findMany({ where, include: { market: { select: { id: true, name: true } } }, orderBy: { resultDate: 'desc' }, skip: pagination.skip, take: pagination.limit }),
    prisma.result.count({ where }),
  ])
  res.json({ results, total })
})

router.post('/', async (req: Request, res: Response) => {
  const marketId = parseId(req.body.marketId)
  const resultDate = parseDate(req.body.resultDate)
  const openPana = req.body.openPana === undefined ? undefined : typeof req.body.openPana === 'string' ? req.body.openPana.trim() : ''
  const closePana = req.body.closePana === undefined ? undefined : typeof req.body.closePana === 'string' ? req.body.closePana.trim() : ''
  if (!marketId || !resultDate || (!openPana && !closePana) || (openPana !== undefined && !isPana(openPana)) || (closePana !== undefined && !isPana(closePana))) {
    res.status(400).json({ error: 'marketId, resultDate and at least one valid pana are required' }); return
  }
  try {
    const outcome = await declareResult({ marketId, resultDate, openPana, closePana })
    res.status(outcome.created ? 201 : 200).json(outcome.result)
  } catch (error) {
    if (error instanceof Error && error.message === 'RESULT_ALREADY_SETTLED') { res.status(409).json({ error: 'A settled result cannot be corrected' }); return }
    if (error instanceof Error && error.message === 'BALANCE_LIMIT') { res.status(409).json({ error: 'Winning payout exceeds customer balance limit' }); return }
    throw error
  }
})

router.put('/:id', async (req: Request, res: Response) => {
  const id = parseId(req.params.id)
  const openPana = req.body.openPana === undefined ? undefined : typeof req.body.openPana === 'string' ? req.body.openPana.trim() : ''
  const closePana = req.body.closePana === undefined ? undefined : typeof req.body.closePana === 'string' ? req.body.closePana.trim() : ''
  if (!id || (!openPana && !closePana) || (openPana !== undefined && !isPana(openPana)) || (closePana !== undefined && !isPana(closePana))) {
    res.status(400).json({ error: 'At least one valid pana is required' }); return
  }
  const current = await prisma.result.findUnique({ where: { id } })
  if (!current) { res.status(404).json({ error: 'Result not found' }); return }
  try {
    const outcome = await declareResult({ marketId: current.marketId, resultDate: current.resultDate, openPana, closePana })
    res.json(outcome.result)
  } catch (error) {
    if (error instanceof Error && error.message === 'RESULT_ALREADY_SETTLED') { res.status(409).json({ error: 'A settled result cannot be corrected' }); return }
    if (error instanceof Error && error.message === 'BALANCE_LIMIT') { res.status(409).json({ error: 'Winning payout exceeds customer balance limit' }); return }
    throw error
  }
})

export default router
