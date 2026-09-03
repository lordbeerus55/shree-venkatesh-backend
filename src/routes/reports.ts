import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'

const router = Router()

router.get('/dashboard', async (req: Request, res: Response) => {
  const { date } = req.query
  const targetDate = date ? new Date(date as string) : new Date()
  const startOfDay = new Date(targetDate)
  startOfDay.setHours(0, 0, 0, 0)
  const endOfDay = new Date(targetDate)
  endOfDay.setHours(23, 59, 59, 999)

  const [
    totalUsers,
    bannedUsers,
    todayBids,
    todayWins,
    todayDeposits,
    todayWithdrawals,
    totalWallet,
    admin,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { isBanned: true } }),
    prisma.bid.aggregate({
      where: { bidDate: { gte: startOfDay, lte: endOfDay }, status: { not: 'reverted' } },
      _sum: { amount: true },
    }),
    prisma.bid.aggregate({
      where: { bidDate: { gte: startOfDay, lte: endOfDay }, status: 'won' },
      _sum: { winningAmount: true },
    }),
    prisma.depositRequest.aggregate({
      where: { status: 'approved', processedAt: { gte: startOfDay, lte: endOfDay } },
      _sum: { amount: true },
    }),
    prisma.withdrawRequest.aggregate({
      where: { status: 'approved', processedAt: { gte: startOfDay, lte: endOfDay } },
      _sum: { amount: true },
    }),
    prisma.user.aggregate({ _sum: { walletBalance: true } }),
    prisma.admin.findFirst({ select: { walletBalance: true } }),
  ])

  const todayBetAmount = Number(todayBids._sum.amount ?? 0)
  const todayWinAmount = Number(todayWins._sum.winningAmount ?? 0)

  res.json({
    adminWallet: Number(admin?.walletBalance ?? 0),
    totalUsers,
    bannedUsers,
    todayBetAmount,
    todayWinAmount,
    todayProfit: todayBetAmount - todayWinAmount,
    todayDeposit: Number(todayDeposits._sum.amount ?? 0),
    todayWithdrawComplete: Number(todayWithdrawals._sum.amount ?? 0),
    todayAdminDeposit: Number(todayDeposits._sum.amount ?? 0),
    todayAdminWithdraw: Number(todayWithdrawals._sum.amount ?? 0),
    totalWalletBalance: Number(totalWallet._sum.walletBalance ?? 0),
  })
})

router.get('/market-transactions', async (req: Request, res: Response) => {
  const { date } = req.query
  const targetDate = date ? new Date(date as string) : new Date()
  const startOfDay = new Date(targetDate)
  startOfDay.setHours(0, 0, 0, 0)
  const endOfDay = new Date(targetDate)
  endOfDay.setHours(23, 59, 59, 999)

  const markets = await prisma.market.findMany({ select: { id: true, name: true } })

  const results = await Promise.all(
    markets.map(async (market: { id: number; name: string }) => {
      const [bids, wins] = await Promise.all([
        prisma.bid.aggregate({
          where: { marketId: market.id, bidDate: { gte: startOfDay, lte: endOfDay }, status: { not: 'reverted' } },
          _sum: { amount: true },
        }),
        prisma.bid.aggregate({
          where: { marketId: market.id, bidDate: { gte: startOfDay, lte: endOfDay }, status: 'won' },
          _sum: { winningAmount: true },
        }),
      ])
      const bidAmount = Number(bids._sum.amount ?? 0)
      const winAmount = Number(wins._sum.winningAmount ?? 0)
      return { market: market.name, bidAmount, winAmount, profitLoss: bidAmount - winAmount }
    })
  )

  res.json(results)
})

router.get('/sell-report', async (req: Request, res: Response) => {
  const { date } = req.query
  const targetDate = date ? new Date(date as string) : new Date()
  const startOfDay = new Date(targetDate)
  startOfDay.setHours(0, 0, 0, 0)
  const endOfDay = new Date(targetDate)
  endOfDay.setHours(23, 59, 59, 999)

  const gameTypes = [
    'single', 'jodi', 'single_pana', 'double_pana', 'triple_pana',
    'sp', 'dp', 'tp', 'fp', 'cp', 'half_sangam', 'full_sangam',
  ]

  const rows = await Promise.all(
    gameTypes.map(async (gt) => {
      const agg = await prisma.bid.aggregate({
        where: { gameType: gt, bidDate: { gte: startOfDay, lte: endOfDay }, status: { not: 'reverted' } },
        _sum: { amount: true },
        _count: { id: true },
      })
      return { gameType: gt, count: agg._count.id, totalAmount: Number(agg._sum.amount ?? 0) }
    })
  )

  res.json(rows)
})

export default router
