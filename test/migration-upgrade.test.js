const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const { spawnSync } = require('node:child_process')
const { test } = require('node:test')

function runPsql(databaseUrl, sql, expected = 0) {
  const result = spawnSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-At'], {
    input: sql,
    encoding: 'utf8',
  })
  assert.equal(result.status, expected, `${result.stdout}\n${result.stderr}`)
  return result.stdout.trim()
}

test('customer migration upgrades populated prior schema without rejecting historical balances', () => {
  const raw = process.env.TEST_DATABASE_URL
  assert.ok(raw, 'TEST_DATABASE_URL is required')
  const url = new URL(raw)
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(url.hostname))
  assert.ok(url.pathname.toLowerCase().includes('_test'))
  const schema = url.searchParams.get('schema') || `upgrade_${process.pid}_${crypto.randomBytes(4).toString('hex')}`
  assert.match(schema, /^[a-zA-Z0-9_]+$/)
  const prismaUrl = new URL(url)
  prismaUrl.searchParams.set('schema', schema)
  url.search = ''

  const initial = fs.readFileSync('prisma/migrations/20260810065743_init/migration.sql', 'utf8')
  const roles = fs.readFileSync('prisma/migrations/20260907000000_add_dashboard_roles/migration.sql', 'utf8')
  const customer = fs.readFileSync('prisma/migrations/20260908000000_customer_game_api/migration.sql', 'utf8')
  const prefix = `CREATE SCHEMA IF NOT EXISTS "${schema}"; SET search_path TO "${schema}";`
  runPsql(url.toString(), `${prefix}\n${initial}\n${roles}`)

  const mobile = `9${crypto.randomInt(100000000, 999999999)}`
  const mpin = crypto.randomBytes(12).toString('hex')
  runPsql(url.toString(), `${prefix}\nINSERT INTO "User" (mobile,name,"mpinHash","walletBalance","updatedAt") VALUES ('${mobile}','Legacy Customer','${mpin}',-1,CURRENT_TIMESTAMP);`)
  runPsql(url.toString(), `${prefix}\n${customer}`)
  const state = runPsql(url.toString(), `${prefix}\nSELECT COUNT(*), MIN("walletBalance"), COUNT(username) FROM "User";`)
  assert.equal(state.split('\n').at(-1), '1|-1.00|0')

  const secure = spawnSync(process.execPath, ['-e', "const db=require('./dist/lib/prisma'); db.secureLegacyCustomerMpins().then((count)=>{if(count!==1)process.exitCode=1}).finally(()=>db.default.$disconnect())"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: prismaUrl.toString() },
    encoding: 'utf8',
  })
  assert.equal(secure.status, 0, `${secure.stdout}\n${secure.stderr}`)
  const secured = runPsql(url.toString(), `${prefix}\nSELECT LEFT("mpinHash", 2), "walletBalance" FROM "User";`)
  assert.equal(secured.split('\n').at(-1), '$2|-1.00')
})
