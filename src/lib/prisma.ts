import { AccessRole, PrismaClient } from '@prisma/client'
import { execSync } from 'child_process'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient({
  log: ['error', 'warn'],
})

export async function initializeDatabase(): Promise<void> {
  await prisma.$connect()
  console.log('Database connected')

  // Run migrations
  execSync('npx prisma migrate deploy', { stdio: 'inherit' })
  console.log('Migrations completed')

  // Seed admin user if doesn't exist
  const adminExists = await prisma.admin.findFirst({ where: { role: AccessRole.ADMIN } })
  if (!adminExists) {
    const username = process.env.INITIAL_ADMIN_USERNAME
    const password = process.env.INITIAL_ADMIN_PASSWORD
    if (!username || !password || password.length < 12) {
      throw new Error('Set INITIAL_ADMIN_USERNAME and an INITIAL_ADMIN_PASSWORD of at least 12 characters')
    }
    const passwordHash = await bcrypt.hash(password, 12)
    await prisma.admin.create({
      data: { username, passwordHash, walletBalance: 0, role: AccessRole.ADMIN },
    })
    console.log('Initial admin account created')
  }

  const users = await prisma.user.findMany({ select: { id: true, mpinHash: true } })
  const legacyUsers = users.filter((user) => !user.mpinHash.startsWith('$2'))
  for (const user of legacyUsers) {
    await prisma.user.update({
      where: { id: user.id },
      data: { mpinHash: await bcrypt.hash(user.mpinHash, 12) },
    })
  }
  if (legacyUsers.length) console.log(`Secured ${legacyUsers.length} customer MPIN(s)`)
}

export default prisma
