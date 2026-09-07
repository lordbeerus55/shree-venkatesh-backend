import { Prisma } from '@prisma/client'
import { Router, Request, Response, NextFunction } from 'express'
import prisma from '../lib/prisma'
import { isUniqueViolation, lockUser, serializable } from '../lib/transactions'
import {
  GAME_TYPES, GameType, MAX_BALANCE, gameRateField, isValidBidNumber, marketSessionIsOpen,
  parseAmount, parseDate, parseId, parseIdempotencyKey, parsePage,
} from '../lib/validation'

const router = Router()
const COMBINED_GAME_TYPES = ['jodi', 'half_sangam', 'full_sangam']

function rejectUserId(req: Request, res: Response, next: NextFunction): void {
  if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'userId') || Object.prototype.hasOwnProperty.call(req.query, 'userId')) {
    res.status(400).json({ error: 'userId must not be supplied' })
    return
  }
  next()
}

router.use(rejectUserId)

router.get('/me', async (req: Request, res: Response) => {
  const customer = await prisma.user.findUnique({
    where: { id: req.customer!.id },
    select: { id: true, name: true, username: true, mobile: true, walletBalance: true, fundsReserved: true },
  })
  res.json(customer)
})

router.get('/markets', async (_req: Request, res: Response) => {
  const markets = await prisma.market.findMany({
    where: { isActive: true },
    include: { schedules: { where: { isActive: true }, orderBy: { id: 'asc' } } },
    orderBy: { id: 'asc' },
  })
  res.json(markets)
})

router.get('/rates', async (_req: Request, res: Response) => {
  const rates = await prisma.gameRate.findFirst({ orderBy: { id: 'asc' } })
  res.json(rates)
})

router.get('/results', async (req: Request, res: Response) => {
  const pagination = parsePage(req.query as Record<string, unknown>)
  const marketId = req.query.marketId === undefined ? null : parseId(req.query.marketId)
  const startDate = req.query.startDate === undefined ? null : parseDate(req.query.startDate)
  const endDate = req.query.endDate === undefined ? null : parseDate(req.query.endDate)
  if (!pagination || (req.query.marketId !== undefined && !marketId) || (req.query.startDate !== undefined && !startDate) ||
      (req.query.endDate !== undefined && !endDate) || Boolean(startDate) !== Boolean(endDate) ||
      (startDate && endDate && (endDate < startDate || endDate.getTime() - startDate.getTime() > 90 * 86400000))) {
    res.status(400).json({ error: 'Invalid or unbounded result filters' })
    return
  }
  const where: Prisma.ResultWhereInput = {
    declaredAt: { not: null },
    ...(marketId ? { marketId } : {}),
    ...(startDate || endDate ? { resultDate: { ...(startDate ? { gte: startDate } : {}), ...(endDate ? { lte: endDate } : {}) } } : {}),
  }
  const [results, total] = await Promise.all([
    prisma.result.findMany({
      where,
      include: { market: { select: { id: true, name: true } } },
      orderBy: [{ resultDate: 'desc' }, { id: 'desc' }],
      skip: pagination.skip,
      take: pagination.limit,
    }),
    prisma.result.count({ where }),
  ])
  res.json({ results, total, page: pagination.page, limit: pagination.limit })
})

