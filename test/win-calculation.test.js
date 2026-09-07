const assert = require('node:assert/strict')
const { test } = require('node:test')
const { Prisma } = require('@prisma/client')
const { calculateWin, deriveJodi, derivePanaDigit } = require('../dist/lib/winCalc.js')
const {
  GAME_TYPES,
  isDoublePana,
  isPana,
  isSinglePana,
  isTriplePana,
  isValidBidNumber,
} = require('../dist/lib/validation.js')

const decimal = (value) => new Prisma.Decimal(value)

function bid(gameType, number, session = 'open', amount = '2.35', payoutMultiplier = '10') {
  return {
    gameType,
    number,
    session,
    amount: decimal(amount),
    payoutMultiplier: decimal(payoutMultiplier),
  }
}

const baseResult = { openPana: '123', closePana: '456' }

test('derivePanaDigit table', () => {
  const cases = [
    ['123', '6'],
    ['456', '5'],
    ['550', '0'],
    ['999', '7'],
    ['000', '0'],
  ]

  for (const [pana, expected] of cases) {
    assert.equal(derivePanaDigit(pana), expected, pana)
  }

  for (const invalid of ['', '12', '1234', '12a']) {
    assert.throws(() => derivePanaDigit(invalid), /Invalid pana/, invalid)
  }
})

test('deriveJodi table', () => {
  const cases = [
    ['6', '5', '65'],
    ['0', '0', '00'],
    ['9', '1', '91'],
  ]

  for (const [openDigit, closeDigit, expected] of cases) {
    assert.equal(deriveJodi(openDigit, closeDigit), expected, `${openDigit}-${closeDigit}`)
  }

  for (const [openDigit, closeDigit] of [['', '1'], ['10', '1'], ['1', 'x'], ['1', '']]) {
    assert.throws(() => deriveJodi(openDigit, closeDigit), /Invalid digits/)
  }
})

test('single, double, and triple pana classification tables', () => {
  const cases = [
    { label: 'single pana', predicate: isSinglePana, valid: ['123', '120', '908'], invalid: ['112', '111', '12', '12a'] },
    { label: 'double pana', predicate: isDoublePana, valid: ['112', '121', '455'], invalid: ['123', '111', '11', '1a1'] },
    { label: 'triple pana', predicate: isTriplePana, valid: ['000', '777', '999'], invalid: ['123', '112', '77', '7a7'] },
  ]

  for (const { label, predicate, valid, invalid } of cases) {
    for (const pana of valid) assert.equal(predicate(pana), true, `${label}: ${pana} should be valid`)
    for (const pana of invalid) assert.equal(predicate(pana), false, `${label}: ${pana} should be invalid`)
  }

  assert.equal(isPana('123'), true)
  assert.equal(isPana('12a'), false)
  assert.equal(isDoublePana('123'), false, 'regression: 123 must not be accepted as double pana')
})

test('bid number validation covers every GAME_TYPES entry', () => {
  const cases = {
    single: { valid: '0', invalid: '10' },
    jodi: { valid: '05', invalid: '5' },
    single_pana: { valid: '123', invalid: '112' },
    double_pana: { valid: '112', invalid: '123' },
    triple_pana: { valid: '777', invalid: '778' },
    sp: { valid: '456', invalid: '455' },
    dp: { valid: '455', invalid: '456' },
    tp: { valid: '999', invalid: '998' },
    fp: { valid: '112', invalid: '11' },
    cp: { valid: '777', invalid: '7777' },
    half_sangam: { valid: '6-456', invalid: '66-456' },
    full_sangam: { valid: '123-456', invalid: '12-456' },
  }

  assert.deepEqual(Object.keys(cases).sort(), [...GAME_TYPES].sort())
  for (const gameType of GAME_TYPES) {
    const { valid, invalid } = cases[gameType]
    assert.equal(isValidBidNumber(gameType, valid), true, `${gameType}: ${valid} should be valid`)
    assert.equal(isValidBidNumber(gameType, invalid), false, `${gameType}: ${invalid} should be invalid`)
  }
})

test('calculateWin winning and losing table for every game type', () => {
  const cases = [
    { label: 'single', gameType: 'single', win: '6', lose: '7', result: baseResult },
    { label: 'jodi derived from panas', gameType: 'jodi', win: '65', lose: '66', result: baseResult },
    { label: 'single_pana', gameType: 'single_pana', win: '123', lose: '124', result: baseResult },
    { label: 'double_pana', gameType: 'double_pana', win: '455', lose: '445', session: 'close', result: { openPana: '123', closePana: '455' } },
    { label: 'triple_pana', gameType: 'triple_pana', win: '777', lose: '888', result: { openPana: '777', closePana: '456' } },
    { label: 'sp', gameType: 'sp', win: '456', lose: '457', session: 'close', result: baseResult },
    { label: 'dp', gameType: 'dp', win: '112', lose: '113', result: { openPana: '112', closePana: '456' } },
    { label: 'tp', gameType: 'tp', win: '999', lose: '888', session: 'close', result: { openPana: '123', closePana: '999' } },
    { label: 'fp', gameType: 'fp', win: '112', lose: '113', result: { openPana: '112', closePana: '456' } },
    { label: 'cp', gameType: 'cp', win: '777', lose: '778', session: 'close', result: { openPana: '123', closePana: '777' } },
    { label: 'half_sangam open digit to close pana', gameType: 'half_sangam', win: '6-456', lose: '7-456', result: baseResult },
    { label: 'half_sangam close digit to open pana', gameType: 'half_sangam', win: '5-123', lose: '4-123', session: 'close', result: baseResult },
    { label: 'full_sangam', gameType: 'full_sangam', win: '123-456', lose: '123-457', result: baseResult },
  ]

  for (const { label, gameType, win, lose, session = 'open', result } of cases) {
    assert.equal(calculateWin(bid(gameType, win, session), result).toString(), '23.5', `${label} should win`)
    assert.equal(calculateWin(bid(gameType, lose, session), result).toString(), '0', `${label} should lose`)
  }
})

test('calculateWin honors explicit result digits and jodi', () => {
  const result = { ...baseResult, openDigit: '2', closeDigit: '8', jodi: '19' }

  assert.equal(calculateWin(bid('single', '2'), result).toString(), '23.5')
  assert.equal(calculateWin(bid('single', '6'), result).toString(), '0')
  assert.equal(calculateWin(bid('jodi', '19'), result).toString(), '23.5')
  assert.equal(calculateWin(bid('jodi', '28'), result).toString(), '0')
})

test('calculateWin preserves Decimal cents and uses the bid snapshotted multiplier', () => {
  const snapshottedMultiplier = '17'
  const winningBid = bid('single', '6', 'open', '0.29', snapshottedMultiplier)

  const winnings = calculateWin(winningBid, baseResult)

  assert.ok(winnings instanceof Prisma.Decimal)
  assert.equal(winnings.toString(), '4.93')
})
