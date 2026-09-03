import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

const markets = [
  { name: 'Kalyan', type: 'main', schedules: { open: '03:55 PM', close: '05:55 PM', offDays: ['Sunday'] } },
  { name: 'Kalyan Night', type: 'main', schedules: { open: '09:25 PM', close: '11:25 PM', offDays: ['Saturday', 'Sunday'] } },
  { name: 'Madhur Day', type: 'main', schedules: { open: '01:25 PM', close: '02:25 PM', offDays: [] } },
  { name: 'Madhur Night', type: 'main', schedules: { open: '08:25 PM', close: '10:25 PM', offDays: ['Sunday'] } },
  { name: 'Milan Day', type: 'main', schedules: { open: '03:00 PM', close: '05:00 PM', offDays: ['Sunday'] } },
  { name: 'Milan Night', type: 'main', schedules: { open: '09:00 PM', close: '11:00 PM', offDays: ['Sunday'] } },
  { name: 'Rajdhani Day', type: 'main', schedules: { open: '03:30 PM', close: '05:30 PM', offDays: ['Sunday'] } },
  { name: 'Rajdhani Night', type: 'main', schedules: { open: '09:30 PM', close: '11:30 PM', offDays: ['Sunday'] } },
  { name: 'Main Bazar', type: 'main', schedules: { open: '09:50 PM', close: '11:55 PM', offDays: ['Saturday', 'Sunday'] } },
  { name: 'MAHARANI', type: 'main', schedules: { open: '12:05 PM', close: '02:05 PM', offDays: [] } },
  { name: 'MAHARANI DAY', type: 'main', schedules: { open: '05:05 PM', close: '07:05 PM', offDays: [] } },
  { name: 'MAHARANI NIGHT', type: 'main', schedules: { open: '10:05 PM', close: '11:50 PM', offDays: [] } },
  { name: 'Sridevi', type: 'main', schedules: { open: '11:30 AM', close: '12:30 PM', offDays: [] } },
  { name: 'Sridevi Night', type: 'main', schedules: { open: '07:30 PM', close: '08:30 PM', offDays: [] } },
  { name: 'Raja Rani Morning', type: 'main', schedules: { open: '09:15 AM', close: '10:15 AM', offDays: [] } },
  { name: 'Raja Rani Day', type: 'main', schedules: { open: '02:00 PM', close: '03:00 PM', offDays: [] } },
  { name: 'Raja Rani Night', type: 'main', schedules: { open: '08:00 PM', close: '09:30 PM', offDays: [] } },
  { name: 'Star Morning', type: 'starline', schedules: { open: '09:00 AM', close: '10:00 AM', offDays: [] } },
  { name: 'Star Day', type: 'starline', schedules: { open: '01:00 PM', close: '02:00 PM', offDays: [] } },
  { name: 'Star Night', type: 'starline', schedules: { open: '07:00 PM', close: '08:00 PM', offDays: [] } },
]

async function main() {
  console.log('Seeding database...')

  // Admin
  const passwordHash = await bcrypt.hash('admin@123', 10)
  await prisma.admin.upsert({
    where: { username: 'admin' },
    update: {},
    create: { username: 'admin', passwordHash, walletBalance: 2632392.0 },
  })
  console.log('✓ Admin created (username: admin, password: admin@123)')

  // Game rates
  await prisma.gameRate.upsert({
    where: { id: 1 },
    update: {},
    create: {
      single: 10, jodi: 100, singlePana: 160, doublePana: 320, triplePana: 1000,
      sp: 150, dp: 300, tp: 1000, fp: 150, cp: 150, halfSangam: 1200, fullSangam: 12000,
    },
  })
  console.log('✓ Game rates seeded')

  // Markets + schedules
  for (const m of markets) {
    const market = await prisma.market.create({
      data: { name: m.name, type: m.type },
    })
    for (const day of DAYS) {
      await prisma.marketSchedule.create({
        data: {
          marketId: market.id,
          dayOfWeek: day,
          openTime: m.schedules.open,
          closeTime: m.schedules.close,
          isActive: !m.schedules.offDays.includes(day),
        },
      })
    }
  }
  console.log(`✓ ${markets.length} markets seeded`)

  // Sample users
  const users = [
    { mobile: '9664963428', name: 'vishal', mpin: '1234', walletBalance: 300 },
    { mobile: '7869688234', name: 'sanjay Kumar sahu', mpin: '5678', walletBalance: 1500 },
    { mobile: '7995174358', name: 'ailmbas', mpin: '4321', walletBalance: 800 },
    { mobile: '1234567890', name: 'GANESH', mpin: '9850', walletBalance: 5665 },
    { mobile: '6262565620', name: 'Ajit Singh', mpin: '5555', walletBalance: 0 },
  ]
  for (const u of users) {
    await prisma.user.upsert({
      where: { mobile: u.mobile },
      update: {},
      create: u,
    })
  }
  console.log(`✓ ${users.length} sample users seeded`)

  // Default contents
  const contents = [
    { key: 'videos', body: '<p>Video content here</p>' },
    { key: 'withdraw_rules', body: '<p>Withdraw rules here</p>' },
    { key: 'game_rules', body: '<p>Game rules here</p>' },
  ]
  for (const c of contents) {
    await prisma.content.upsert({ where: { key: c.key }, update: {}, create: c })
  }

  // Default settings
  const settings = [
    { key: 'app_name', value: 'Shree Venkatesh' },
    { key: 'app_mobile', value: '9999999999' },
    { key: 'min_deposit', value: '100' },
    { key: 'max_deposit', value: '50000' },
    { key: 'min_withdraw', value: '200' },
    { key: 'max_withdraw', value: '50000' },
    { key: 'maintenance_mode', value: 'false' },
  ]
  for (const s of settings) {
    await prisma.setting.upsert({ where: { key: s.key }, update: {}, create: s })
  }

  // Default timings
  await prisma.timing.upsert({
    where: { type: 'deposit' },
    update: {},
    create: { type: 'deposit', openTime: '09:00 AM', closeTime: '11:00 PM' },
  })
  await prisma.timing.upsert({
    where: { type: 'withdraw' },
    update: {},
    create: { type: 'withdraw', openTime: '10:00 AM', closeTime: '08:00 PM' },
  })

  console.log('✓ Default settings, contents and timings seeded')
  console.log('\nSeeding complete!')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
