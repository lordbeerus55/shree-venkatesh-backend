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
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const contentType = response.headers.get('content-type') || ''
  const text = await response.text()
  let payload = null
  try { payload = text ? JSON.parse(text) : null } catch { payload = text }
  assert.equal(response.status, expected, `${method} ${path}: ${text}`)
  return { payload, contentType }
}

function assertError(result) {
  assert.equal(typeof result.payload, 'object')
  assert.equal(typeof result.payload.error, 'string')
}

test('administrative API regression coverage', { timeout: 120000 }, async () => {
  const databaseUrl = checkedTestDatabaseUrl()
  const suffix = secret(7).toLowerCase()
  const adminUsername = `admin_${suffix}`
  const adminPassword = secret(24)
  const viewerUsername = `viewer_${suffix}`
  const viewerPassword = secret(24)
  const resetViewerPassword = secret(24)
  const jwtSecret = secret(48)
  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    INITIAL_ADMIN_USERNAME: adminUsername,
    INITIAL_ADMIN_PASSWORD: adminPassword,
    JWT_SECRET: jwtSecret,
    NODE_ENV: 'test',
  }

  const migration = spawnSync('npx', ['prisma', 'migrate', 'deploy'], { cwd: process.cwd(), env, encoding: 'utf8' })
  assert.equal(migration.status, 0, `Migration failed:\n${migration.stdout}\n${migration.stderr}`)

  const provisionScript = `
    const { PrismaClient, AccessRole } = require('@prisma/client');
    const bcrypt = require('bcrypt');
    const prisma = new PrismaClient();
    (async () => {
      const passwordHash = await bcrypt.hash(process.env.INITIAL_ADMIN_PASSWORD, 12);
      await prisma.admin.upsert({
        where: { username: process.env.INITIAL_ADMIN_USERNAME },
        update: { passwordHash, role: AccessRole.ADMIN, tokenVersion: { increment: 1 }, failedLoginCount: 0, lockedUntil: null },
        create: { username: process.env.INITIAL_ADMIN_USERNAME, passwordHash, role: AccessRole.ADMIN }
      });
    })().finally(() => prisma.$disconnect());
  `
  const provision = spawnSync(process.execPath, ['-e', provisionScript], { cwd: process.cwd(), env, encoding: 'utf8' })
  assert.equal(provision.status, 0, `Admin provisioning failed:\n${provision.stdout}\n${provision.stderr}`)

  const port = 20000 + crypto.randomInt(20000)
  const baseUrl = `http://127.0.0.1:${port}`
  const backend = spawn(process.execPath, ['dist/index.js'], {
    cwd: process.cwd(),
    env: { ...env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  backend.stdout.on('data', (chunk) => { output += chunk })
  backend.stderr.on('data', (chunk) => { output += chunk })

  const regressions = []
  async function recordExpected(method, path, token, body, expected, verify) {
    try {
      const result = await request(baseUrl, method, path, token, body, expected)
      if (verify) verify(result)
      return result
    } catch (error) {
      regressions.push(error)
      return null
    }
  }

  try {
    await waitForServer(baseUrl, backend)

    assertError(await request(baseUrl, 'GET', '/api/users', null, undefined, 401))
    assertError(await request(baseUrl, 'GET', '/api/users', 'not-a-jwt', undefined, 401))
    assertError(await request(baseUrl, 'POST', '/api/auth/login', null, { username: adminUsername, password: 'incorrect-password' }, 401))

    const adminLogin = (await request(baseUrl, 'POST', '/api/auth/login', null, { username: adminUsername, password: adminPassword }, 200)).payload
    assert.equal(typeof adminLogin.token, 'string')
    assert.equal(adminLogin.admin.username, adminUsername)
    assert.equal(adminLogin.admin.role, 'ADMIN')
    const adminToken = adminLogin.token
    const me = (await request(baseUrl, 'GET', '/api/auth/me', adminToken, undefined, 200)).payload
    assert.equal(me.username, adminUsername)
    assert.equal(me.role, 'ADMIN')
    assert.equal(Object.hasOwn(me, 'passwordHash'), false)

    assertError(await request(baseUrl, 'POST', '/api/accounts', adminToken, { username: 'x', password: 'short' }, 400))
    const viewer = (await request(baseUrl, 'POST', '/api/accounts', adminToken, { username: viewerUsername, password: viewerPassword }, 201)).payload
    assert.equal(viewer.username, viewerUsername)
    assert.equal(viewer.role, 'VIEWER')
    assert.equal(Object.hasOwn(viewer, 'passwordHash'), false)
    assertError(await request(baseUrl, 'POST', '/api/accounts', adminToken, { username: viewerUsername, password: viewerPassword }, 409))
    const accounts = (await request(baseUrl, 'GET', '/api/accounts', adminToken, undefined, 200)).payload
    assert.ok(accounts.some((account) => account.id === viewer.id && account.role === 'VIEWER'))

    let viewerLogin = (await request(baseUrl, 'POST', '/api/auth/login', null, { username: viewerUsername, password: viewerPassword }, 200)).payload
    let viewerToken = viewerLogin.token
    assertError(await request(baseUrl, 'GET', '/api/accounts', viewerToken, undefined, 403))
    assert.ok(Array.isArray((await request(baseUrl, 'GET', '/api/markets', viewerToken, undefined, 200)).payload))
    assertError(await request(baseUrl, 'POST', '/api/markets', viewerToken, { name: `Denied ${suffix}` }, 403))
    assertError(await request(baseUrl, 'PUT', `/api/accounts/${viewer.id}/password`, adminToken, { password: 'short' }, 400))
    await request(baseUrl, 'PUT', `/api/accounts/${viewer.id}/password`, adminToken, { password: resetViewerPassword }, 200)
    assertError(await request(baseUrl, 'GET', '/api/markets', viewerToken, undefined, 401))
    viewerLogin = (await request(baseUrl, 'POST', '/api/auth/login', null, { username: viewerUsername, password: resetViewerPassword }, 200)).payload
    viewerToken = viewerLogin.token

    const customer = {
      name: `Regression Customer ${suffix}`,
      mobile: `8${crypto.randomInt(100000000, 999999999)}`,
      mpin: String(crypto.randomInt(1000, 9999)),
      username: `customer_${suffix}`,
      password: secret(18),
    }
    assertError(await request(baseUrl, 'POST', '/api/users', adminToken, { ...customer, mobile: '123' }, 400))
    const createdCustomer = (await request(baseUrl, 'POST', '/api/users', adminToken, customer, 201)).payload
    assert.equal(createdCustomer.username, customer.username)
    assert.equal(Object.hasOwn(createdCustomer, 'mpinHash'), false)
    assert.equal(Object.hasOwn(createdCustomer, 'passwordHash'), false)
    assertError(await request(baseUrl, 'POST', '/api/users', adminToken, customer, 409))

    const userList = (await request(baseUrl, 'GET', '/api/users?page=1&limit=10', viewerToken, undefined, 200)).payload
    assert.ok(userList.users.some((user) => user.id === createdCustomer.id))
    assert.ok(userList.total >= 1)
    const searchedUsers = (await request(baseUrl, 'GET', `/api/users?search=${encodeURIComponent(suffix)}&page=1&limit=10`, adminToken, undefined, 200)).payload
    assert.ok(searchedUsers.users.some((user) => user.id === createdCustomer.id))
    const fetchedCustomer = (await request(baseUrl, 'GET', `/api/users/${createdCustomer.id}`, viewerToken, undefined, 200)).payload
    assert.equal(fetchedCustomer.mobile, customer.mobile)
    assertError(await request(baseUrl, 'GET', '/api/users/not-an-id', adminToken, undefined, 400))

    const updatedCustomerInput = { ...customer, name: `Updated Customer ${suffix}`, password: secret(18), mpin: String(crypto.randomInt(1000, 9999)) }
    const updatedCustomer = (await request(baseUrl, 'PUT', `/api/users/${createdCustomer.id}`, adminToken, updatedCustomerInput, 200)).payload
    assert.equal(updatedCustomer.name, updatedCustomerInput.name)
    assertError(await request(baseUrl, 'PUT', `/api/users/${createdCustomer.id}`, viewerToken, updatedCustomerInput, 403))
    let bannedCustomer = (await request(baseUrl, 'PATCH', `/api/users/${createdCustomer.id}/ban`, adminToken, {}, 200)).payload
    assert.equal(bannedCustomer.isBanned, true)
    bannedCustomer = (await request(baseUrl, 'PATCH', `/api/users/${createdCustomer.id}/ban`, adminToken, {}, 200)).payload
    assert.equal(bannedCustomer.isBanned, false)

    const marketOne = (await request(baseUrl, 'POST', '/api/markets', adminToken, {
      name: `Regression Market One ${suffix}`,
      type: 'main',
      schedules: [{ dayOfWeek: 'Monday', openTime: '09:00', closeTime: '17:00' }],
    }, 201)).payload
    assert.equal(marketOne.schedules.length, 1)
    const marketTwo = (await request(baseUrl, 'POST', '/api/markets', adminToken, { name: `Regression Market Two ${suffix}`, type: 'starline' }, 201)).payload
    const fetchedMarket = (await request(baseUrl, 'GET', `/api/markets/${marketOne.id}`, viewerToken, undefined, 200)).payload
    assert.equal(fetchedMarket.name, marketOne.name)
    const updatedMarket = (await request(baseUrl, 'PUT', `/api/markets/${marketOne.id}`, adminToken, { name: `${marketOne.name} Updated`, type: 'main', isActive: false }, 200)).payload
    assert.equal(updatedMarket.isActive, false)
    const extraSchedule = (await request(baseUrl, 'POST', `/api/markets/${marketOne.id}/schedules`, adminToken, { dayOfWeek: 'Tuesday', openTime: '10:00', closeTime: '18:00' }, 201)).payload
    const updatedSchedule = (await request(baseUrl, 'PUT', `/api/markets/${marketOne.id}/schedules/${extraSchedule.id}`, adminToken, { openTime: '10:30', closeTime: '18:30', isActive: false }, 200)).payload
    assert.equal(updatedSchedule.marketId, marketOne.id)
    assert.equal(updatedSchedule.openTime, '10:30')

    const rates = { single: 11, jodi: 101, singlePana: 161, doublePana: 321, triplePana: 1001, sp: 151, dp: 301, tp: 1001, fp: 151, cp: 151, halfSangam: 1201, fullSangam: 12001 }
    assertError(await request(baseUrl, 'PUT', '/api/game-rates', adminToken, { ...rates, single: 0 }, 400))
    const updatedRates = (await request(baseUrl, 'PUT', '/api/game-rates', adminToken, rates, 200)).payload
    for (const [field, value] of Object.entries(rates)) assert.equal(updatedRates[field], value)
    const fetchedRates = (await request(baseUrl, 'GET', '/api/game-rates', viewerToken, undefined, 200)).payload
    assert.equal(fetchedRates.fullSangam, rates.fullSangam)

    assertError(await request(baseUrl, 'POST', '/api/notifications', adminToken, { title: 'Missing body' }, 400))
    const notification = (await request(baseUrl, 'POST', '/api/notifications', adminToken, { title: `Notice ${suffix}`, body: 'Initial body' }, 201)).payload
    assert.equal(notification.title, `Notice ${suffix}`)
    const notifications = (await request(baseUrl, 'GET', '/api/notifications', viewerToken, undefined, 200)).payload
    assert.ok(notifications.some((item) => item.id === notification.id))
    const updatedNotification = (await request(baseUrl, 'PUT', `/api/notifications/${notification.id}`, adminToken, { title: `Updated ${suffix}`, body: 'Updated body' }, 200)).payload
    assert.equal(updatedNotification.body, 'Updated body')
    await request(baseUrl, 'DELETE', `/api/notifications/${notification.id}`, adminToken, undefined, 200)
    assert.equal((await request(baseUrl, 'GET', '/api/notifications', adminToken, undefined, 200)).payload.some((item) => item.id === notification.id), false)

    const settingKey = `regression_${suffix}`
    await request(baseUrl, 'PUT', '/api/settings', adminToken, { [settingKey]: 'enabled' }, 200)
    const settings = (await request(baseUrl, 'GET', '/api/settings', viewerToken, undefined, 200)).payload
    assert.equal(settings[settingKey], 'enabled')

    const contentKey = `terms_${suffix}`
    const content = (await request(baseUrl, 'PUT', `/api/contents/${contentKey}`, adminToken, { body: `Terms ${suffix}` }, 200)).payload
    assert.equal(content.key, contentKey)
    assert.equal((await request(baseUrl, 'GET', '/api/contents', viewerToken, undefined, 200)).payload[contentKey], `Terms ${suffix}`)

    const timingType = `market_${suffix}`
    const timing = (await request(baseUrl, 'PUT', `/api/timings/${timingType}`, adminToken, { openTime: '08:00', closeTime: '20:00' }, 200)).payload
    assert.equal(timing.type, timingType)
    assert.ok((await request(baseUrl, 'GET', '/api/timings', viewerToken, undefined, 200)).payload.some((item) => item.type === timingType && item.closeTime === '20:00'))

    const dashboard = (await request(baseUrl, 'GET', '/api/reports/dashboard?date=2030-01-01', viewerToken, undefined, 200)).payload
    for (const field of ['adminWallet', 'totalUsers', 'bannedUsers', 'todayBetAmount', 'todayWinAmount', 'todayProfit', 'totalWalletBalance']) assert.equal(typeof dashboard[field], 'number')
    const marketTransactions = (await request(baseUrl, 'GET', '/api/reports/market-transactions?date=2030-01-01', adminToken, undefined, 200)).payload
    assert.ok(Array.isArray(marketTransactions))
    assert.ok(marketTransactions.some((row) => row.market === updatedMarket.name))
    const sellReport = (await request(baseUrl, 'GET', '/api/reports/sell-report?date=2030-01-01', adminToken, undefined, 200)).payload
    assert.equal(sellReport.length, 12)
    assert.ok(sellReport.every((row) => typeof row.count === 'number' && typeof row.totalAmount === 'number'))

    const walletPage = (await request(baseUrl, 'GET', `/api/wallet?userId=${createdCustomer.id}&page=1&limit=10`, viewerToken, undefined, 200)).payload
    assert.ok(Array.isArray(walletPage.transactions))
    assert.equal(typeof walletPage.total, 'number')
    await request(baseUrl, 'GET', '/api/deposits?page=1&limit=10', viewerToken, undefined, 200)
    await request(baseUrl, 'GET', '/api/withdrawals?page=1&limit=10', viewerToken, undefined, 200)
    await request(baseUrl, 'GET', '/api/bids?page=1&limit=10', viewerToken, undefined, 200)
    await request(baseUrl, 'GET', '/api/results?page=1&limit=10', viewerToken, undefined, 200)

    for (const path of [
      '/api/deposits?page=0', '/api/deposits?limit=101', '/api/deposits?startDate=bad-date',
      '/api/withdrawals?page=nope', '/api/withdrawals?endDate=2030-99-99',
      '/api/bids?userId=abc', '/api/bids?marketId=0', '/api/bids?date=yesterday', '/api/bids?limit=101',
      '/api/results?marketId=abc', '/api/results?date=2030-02-30', '/api/results?page=0',
    ]) assertError(await request(baseUrl, 'GET', path, adminToken, undefined, 400))
    assertError(await request(baseUrl, 'POST', '/api/deposits/not-an-id/approve', adminToken, {}, 400))
    assertError(await request(baseUrl, 'POST', '/api/deposits/0/reject', adminToken, {}, 400))
    assertError(await request(baseUrl, 'POST', '/api/withdrawals/nope/approve', adminToken, {}, 400))
    assertError(await request(baseUrl, 'POST', '/api/withdrawals/-1/reject', adminToken, {}, 400))
    assertError(await request(baseUrl, 'POST', '/api/bids/not-an-id/revert', adminToken, {}, 400))
    assertError(await request(baseUrl, 'POST', '/api/results', adminToken, { marketId: 'bad', resultDate: 'not-a-date', openPana: '12', closePana: 'xyz' }, 400))
    assertError(await request(baseUrl, 'PUT', '/api/results/not-an-id', adminToken, { openPana: '123', closePana: '456' }, 400))

    await recordExpected('GET', '/api/wallet?page=0', adminToken, undefined, 400, assertError)
    await recordExpected('GET', '/api/wallet?userId=not-an-id', adminToken, undefined, 400, assertError)
    await recordExpected('GET', '/api/wallet/user/not-an-id', adminToken, undefined, 400, assertError)

    await recordExpected('PUT', `/api/markets/${marketTwo.id}/schedules/${extraSchedule.id}`, adminToken, { openTime: '11:00', closeTime: '19:00', isActive: true }, 404, assertError)

    const unknown = await recordExpected('GET', `/api/definitely-unknown-${suffix}`, adminToken, undefined, 404, (result) => {
      assert.match(result.contentType, /^application\/json\b/)
      assertError(result)
    })
    if (unknown) assert.equal(typeof unknown.payload.error, 'string')

    await request(baseUrl, 'DELETE', `/api/markets/${marketTwo.id}`, adminToken, undefined, 200)
    await request(baseUrl, 'DELETE', `/api/markets/${marketOne.id}`, adminToken, undefined, 200)
    await request(baseUrl, 'DELETE', `/api/users/${createdCustomer.id}`, adminToken, undefined, 200)
    assertError(await request(baseUrl, 'GET', `/api/users/${createdCustomer.id}`, adminToken, undefined, 404))
    assertError(await request(baseUrl, 'DELETE', `/api/accounts/${adminLogin.admin.id}`, adminToken, undefined, 400))
    await request(baseUrl, 'DELETE', `/api/accounts/${viewer.id}`, adminToken, undefined, 200)
    assertError(await request(baseUrl, 'GET', '/api/markets', viewerToken, undefined, 401))

    assert.equal(regressions.length, 0, regressions.map((error) => error.message).join('\n'))
  } finally {
    backend.kill('SIGTERM')
    await new Promise((resolve) => { backend.once('exit', resolve); setTimeout(resolve, 2000) })
    if (backend.exitCode && backend.exitCode !== 0 && backend.signalCode !== 'SIGTERM') process.stderr.write(output)
  }
})