router.post('/bids', async (req: Request, res: Response) => {
  const marketId = parseId(req.body.marketId)
  const bidDate = parseDate(req.body.bidDate)
  const session = req.body.session
  const gameType = req.body.gameType
  const number = typeof req.body.number === 'string' ? req.body.number.trim() : ''
  const amount = parseAmount(req.body.amount)
  const idempotencyKey = parseIdempotencyKey(req.body.idempotencyKey)
  if (!marketId || !bidDate || !['open', 'close'].includes(session) || !GAME_TYPES.includes(gameType) ||
      (COMBINED_GAME_TYPES.includes(gameType) && session !== 'close') ||
      !isValidBidNumber(gameType as GameType, number) || !amount || !idempotencyKey) {
    res.status(400).json({ error: 'Invalid bid data' })
    return
  }
  const userId = req.customer!.id
  const dataMatches = (bid: { marketId: number; bidDate: Date; session: string; gameType: string; number: string; amount: Prisma.Decimal }) =>
    bid.marketId === marketId && bid.bidDate.getTime() === bidDate.getTime() && bid.session === session &&
    bid.gameType === gameType && bid.number === number && bid.amount.equals(amount)
  try {
    const outcome = await serializable(async (tx) => {
      const existing = await tx.bid.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } })
      if (existing) return { bid: existing, created: false, conflict: !dataMatches(existing) }
      const market = await tx.market.findFirst({
        where: { id: marketId, isActive: true },
        include: { schedules: { where: { isActive: true } } },
      })
      if (!market || !marketSessionIsOpen(bidDate, session as 'open' | 'close', market.schedules)) {
        throw new Error('MARKET_UNAVAILABLE')
      }
      const declared = await tx.result.findUnique({ where: { marketId_resultDate: { marketId, resultDate: bidDate } } })
      const resultClosed = COMBINED_GAME_TYPES.includes(gameType)
        ? Boolean(declared?.openPana)
        : session === 'open'
          ? Boolean(declared?.openPana)
          : Boolean(declared?.closePana)
      if (resultClosed) throw new Error('RESULT_DECLARED')
      const rates = await tx.gameRate.findFirst({ orderBy: { id: 'asc' } })
      if (!rates) throw new Error('RATES_UNAVAILABLE')
      const payoutMultiplier = new Prisma.Decimal(rates[gameRateField(gameType as GameType)])
      if (amount.mul(payoutMultiplier).greaterThan(MAX_BALANCE)) throw new Error('PAYOUT_TOO_LARGE')
      const balance = await lockUser(tx, userId)
      if (!balance || balance.walletBalance.lessThan(amount)) throw new Error('INSUFFICIENT_FUNDS')
      const after = balance.walletBalance.minus(amount)
      const bid = await tx.bid.create({
        data: {
          userId, marketId, bidDate, session, gameType, number, amount, idempotencyKey, payoutMultiplier,
        },
      })
      await tx.user.update({ where: { id: userId }, data: { walletBalance: after } })
      await tx.walletTransaction.create({
        data: {
          userId, type: 'debit', remark: `Bid (${number})`, beforeBalance: balance.walletBalance,
          amount, afterBalance: after, referenceType: 'bid', referenceId: bid.id,
        },
      })
      return { bid, created: true, conflict: false }
    })
    if (outcome.conflict) { res.status(409).json({ error: 'Idempotency key already used with different data' }); return }
    res.status(outcome.created ? 201 : 200).json(outcome.bid)
  } catch (error) {
    if (isUniqueViolation(error)) {
      const existing = await prisma.bid.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } })
      if (existing && dataMatches(existing)) { res.json(existing); return }
      if (existing) { res.status(409).json({ error: 'Idempotency key already used with different data' }); return }
    }
    const message = error instanceof Error ? error.message : ''
    if (message === 'INSUFFICIENT_FUNDS') { res.status(409).json({ error: 'Insufficient funds' }); return }
    if (message === 'PAYOUT_TOO_LARGE') { res.status(400).json({ error: 'Bid payout exceeds supported limit' }); return }
    if (['MARKET_UNAVAILABLE', 'RESULT_DECLARED', 'RATES_UNAVAILABLE'].includes(message)) { res.status(409).json({ error: message.toLowerCase().replace(/_/g, ' ') }); return }
    throw error
  }
})

