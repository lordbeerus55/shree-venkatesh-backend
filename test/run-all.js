const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')

const raw = process.env.TEST_DATABASE_URL
assert.ok(raw, 'TEST_DATABASE_URL is required')
const base = new URL(raw)
assert.ok(['postgres:', 'postgresql:'].includes(base.protocol), 'TEST_DATABASE_URL must use PostgreSQL')
assert.ok(['localhost', '127.0.0.1', '::1'].includes(base.hostname), 'TEST_DATABASE_URL must use a loopback host')
assert.ok(base.pathname.toLowerCase().includes('_test'), 'TEST_DATABASE_URL database name must contain _test')

const integrationFiles = [
  'test/customer-game-api.test.js',
  'test/concurrency-wallet.test.js',
  'test/admin-api-regression.test.js',
  'test/migration-upgrade.test.js',
]

for (const [index, file] of integrationFiles.entries()) {
  const database = new URL(base)
  database.searchParams.set('schema', `suite_${process.pid}_${index}_${crypto.randomBytes(4).toString('hex')}`)
  const result = spawnSync(process.execPath, ['--test', file], {
    cwd: process.cwd(),
    env: { ...process.env, TEST_DATABASE_URL: database.toString() },
    stdio: 'inherit',
  })
  if (result.status !== 0) process.exit(result.status || 1)
}

const unit = spawnSync(process.execPath, ['--test', 'test/win-calculation.test.js'], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
})
process.exit(unit.status || 0)
