const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const { test } = require('node:test')

const projectRoot = path.resolve(__dirname, '..')
const parallelism = 4

function checkedTestDatabaseUrl() {
  const raw = process.env.TEST_DATABASE_URL
  assert.ok(raw, 'TEST_DATABASE_URL is required; integration tests will not use DATABASE_URL')
  const url = new URL(raw)
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol), 'TEST_DATABASE_URL must use PostgreSQL')
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(url.hostname), 'TEST_DATABASE_URL must point to a loopback host')
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''))
  assert.ok(database.toLowerCase().includes('_test'), 'TEST_DATABASE_URL database name must contain _test')
  return raw
}

function secret(size = 18) {
  return crypto.randomBytes(size).toString('base64url')
}

function businessDate(offset = 0) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const value = (type) => parts.find((part) => part.type === type).value
  const date = new Date(`${value('year')}-${value('month')}-${value('day')}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

async function waitForServer(baseUrl, child) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Backend exited during startup with code ${child.exitCode}`)
    try {
      const response = await fetch(`${baseUrl}/api/health`)
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Backend did not become healthy')
}

async function request(baseUrl, method, route, token, body, expected) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = await response.json().catch(() => null)
  const allowed = Array.isArray(expected) ? expected : [expected]
  assert.ok(allowed.includes(response.status), `${method} ${route}: expected ${allowed.join('/')} but received ${response.status}: ${JSON.stringify(payload)}`)
  return { status: response.status, payload }
}

async function concurrentRequests(count, operation) {
  return Promise.all(Array.from({ length: count }, (_, index) => operation(index)))
}

function assertStatuses(results, expected) {
  const actual = results.reduce((counts, result) => {
    counts[result.status] = (counts[result.status] || 0) + 1
    return counts
  }, {})
  assert.deepEqual(actual, expected)
}

function money(value) {
  return value.toFixed(2)
}

