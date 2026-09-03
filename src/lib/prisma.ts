import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({
  log: ['error', 'warn'],
})

prisma.$connect()
  .then(() => console.log('✓ Database connected'))
  .catch((err) => {
    console.error('✗ Database connection failed:', err.message)
    process.exit(1)
  })

export default prisma
