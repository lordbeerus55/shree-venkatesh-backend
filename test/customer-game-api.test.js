const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { spawn, spawnSync } = require('node:child_process')
const { test } = require('node:test')

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

async function request(baseUrl, method, path, token, body, expected) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = await response.json().catch(() => null)
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(payload)}`)
  return payload
}

test('customer game API isolation and wallet invariants', { timeout: 120000 }, async () => {
  const databaseUrl = checkedTestDatabaseUrl()
  const firstDate = businessDate(1)
  const secondDate = businessDate(2)
  const adminUsername = `admin_${secret(8)}`
  const adminPassword = secret(24)
  const viewerUsername = `viewer_${secret(8)}`
  const viewerPassword = secret(24)
  const jwtSecret = secret(48)
  const env = { ...process.env, DATABASE_URL: databaseUrl, INITIAL_ADMIN_USERNAME: adminUsername, INITIAL_ADMIN_PASSWORD: adminPassword, JWT_SECRET: jwtSecret, NODE_ENV: 'test' }

  const migration = spawnSync('npx', ['prisma', 'migrate', 'deploy'], { cwd: process.cwd(), env, encoding: 'utf8' })
  assert.equal(migration.status, 0, `Migration failed:\n${migration.stdout}\n${migration.stderr}`)

  const port = 20000 + crypto.randomInt(20000)
  const baseUrl = `http://127.0.0.1:${port}`
  const backend = spawn(process.execPath, ['dist/index.js'], { cwd: process.cwd(), env: { ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  backend.stdout.on('data', (chunk) => { output += chunk })
  backend.stderr.on('data', (chunk) => { output += chunk })

  try {
    await waitForServer(baseUrl, backend)
    const adminLogin = await request(baseUrl, 'POST', '/api/auth/login', null, { username: adminUsername, password: adminPassword }, 200)
    const adminToken = adminLogin.token
    await request(baseUrl, 'POST', '/api/accounts', adminToken, { username: viewerUsername, password: viewerPassword }, 201)
    const viewerLogin = await request(baseUrl, 'POST', '/api/auth/login', null, { username: viewerUsername, password: viewerPassword }, 200)
    const viewerToken = viewerLogin.token

    const customerA = { name: 'Customer A', mobile: `8${crypto.randomInt(100000000, 999999999)}`, mpin: String(crypto.randomInt(1000, 9999)), username: `customer_a_${secret(6)}`, password: secret(18) }
    const customerB = { name: 'Customer B', mobile: `7${crypto.randomInt(100000000, 999999999)}`, mpin: String(crypto.randomInt(1000, 9999)), username: `customer_b_${secret(6)}`, password: secret(18) }
    const createdA = await request(baseUrl, 'POST', '/api/users', adminToken, customerA, 201)
    const createdB = await request(baseUrl, 'POST', '/api/users', adminToken, customerB, 201)
    const loginA = await request(baseUrl, 'POST', '/api/customer/auth/login', null, { identifier: customerA.username, credential: customerA.password }, 200)
    const loginB = await request(baseUrl, 'POST', '/api/customer/auth/login', null, { identifier: customerB.mobile, credential: customerB.mpin }, 200)
    const tokenA = loginA.token
    let tokenB = loginB.token

    await request(baseUrl, 'GET', '/api/customer/me', adminToken, undefined, 401)
    await request(baseUrl, 'GET', '/api/users', tokenA, undefined, 401)
    await request(baseUrl, 'GET', '/api/markets', viewerToken, undefined, 200)
    await request(baseUrl, 'POST', '/api/markets', viewerToken, { name: 'Denied' }, 403)

    const market = await request(baseUrl, 'POST', '/api/markets', adminToken, { name: 'Integration Market', schedules: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((dayOfWeek) => ({ dayOfWeek, openTime: '23:58', closeTime: '23:59' })) }, 201)
    await request(baseUrl, 'PUT', '/api/game-rates', adminToken, { single: 10, jodi: 100, singlePana: 160, doublePana: 320, triplePana: 1000, sp: 150, dp: 300, tp: 1000, fp: 150, cp: 150, halfSangam: 1200, fullSangam: 12000 }, 200)
    await request(baseUrl, 'POST', `/api/users/${createdA.id}/add-points`, adminToken, { amount: '100.00' }, 200)
    await request(baseUrl, 'POST', `/api/users/${createdB.id}/add-points`, adminToken, { amount: '100.00' }, 200)

    const winningBid = { marketId: market.id, bidDate: firstDate, session: 'open', gameType: 'single', number: '6', amount: '10.00', idempotencyKey: `key_${secret(12)}` }
    const firstBid = await request(baseUrl, 'POST', '/api/customer/bids', tokenA, winningBid, 201)
    const duplicateBid = await request(baseUrl, 'POST', '/api/customer/bids', tokenA, winningBid, 200)
    assert.equal(duplicateBid.id, firstBid.id)
    await request(baseUrl, 'POST', '/api/customer/bids', tokenA, { ...winningBid, amount: '11.00' }, 409)
    await request(baseUrl, 'POST', '/api/customer/bids', tokenA, { ...winningBid, amount: '1000.00', idempotencyKey: `key_${secret(12)}` }, 409)
    const walletAfterBid = await request(baseUrl, 'GET', '/api/customer/wallet', tokenA, undefined, 200)
    assert.equal(walletAfterBid.walletBalance, '90')
    const ownBidsA = await request(baseUrl, 'GET', '/api/customer/bids', tokenA, undefined, 200)
    const ownBidsB = await request(baseUrl, 'GET', '/api/customer/bids', tokenB, undefined, 200)
    assert.equal(ownBidsA.total, 1)
    assert.equal(ownBidsB.total, 0)
    await request(baseUrl, 'GET', `/api/customer/bids?userId=${createdB.id}`, tokenA, undefined, 400)
    const unavailableMarket = await request(baseUrl, 'POST', '/api/markets', adminToken, { name: 'No Schedule Market' }, 201)
    await request(baseUrl, 'POST', '/api/customer/bids', tokenB, {
      marketId: unavailableMarket.id,
      bidDate: firstDate,
      session: 'open',
      gameType: 'single',
      number: '6',
      amount: '10.00',
      idempotencyKey: `key_${secret(12)}`,
    }, 409)
    await request(baseUrl, 'PATCH', `/api/users/${createdB.id}/ban`, adminToken, {}, 200)
    await request(baseUrl, 'GET', '/api/customer/me', tokenB, undefined, 401)
    await request(baseUrl, 'PATCH', `/api/users/${createdB.id}/ban`, adminToken, {}, 200)
    const reloginB = await request(baseUrl, 'POST', '/api/customer/auth/login', null, { identifier: customerB.mobile, credential: customerB.mpin }, 200)
    assert.ok(reloginB.token)
    tokenB = reloginB.token
    const boundaryBid = await request(baseUrl, 'POST', '/api/customer/bids', tokenB, {
      marketId: market.id,
      bidDate: businessDate(7),
      session: 'open',
      gameType: 'single',
      number: '1',
      amount: '1.00',
      idempotencyKey: `key_${secret(12)}`,
    }, 201)
    await request(baseUrl, 'POST', `/api/bids/${boundaryBid.id}/revert`, adminToken, {}, 200)
    await request(baseUrl, 'POST', '/api/customer/bids', tokenB, {
      marketId: market.id,
      bidDate: businessDate(8),
      session: 'open',
      gameType: 'single',
      number: '1',
      amount: '1.00',
      idempotencyKey: `key_${secret(12)}`,
    }, 409)

    await request(baseUrl, 'POST', '/api/results', viewerToken, { marketId: market.id, resultDate: firstDate, openPana: '123' }, 403)
    await request(baseUrl, 'POST', '/api/results', adminToken, { marketId: market.id, resultDate: firstDate, openPana: '123' }, 201)
    const wonWallet = await request(baseUrl, 'GET', '/api/customer/wallet', tokenA, undefined, 200)
    assert.equal(wonWallet.walletBalance, '190')
    for (const [gameType, number] of [['jodi', '65'], ['half_sangam', '6-456'], ['full_sangam', '123-456']]) {
      await request(baseUrl, 'POST', '/api/customer/bids', tokenB, {
        marketId: market.id,
        bidDate: firstDate,
        session: 'close',
        gameType,
        number,
        amount: '1.00',
        idempotencyKey: `key_${secret(12)}`,
      }, 409)
    }
    const partialResults = await request(baseUrl, 'GET', `/api/customer/results?startDate=${firstDate}&endDate=${firstDate}`, tokenA, undefined, 200)
    assert.equal(partialResults.results[0].openPana, '123')
    assert.equal(partialResults.results[0].closePana, null)
    await request(baseUrl, 'POST', '/api/results', adminToken, { marketId: market.id, resultDate: firstDate, closePana: '456' }, 200)
    await request(baseUrl, 'POST', '/api/results', adminToken, { marketId: market.id, resultDate: firstDate, openPana: '123', closePana: '456' }, 200)
    await request(baseUrl, 'POST', '/api/results', adminToken, { marketId: market.id, resultDate: firstDate, openPana: '124', closePana: '456' }, 409)
    const idempotentWinWallet = await request(baseUrl, 'GET', '/api/customer/wallet', tokenA, undefined, 200)
    assert.equal(idempotentWinWallet.walletBalance, '190')

    await request(baseUrl, 'POST', '/api/customer/bids', tokenA, { marketId: market.id, bidDate: secondDate, session: 'close', gameType: 'single', number: '9', amount: '10.00', idempotencyKey: `key_${secret(12)}` }, 201)
    await request(baseUrl, 'POST', '/api/results', adminToken, { marketId: market.id, resultDate: secondDate, openPana: '123', closePana: '456' }, 201)
    const lostWallet = await request(baseUrl, 'GET', '/api/customer/wallet', tokenA, undefined, 200)
    assert.equal(lostWallet.walletBalance, '180')

    const deposit = await request(baseUrl, 'POST', '/api/customer/deposits', tokenA, { amount: '20.00', paymentMethod: 'upi', transactionRef: secret(10), idempotencyKey: `key_${secret(12)}` }, 201)
    assert.equal((await request(baseUrl, 'GET', '/api/customer/deposits', tokenB, undefined, 200)).total, 0)
    await request(baseUrl, 'POST', `/api/deposits/${deposit.id}/approve`, adminToken, {}, 200)
    assert.equal((await request(baseUrl, 'GET', '/api/customer/wallet', tokenA, undefined, 200)).walletBalance, '200')

    const withdrawal = await request(baseUrl, 'POST', '/api/customer/withdrawals', tokenA, { amount: '30.00', upiId: `pay.${secret(5)}@bank`, idempotencyKey: `key_${secret(12)}` }, 201)
    assert.equal((await request(baseUrl, 'GET', '/api/customer/withdrawals', tokenB, undefined, 200)).total, 0)
    let reservedWallet = await request(baseUrl, 'GET', '/api/customer/wallet', tokenA, undefined, 200)
    assert.equal(reservedWallet.walletBalance, '170')
    assert.equal(reservedWallet.fundsReserved, '30')
    await request(baseUrl, 'POST', `/api/withdrawals/${withdrawal.id}/reject`, adminToken, {}, 200)
    reservedWallet = await request(baseUrl, 'GET', '/api/customer/wallet', tokenA, undefined, 200)
    assert.equal(reservedWallet.walletBalance, '200')
    assert.equal(reservedWallet.fundsReserved, '0')

    const approvedWithdrawal = await request(baseUrl, 'POST', '/api/customer/withdrawals', tokenA, { amount: '40.00', upiId: `pay.${secret(5)}@bank`, idempotencyKey: `key_${secret(12)}` }, 201)
    await request(baseUrl, 'POST', `/api/withdrawals/${approvedWithdrawal.id}/approve`, adminToken, {}, 200)
    const finalWallet = await request(baseUrl, 'GET', '/api/customer/wallet', tokenA, undefined, 200)
    assert.equal(finalWallet.walletBalance, '160')
    assert.equal(finalWallet.fundsReserved, '0')
    assert.ok(finalWallet.transactions.every((entry) => entry.userId === createdA.id))
  } finally {
    backend.kill('SIGTERM')
    await new Promise((resolve) => { backend.once('exit', resolve); setTimeout(resolve, 2000) })
    if (backend.exitCode && backend.exitCode !== 0 && backend.signalCode !== 'SIGTERM') process.stderr.write(output)
  }
})
