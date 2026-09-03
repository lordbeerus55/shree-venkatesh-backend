import { PrismaClient } from '@prisma/client'
import { execSync } from 'child_process'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient({
  log: ['error', 'warn'],
})

async function initializeDatabase() {
  try {
    await prisma.$connect()
    console.log('✓ Database connected')
    
    // Run migrations
    console.log('Running database migrations...')
    try {
      execSync('npx prisma migrate deploy', { stdio: 'inherit' })
      console.log('✓ Migrations completed')
    } catch (err) {
      console.log('⚠ Migrations skipped or already applied')
    }
    
    // Seed admin user if doesn't exist
    console.log('Checking admin user...')
    const adminExists = await prisma.admin.findUnique({ where: { username: 'admin' } })
    if (!adminExists) {
      const passwordHash = await bcrypt.hash('admin@123', 10)
      await prisma.admin.create({
        data: { username: 'admin', passwordHash, walletBalance: 0 },
      })
      console.log('✓ Admin user created (username: admin, password: admin@123)')
    } else {
      console.log('✓ Admin user already exists')
    }
    
  } catch (err) {
    console.error('✗ Database initialization failed:', (err as Error).message)
    process.exit(1)
  }
}

initializeDatabase()

export default prisma
