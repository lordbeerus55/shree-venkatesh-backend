import { PrismaClient } from '@prisma/client'
import { execSync } from 'child_process'

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
    
  } catch (err) {
    console.error('✗ Database initialization failed:', (err as Error).message)
    process.exit(1)
  }
}

initializeDatabase()

export default prisma
