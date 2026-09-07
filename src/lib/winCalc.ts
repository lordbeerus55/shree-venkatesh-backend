import { Bid, Prisma, Result } from '@prisma/client'
import { GameType, isDoublePana, isPana, isSinglePana, isTriplePana, isValidBidNumber } from './validation'

type BidWithResult = Bid & { result?: Result | null }

function panaDigit(pana: string): string {
  const sum = pana.split('').reduce((total, digit) => total + Number(digit), 0)
  return String(sum % 10)
}

export function calculateWin(bid: BidWithResult, result: Result): Prisma.Decimal {
  const zero = new Prisma.Decimal(0)
  const gameType = bid.gameType as GameType
  if (!isValidBidNumber(gameType, bid.number)) return zero

  const openPana = result.openPana ?? ''
  const closePana = result.closePana ?? ''
  const openDigit = result.openDigit ?? (isPana(openPana) ? panaDigit(openPana) : '')
  const closeDigit = result.closeDigit ?? (isPana(closePana) ? panaDigit(closePana) : '')
  const jodi = result.jodi ?? (openDigit && closeDigit ? openDigit + closeDigit : '')
  const targetPana = bid.session === 'open' ? openPana : closePana
  const targetDigit = bid.session === 'open' ? openDigit : closeDigit
  let won = false

  switch (gameType) {
    case 'single': won = bid.number === targetDigit; break
    case 'jodi': won = bid.number === jodi; break
    case 'single_pana':
    case 'sp': won = bid.number === targetPana && isSinglePana(targetPana); break
    case 'double_pana':
    case 'dp': won = bid.number === targetPana && isDoublePana(targetPana); break
    case 'triple_pana':
    case 'tp': won = bid.number === targetPana && isTriplePana(targetPana); break
    case 'fp':
    case 'cp': won = bid.number === targetPana && isPana(targetPana); break
    case 'half_sangam': {
      const [digit, pana] = bid.number.split('-')
      won = bid.session === 'open'
        ? digit === openDigit && pana === closePana
        : pana === openPana && digit === closeDigit
      break
    }
    case 'full_sangam': {
      const [open, close] = bid.number.split('-')
      won = open === openPana && close === closePana
      break
    }
    default: return zero
  }
  return won ? bid.amount.mul(bid.payoutMultiplier) : zero
}

export function derivePanaDigit(pana: string): string {
  if (!isPana(pana)) throw new Error('Invalid pana')
  return panaDigit(pana)
}

export function deriveJodi(openDigit: string, closeDigit: string): string {
  if (!/^\d$/.test(openDigit) || !/^\d$/.test(closeDigit)) throw new Error('Invalid digits')
  return openDigit + closeDigit
}
