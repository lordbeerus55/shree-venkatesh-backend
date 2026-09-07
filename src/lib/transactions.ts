import { Prisma } from '@prisma/client'
import prisma from './prisma'

type TransactionClient = Prisma.TransactionClient

export async function serializable<T>(operation: (tx: TransactionClient) => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 15000,
      })
    } catch (error) {
      lastError = error
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError && (
        ['P2034', 'P2002'].includes(error.code) ||
        (error.code === 'P2010' && String(error.meta?.code) === '40001')
      )
      if (!retryable) throw error
      await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)))
    }
  }
  throw lastError
}

export async function lockUser(tx: TransactionClient, userId: number): Promise<{ walletBalance: Prisma.Decimal; fundsReserved: Prisma.Decimal } | null> {
  const rows = await tx.$queryRaw<Array<{ walletBalance: Prisma.Decimal; fundsReserved: Prisma.Decimal }>>`
    SELECT "walletBalance", "fundsReserved" FROM "User" WHERE "id" = ${userId} FOR UPDATE
  `
  return rows[0] ?? null
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

export type { TransactionClient }