router.get('/bids', async (req: Request, res: Response) => {
  const pagination = parsePage(req.query as Record<string, unknown>)
  const marketId = req.query.marketId === undefined ? null : parseId(req.query.marketId)
  const date = req.query.date === undefined ? null : parseDate(req.query.date)
  const statuses = ['pending', 'won', 'lost', 'reverted']
  if (!pagination || (req.query.marketId !== undefined && !marketId) || (req.query.date !== undefined && !date) ||
      (req.query.status !== undefined && (typeof req.query.status !== 'string' || !statuses.includes(req.query.status)))) {
    res.status(400).json({ error: 'Invalid filters' }); return
  }
  const where: Prisma.BidWhereInput = { userId: req.customer!.id, ...(marketId ? { marketId } : {}), ...(date ? { bidDate: date } : {}), ...(req.query.status ? { status: req.query.status as string } : {}) }
  const [bids, total] = await Promise.all([
    prisma.bid.findMany({ where, include: { market: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' }, skip: pagination.skip, take: pagination.limit }),
    prisma.bid.count({ where }),
  ])
  res.json({ bids, total, page: pagination.page, limit: pagination.limit })
})

router.get('/wallet', async (req: Request, res: Response) => {
  const pagination = parsePage(req.query as Record<string, unknown>)
  if (!pagination || (req.query.type !== undefined && !['credit', 'debit'].includes(String(req.query.type)))) {
    res.status(400).json({ error: 'Invalid filters' }); return
  }
  const where = { userId: req.customer!.id, ...(req.query.type ? { type: String(req.query.type) } : {}) }
  const [transactions, total, customer] = await Promise.all([
    prisma.walletTransaction.findMany({ where, orderBy: { createdAt: 'desc' }, skip: pagination.skip, take: pagination.limit }),
    prisma.walletTransaction.count({ where }),
    prisma.user.findUnique({ where: { id: req.customer!.id }, select: { walletBalance: true, fundsReserved: true } }),
  ])
  res.json({ transactions, total, page: pagination.page, limit: pagination.limit, ...customer })
})

router.post('/deposits', async (req: Request, res: Response) => {
  const amount = parseAmount(req.body.amount)
  const idempotencyKey = parseIdempotencyKey(req.body.idempotencyKey)
  const paymentMethod = typeof req.body.paymentMethod === 'string' ? req.body.paymentMethod.trim() : ''
  const transactionRef = typeof req.body.transactionRef === 'string' ? req.body.transactionRef.trim() : ''
  const proofImageUrl = typeof req.body.proofImageUrl === 'string' ? req.body.proofImageUrl.trim() : ''
  if (!amount || !idempotencyKey || !paymentMethod || paymentMethod.length > 50 || transactionRef.length > 100 || proofImageUrl.length > 500) {
    res.status(400).json({ error: 'Invalid deposit data' }); return
  }
  const userId = req.customer!.id
  const existing = await prisma.depositRequest.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } })
  if (existing) {
    if (!existing.amount.equals(amount) || existing.paymentMethod !== paymentMethod ||
        (existing.transactionRef ?? '') !== transactionRef || (existing.proofImageUrl ?? '') !== proofImageUrl) {
      res.status(409).json({ error: 'Idempotency key already used with different data' }); return
    }
    res.json(existing); return
  }
  try {
    const deposit = await prisma.depositRequest.create({ data: { userId, amount, paymentMethod, transactionRef: transactionRef || null, proofImageUrl: proofImageUrl || null, idempotencyKey } })
    res.status(201).json(deposit)
  } catch (error) {
    if (isUniqueViolation(error)) {
      const duplicate = await prisma.depositRequest.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } })
      if (duplicate && duplicate.amount.equals(amount) && duplicate.paymentMethod === paymentMethod &&
          (duplicate.transactionRef ?? '') === transactionRef && (duplicate.proofImageUrl ?? '') === proofImageUrl) {
        res.json(duplicate); return
      }
      if (duplicate) { res.status(409).json({ error: 'Idempotency key already used with different data' }); return }
    }
    throw error
  }
})

router.get('/deposits', async (req: Request, res: Response) => {
  const pagination = parsePage(req.query as Record<string, unknown>)
  if (!pagination) { res.status(400).json({ error: 'Invalid pagination' }); return }
  const where = { userId: req.customer!.id }
  const [requests, total] = await Promise.all([
    prisma.depositRequest.findMany({ where, orderBy: { createdAt: 'desc' }, skip: pagination.skip, take: pagination.limit }),
    prisma.depositRequest.count({ where }),
  ])
  res.json({ requests, total, page: pagination.page, limit: pagination.limit })
})

