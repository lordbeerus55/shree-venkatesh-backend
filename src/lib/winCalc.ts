import { Bid, GameRate, Result } from '@prisma/client'

type BidWithResult = Bid & { result?: Result | null }

function panaDigit(pana: string): string {
  const sum = pana.split('').reduce((a, c) => a + parseInt(c, 10), 0)
  return String(sum % 10)
}

function isDoublePana(pana: string): boolean {
  const digits = pana.split('')
  return (
    (digits[0] === digits[1] || digits[1] === digits[2] || digits[0] === digits[2]) &&
    digits[0] !== digits[1] || digits[1] !== digits[2]
  )
}

function isTriplePana(pana: string): boolean {
  return pana[0] === pana[1] && pana[1] === pana[2]
}

export function calculateWin(bid: BidWithResult, result: Result, rates: GameRate): number {
  const { session, gameType, number, amount } = bid
  const amt = Number(amount)

  const openPana = result.openPana ?? ''
  const closePana = result.closePana ?? ''
  const openDigit = result.openDigit ?? (openPana ? panaDigit(openPana) : '')
  const closeDigit = result.closeDigit ?? (closePana ? panaDigit(closePana) : '')
  const jodi = result.jodi ?? (openDigit && closeDigit ? openDigit + closeDigit : '')

  const targetPana = session === 'open' ? openPana : closePana
  const targetDigit = session === 'open' ? openDigit : closeDigit

  switch (gameType) {
    case 'single':
      return number === targetDigit ? amt * rates.single : 0

    case 'jodi':
      return number === jodi ? amt * rates.jodi : 0

    case 'single_pana':
      return number === targetPana ? amt * rates.singlePana : 0

    case 'double_pana':
      return number === targetPana && isDoublePana(targetPana) ? amt * rates.doublePana : 0

    case 'triple_pana':
      return number === targetPana && isTriplePana(targetPana) ? amt * rates.triplePana : 0

    case 'sp':
      return number === targetPana ? amt * rates.sp : 0

    case 'dp':
      return number === targetPana ? amt * rates.dp : 0

    case 'tp':
      return number === targetPana ? amt * rates.tp : 0

    case 'fp':
      return number === targetPana ? amt * rates.fp : 0

    case 'cp':
      return number === targetPana ? amt * rates.cp : 0

    case 'half_sangam': {
      const [digit, pana] = number.split('-')
      if (session === 'open') {
        return digit === openDigit && pana === closePana ? amt * rates.halfSangam : 0
      }
      return pana === openPana && digit === closeDigit ? amt * rates.halfSangam : 0
    }

    case 'full_sangam': {
      const [pana1, pana2] = number.split('-')
      return pana1 === openPana && pana2 === closePana ? amt * rates.fullSangam : 0
    }

    default:
      return 0
  }
}

export function derivePanaDigit(pana: string): string {
  return panaDigit(pana)
}

export function deriveJodi(openDigit: string, closeDigit: string): string {
  return openDigit + closeDigit
}