test('concurrent wallet operations preserve balances and exactly-once ledger effects', { timeout: 180000 }, async () => {
  const databaseUrl = checkedTestDatabaseUrl()
  const dates = Array.from({ length: 5 }, (_, index) => businessDate(index + 1))
  const adminUsername = `admin_concurrency_${secret(8)}`
  const adminPassword = secret(24)
  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    INITIAL_ADMIN_USERNAME: adminUsername,
    INITIAL_ADMIN_PASSWORD: adminPassword,
    JWT_SECRET: secret(48),
    NODE_ENV: 'test',
  }

  const migration = spawnSync('npx', ['prisma', 'migrate', 'deploy'], { cwd: projectRoot, env, encoding: 'utf8' })
  assert.equal(migration.status, 0, `Migration failed:\n${migration.stdout}\n${migration.stderr}`)

  const { PrismaClient } = require('@prisma/client')
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  const port = 20000 + crypto.randomInt(20000)
  const baseUrl = `http://127.0.0.1:${port}`
  const backend = spawn(process.execPath, ['dist/index.js'], {
    cwd: projectRoot,
    env: { ...env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  backend.stdout.on('data', (chunk) => { output += chunk })
  backend.stderr.on('data', (chunk) => { output += chunk })

  try {
    await waitForServer(baseUrl, backend)
    const adminLogin = await request(baseUrl, 'POST', '/api/auth/login', null, { username: adminUsername, password: adminPassword }, 200)
    const adminToken = adminLogin.payload.token

    const createCustomer = async (label) => {
      const identity = secret(6)
      const credentials = {
        name: `${label} ${identity}`,
        mobile: `9${crypto.randomInt(100000000, 999999999)}`,
        mpin: String(crypto.randomInt(1000, 9999)),
        username: `${label.toLowerCase().replace(/[^a-z]/g, '_')}_${identity}`,
        password: secret(18),
      }
      const created = await request(baseUrl, 'POST', '/api/users', adminToken, credentials, 201)
      const login = await request(baseUrl, 'POST', '/api/customer/auth/login', null, { identifier: credentials.username, credential: credentials.password }, 200)
      return { id: created.payload.id, token: login.payload.token }
    }

    const addPoints = (userId, amount, remark = secret(8)) => request(
      baseUrl, 'POST', `/api/users/${userId}/add-points`, adminToken, { amount, remark }, 200,
    )
    const dbUser = (userId) => prisma.user.findUniqueOrThrow({ where: { id: userId } })
    const ledgerCount = (userId, referenceType, referenceId) => prisma.walletTransaction.count({
      where: { userId, referenceType, ...(referenceId === undefined ? {} : { referenceId }) },
    })

    const market = await request(baseUrl, 'POST', '/api/markets', adminToken, {
      name: `Concurrency Market ${secret(8)}`,
      schedules: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((dayOfWeek) => ({ dayOfWeek, openTime: '23:58', closeTime: '23:59' })),
    }, 201)
    const marketId = market.payload.id
    await request(baseUrl, 'PUT', '/api/game-rates', adminToken, {
      single: 10, jodi: 100, singlePana: 160, doublePana: 320, triplePana: 1000,
      sp: 150, dp: 300, tp: 1000, fp: 150, cp: 150, halfSangam: 1200, fullSangam: 12000,
    }, 200)

    // Concurrent administrator credits must all accumulate; no update may be lost.
    const credited = await createCustomer('Admin Credit')
    const creditResults = await concurrentRequests(parallelism, (index) => addPoints(credited.id, '11.00', `concurrent-credit-${secret(6)}-${index}`))
    assertStatuses(creditResults, { 200: parallelism })
    assert.equal(money((await dbUser(credited.id)).walletBalance), '44.00')
    assert.equal(await ledgerCount(credited.id, 'admin_deposit'), parallelism)

    // Distinct, simultaneous bids for the entire balance may debit only once.
    const fullBidder = await createCustomer('Full Bid')
    await addPoints(fullBidder.id, '50.00')
    const fullBidResults = await concurrentRequests(parallelism, (index) => request(baseUrl, 'POST', '/api/customer/bids', fullBidder.token, {
      marketId, bidDate: dates[0], session: 'open', gameType: 'single', number: String(index),
      amount: '50.00', idempotencyKey: `key_${secret(12)}`,
    }, [201, 409]))
    assertStatuses(fullBidResults, { 201: 1, 409: parallelism - 1 })
    assert.equal(money((await dbUser(fullBidder.id)).walletBalance), '0.00')
    assert.equal(await prisma.bid.count({ where: { userId: fullBidder.id } }), 1)
    assert.equal(await ledgerCount(fullBidder.id, 'bid'), 1)

    // Replays racing with the same idempotency key create one bid and one debit.
    const idempotentBidder = await createCustomer('Idempotent Bid')
    await addPoints(idempotentBidder.id, '40.00')
    const bidKey = secret(12)
    const repeatedBid = {
      marketId, bidDate: dates[1], session: 'open', gameType: 'single', number: '8',
      amount: '10.00', idempotencyKey: bidKey,
    }
    const repeatedBidResults = await concurrentRequests(parallelism, () => request(
      baseUrl, 'POST', '/api/customer/bids', idempotentBidder.token, repeatedBid, [200, 201],
    ))
    assertStatuses(repeatedBidResults, { 200: parallelism - 1, 201: 1 })
    assert.equal(new Set(repeatedBidResults.map((result) => result.payload.id)).size, 1)
    assert.equal(money((await dbUser(idempotentBidder.id)).walletBalance), '30.00')
    assert.equal(await prisma.bid.count({ where: { userId: idempotentBidder.id, idempotencyKey: bidKey } }), 1)
    assert.equal(await ledgerCount(idempotentBidder.id, 'bid'), 1)

    // Identical result declarations racing one another settle and pay a winner once.
    const winner = await createCustomer('Winner')
    await addPoints(winner.id, '20.00')
    const winningBid = await request(baseUrl, 'POST', '/api/customer/bids', winner.token, {
      marketId, bidDate: dates[2], session: 'open', gameType: 'single', number: '6',
      amount: '10.00', idempotencyKey: `key_${secret(12)}`,
    }, 201)
    const declaration = { marketId, resultDate: dates[2], openPana: '123', closePana: '456' }
    const resultDeclarations = await concurrentRequests(parallelism, () => request(
      baseUrl, 'POST', '/api/results', adminToken, declaration, [200, 201],
    ))
    assertStatuses(resultDeclarations, { 200: parallelism - 1, 201: 1 })
    assert.equal(money((await dbUser(winner.id)).walletBalance), '110.00')
    assert.equal(await ledgerCount(winner.id, 'win', winningBid.payload.id), 1)
    const settledWinner = await prisma.bid.findUniqueOrThrow({ where: { id: winningBid.payload.id } })
    assert.equal(settledWinner.status, 'won')
    assert.equal(money(settledWinner.winningAmount), '100.00')

    // Concurrent approval attempts for one deposit produce one credit and one ledger row.
    const depositor = await createCustomer('Deposit')
    const deposit = await request(baseUrl, 'POST', '/api/customer/deposits', depositor.token, {
      amount: '25.00', paymentMethod: 'upi', transactionRef: secret(10), idempotencyKey: `key_${secret(12)}`,
    }, 201)
    const depositApprovals = await concurrentRequests(parallelism, () => request(
      baseUrl, 'POST', `/api/deposits/${deposit.payload.id}/approve`, adminToken, {}, [200, 409],
    ))
    assertStatuses(depositApprovals, { 200: 1, 409: parallelism - 1 })
    assert.equal(money((await dbUser(depositor.id)).walletBalance), '25.00')
    assert.equal(await ledgerCount(depositor.id, 'deposit_request', deposit.payload.id), 1)
    assert.equal((await prisma.depositRequest.findUniqueOrThrow({ where: { id: deposit.payload.id } })).status, 'approved')

    // A pending bid can be claimed for revert once, while a settled bid can never be reverted.
    const revertBidder = await createCustomer('Bid Revert')
    await addPoints(revertBidder.id, '30.00')
    const pendingBid = await request(baseUrl, 'POST', '/api/customer/bids', revertBidder.token, {
      marketId, bidDate: dates[3], session: 'open', gameType: 'single', number: '4',
      amount: '10.00', idempotencyKey: `key_${secret(12)}`,
    }, 201)
    const reverts = await concurrentRequests(parallelism, () => request(
      baseUrl, 'POST', `/api/bids/${pendingBid.payload.id}/revert`, adminToken, {}, [200, 409],
    ))
    assertStatuses(reverts, { 200: 1, 409: parallelism - 1 })
    assert.equal(money((await dbUser(revertBidder.id)).walletBalance), '30.00')
    assert.equal(await ledgerCount(revertBidder.id, 'bid_revert', pendingBid.payload.id), 1)
    assert.equal((await prisma.bid.findUniqueOrThrow({ where: { id: pendingBid.payload.id } })).status, 'reverted')

    const settledBid = await request(baseUrl, 'POST', '/api/customer/bids', revertBidder.token, {
      marketId, bidDate: dates[4], session: 'open', gameType: 'single', number: '9',
      amount: '10.00', idempotencyKey: `key_${secret(12)}`,
    }, 201)
    await request(baseUrl, 'POST', '/api/results', adminToken, {
      marketId, resultDate: dates[4], openPana: '123', closePana: '456',
    }, 201)
    const beforeRejectedRevert = await dbUser(revertBidder.id)
    await request(baseUrl, 'POST', `/api/bids/${settledBid.payload.id}/revert`, adminToken, {}, 409)
    assert.equal(money((await dbUser(revertBidder.id)).walletBalance), money(beforeRejectedRevert.walletBalance))
    assert.equal(await ledgerCount(revertBidder.id, 'bid_revert', settledBid.payload.id), 0)
    assert.equal((await prisma.bid.findUniqueOrThrow({ where: { id: settledBid.payload.id } })).status, 'lost')

    // Full-balance withdrawal reservations race safely and cannot exceed available funds.
    const withdrawing = await createCustomer('Withdrawal Race')
    await addPoints(withdrawing.id, '40.00')
    const withdrawalResults = await concurrentRequests(parallelism, () => request(baseUrl, 'POST', '/api/customer/withdrawals', withdrawing.token, {
      amount: '40.00', upiId: `pay.${secret(6)}@bank`, idempotencyKey: `key_${secret(12)}`,
    }, [201, 409]))
    assertStatuses(withdrawalResults, { 201: 1, 409: parallelism - 1 })
    const reservedWithdrawal = withdrawalResults.find((result) => result.status === 201).payload
    let withdrawingUser = await dbUser(withdrawing.id)
    assert.equal(money(withdrawingUser.walletBalance), '0.00')
    assert.equal(money(withdrawingUser.fundsReserved), '40.00')
    assert.equal(await prisma.withdrawRequest.count({ where: { userId: withdrawing.id } }), 1)
    assert.equal(await ledgerCount(withdrawing.id, 'withdrawal_reserve', reservedWithdrawal.id), 1)

    // A terminal approval transition can be claimed once and releases the reservation once.
    const approvals = await concurrentRequests(parallelism, () => request(
      baseUrl, 'POST', `/api/withdrawals/${reservedWithdrawal.id}/approve`, adminToken, {}, [200, 409],
    ))
    assertStatuses(approvals, { 200: 1, 409: parallelism - 1 })
    withdrawingUser = await dbUser(withdrawing.id)
    assert.equal(money(withdrawingUser.walletBalance), '0.00')
    assert.equal(money(withdrawingUser.fundsReserved), '0.00')
    assert.equal((await prisma.withdrawRequest.findUniqueOrThrow({ where: { id: reservedWithdrawal.id } })).status, 'approved')
    assert.equal(await ledgerCount(withdrawing.id, 'withdrawal_release', reservedWithdrawal.id), 0)

    // A terminal rejection transition can also be claimed once and refunds exactly once.
    const rejectedCustomer = await createCustomer('Withdrawal Reject')
    await addPoints(rejectedCustomer.id, '30.00')
    const rejectedWithdrawal = await request(baseUrl, 'POST', '/api/customer/withdrawals', rejectedCustomer.token, {
      amount: '20.00', upiId: `refund.${secret(6)}@bank`, idempotencyKey: `key_${secret(12)}`,
    }, 201)
    const rejections = await concurrentRequests(parallelism, () => request(
      baseUrl, 'POST', `/api/withdrawals/${rejectedWithdrawal.payload.id}/reject`, adminToken, {}, [200, 409],
    ))
    assertStatuses(rejections, { 200: 1, 409: parallelism - 1 })
    const rejectedUser = await dbUser(rejectedCustomer.id)
    assert.equal(money(rejectedUser.walletBalance), '30.00')
    assert.equal(money(rejectedUser.fundsReserved), '0.00')
    assert.equal((await prisma.withdrawRequest.findUniqueOrThrow({ where: { id: rejectedWithdrawal.payload.id } })).status, 'rejected')
    assert.equal(await ledgerCount(rejectedCustomer.id, 'withdrawal_release', rejectedWithdrawal.payload.id), 1)
  } finally {
    await prisma.$disconnect()
    backend.kill('SIGTERM')
    await new Promise((resolve) => { backend.once('exit', resolve); setTimeout(resolve, 2000) })
    if (backend.exitCode && backend.exitCode !== 0 && backend.signalCode !== 'SIGTERM') process.stderr.write(output)
  }
})