router.post('/withdrawals', async (req: Request, res: Response) => {
  const amount = parseAmount(req.body.amount)
  const idempotencyKey = parseIdempotencyKey(req.body.idempotencyKey)
  const accountHolder = typeof req.body.accountHolder === 'string' ? req.body.accountHolder.trim() : ''
  const accountNumber = typeof req.body.accountNumber === 'string' ? req.body.accountNumber.trim() : ''
  const ifscCode = typeof req.body.ifscCode === 'string' ? req.body.ifscCode.trim().toUpperCase() : ''
  const upiId = typeof req.body.upiId === 'string' ? req.body.upiId.trim() : ''
  const validPayment = /^[\w.-]{2,128}@[\w.-]{2,128}$/.test(upiId) ||
    (accountHolder.length >= 2 && accountHolder.length <= 100 && /^\d{6,34}$/.test(accountNumber) && /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifscCode))
  if (!amount || !idempotencyKey || !validPayment) { res.status(400).json({ error: 'Invalid withdrawal data' }); return }
  const userId = req.customer!.id
  const matches = (item: { amount: Prisma.Decimal; accountHolder: string | null; accountNumber: string | null; ifscCode: string | null; upiId: string | null }) =>
    item.amount.equals(amount) && (item.accountHolder ?? '') === accountHolder && (item.accountNumber ?? '') === accountNumber &&
    (item.ifscCode ?? '') === ifscCode && (item.upiId ?? '') === upiId
  try {
    const outcome = await serializable(async (tx) => {
      const existing = await tx.withdrawRequest.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } })
      if (existing) return { withdrawal: existing, created: false, conflict: !matches(existing) }
      const balance = await lockUser(tx, userId)
      if (!balance || balance.walletBalance.lessThan(amount)) throw new Error('INSUFFICIENT_FUNDS')
      const after = balance.walletBalance.minus(amount)
      const withdrawal = await tx.withdrawRequest.create({
        data: { userId, amount, accountHolder: accountHolder || null, accountNumber: accountNumber || null, ifscCode: ifscCode || null, upiId: upiId || null, idempotencyKey, fundsReserved: true },
      })
      await tx.user.update({ where: { id: userId }, data: { walletBalance: after, fundsReserved: { increment: amount } } })
      await tx.walletTransaction.create({
        data: { userId, type: 'debit', remark: `Withdrawal Reserved (#${withdrawal.id})`, beforeBalance: balance.walletBalance, amount, afterBalance: after, referenceType: 'withdrawal_reserve', referenceId: withdrawal.id },
      })
      return { withdrawal, created: true, conflict: false }
    })
    if (outcome.conflict) { res.status(409).json({ error: 'Idempotency key already used with different data' }); return }
    res.status(outcome.created ? 201 : 200).json(outcome.withdrawal)
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'INSUFFICIENT_FUNDS') { res.status(409).json({ error: 'Insufficient funds' }); return }
    if (isUniqueViolation(error)) {
      const duplicate = await prisma.withdrawRequest.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } })
      if (duplicate && matches(duplicate)) { res.json(duplicate); return }
      if (duplicate) { res.status(409).json({ error: 'Idempotency key already used with different data' }); return }
    }
    throw error
  }
})

router.get('/withdrawals', async (req: Request, res: Response) => {
  const pagination = parsePage(req.query as Record<string, unknown>)
  if (!pagination) { res.status(400).json({ error: 'Invalid pagination' }); return }
  const where = { userId: req.customer!.id }
  const [requests, total] = await Promise.all([
    prisma.withdrawRequest.findMany({ where, orderBy: { createdAt: 'desc' }, skip: pagination.skip, take: pagination.limit }),
    prisma.withdrawRequest.count({ where }),
  ])
  res.json({ requests, total, page: pagination.page, limit: pagination.limit })
})

export default router
