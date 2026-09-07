import { Prisma } from '@prisma/client'

export const GAME_TYPES = [
  'single', 'jodi', 'single_pana', 'double_pana', 'triple_pana',
  'sp', 'dp', 'tp', 'fp', 'cp', 'half_sangam', 'full_sangam',
] as const

export type GameType = typeof GAME_TYPES[number]

export function parseId(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const text = String(value)
  if (!/^[1-9]\d*$/.test(text)) return null
  const id = Number(text)
  return Number.isSafeInteger(id) ? id : null
}

export function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null
}

export const MAX_BALANCE = new Prisma.Decimal('9999999999.99')

export function parseAmount(value: unknown, maximum = '99999999.99'): Prisma.Decimal | null {
  const text = typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(text)) return null
  try {
    const amount = new Prisma.Decimal(text)
    if (!amount.isPositive() || amount.greaterThan(new Prisma.Decimal(maximum))) return null
    return amount
  } catch {
    return null
  }
}

export function parsePage(query: Record<string, unknown>): { page: number; limit: number; skip: number } | null {
  const pageText = query.page === undefined ? '1' : String(query.page)
  const limitText = query.limit === undefined ? '50' : String(query.limit)
  if (!/^[1-9]\d*$/.test(pageText) || !/^[1-9]\d*$/.test(limitText)) return null
  const page = Number(pageText)
  const limit = Number(limitText)
  if (!Number.isSafeInteger(page) || !Number.isSafeInteger(limit) || limit > 100) return null
  return { page, limit, skip: (page - 1) * limit }
}

export function parseIdempotencyKey(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const key = value.trim()
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(key) ? key : null
}

export function isPana(value: string): boolean {
  return /^\d{3}$/.test(value)
}

export function isSinglePana(value: string): boolean {
  return isPana(value) && new Set(value).size === 3
}

export function isDoublePana(value: string): boolean {
  return isPana(value) && new Set(value).size === 2
}

export function isTriplePana(value: string): boolean {
  return isPana(value) && new Set(value).size === 1
}

export function isValidBidNumber(gameType: GameType, number: string): boolean {
  switch (gameType) {
    case 'single': return /^\d$/.test(number)
    case 'jodi': return /^\d{2}$/.test(number)
    case 'single_pana':
    case 'sp': return isSinglePana(number)
    case 'double_pana':
    case 'dp': return isDoublePana(number)
    case 'triple_pana':
    case 'tp': return isTriplePana(number)
    case 'fp':
    case 'cp': return isPana(number)
    case 'half_sangam': {
      const parts = number.split('-')
      return parts.length === 2 && /^\d$/.test(parts[0]) && isPana(parts[1])
    }
    case 'full_sangam': {
      const parts = number.split('-')
      return parts.length === 2 && isPana(parts[0]) && isPana(parts[1])
    }
  }
}

export function marketSessionIsOpen(
  bidDate: Date,
  session: 'open' | 'close',
  schedules: Array<{ dayOfWeek: string; openTime: string; closeTime: string; isActive: boolean }>,
  now = new Date()
): boolean {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const schedule = schedules.find((item) => item.isActive && item.dayOfWeek.toLowerCase() === days[bidDate.getUTCDay()].toLowerCase())
  if (!schedule) return false

  const indiaParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const value = (type: Intl.DateTimeFormatPartTypes) => indiaParts.find((part) => part.type === type)?.value || ''
  const businessDate = `${value('year')}-${value('month')}-${value('day')}`
  const requestedDate = bidDate.toISOString().slice(0, 10)
  if (requestedDate < businessDate) return false
  if (requestedDate > businessDate) {
    const horizon = (bidDate.getTime() - new Date(`${businessDate}T00:00:00.000Z`).getTime()) / 86400000
    return horizon <= 7
  }

  const parseTime = (time: string): number | null => {
    const match = time.trim().match(/^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i)
    if (!match) return null
    let hour = Number(match[1])
    const minute = Number(match[2])
    if (minute > 59 || hour > (match[3] ? 12 : 23) || hour < (match[3] ? 1 : 0)) return null
    if (match[3]) {
      if (hour === 12) hour = 0
      if (match[3].toUpperCase() === 'PM') hour += 12
    }
    return hour * 60 + minute
  }
  const cutoff = parseTime(session === 'open' ? schedule.openTime : schedule.closeTime)
  if (cutoff === null) return false
  return Number(value('hour')) * 60 + Number(value('minute')) < cutoff
}

export function gameRateField(gameType: GameType): 'single' | 'jodi' | 'singlePana' | 'doublePana' | 'triplePana' | 'sp' | 'dp' | 'tp' | 'fp' | 'cp' | 'halfSangam' | 'fullSangam' {
  const fields = {
    single: 'single', jodi: 'jodi', single_pana: 'singlePana', double_pana: 'doublePana',
    triple_pana: 'triplePana', sp: 'sp', dp: 'dp', tp: 'tp', fp: 'fp', cp: 'cp',
    half_sangam: 'halfSangam', full_sangam: 'fullSangam',
  } as const
  return fields[gameType]
}
