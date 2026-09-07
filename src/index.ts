import 'dotenv/config'
import express from 'express'
import path from 'path'
import { requireAdmin, requireAuth, requireWriteAccess } from './middleware/auth'
import { initializeDatabase } from './lib/prisma'

import authRoutes from './routes/auth'
import accountRoutes from './routes/accounts'
import userRoutes from './routes/users'
import marketRoutes from './routes/markets'
import gameRateRoutes from './routes/gameRates'
import resultRoutes from './routes/results'
import bidRoutes from './routes/bids'
import walletRoutes from './routes/wallet'
import depositRoutes from './routes/deposits'
import withdrawalRoutes from './routes/withdrawals'
import reportRoutes from './routes/reports'
import notificationRoutes from './routes/notifications'
import sliderRoutes from './routes/slider'
import settingRoutes from './routes/settings'
import contentRoutes from './routes/contents'
import paymentRoutes from './routes/payments'
import timingRoutes from './routes/timings'

const app = express()
const PORT = process.env.PORT || 5000

app.set('trust proxy', 1)

// Simple CORS middleware - must be first
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Max-Age', '86400')
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(204)
    return
  }
  
  next()
})

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

const uploadDir = path.resolve(
  process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads')
)

app.use('/uploads', express.static(uploadDir))

// Add CORS to auth routes
app.use('/api/auth', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') {
    res.sendStatus(204)
    return
  }
  next()
}, authRoutes)

app.use('/api/accounts', requireAuth, requireAdmin, accountRoutes)
app.use('/api/users', requireAuth, requireWriteAccess, userRoutes)
app.use('/api/markets', requireAuth, requireWriteAccess, marketRoutes)
app.use('/api/game-rates', requireAuth, requireWriteAccess, gameRateRoutes)
app.use('/api/results', requireAuth, requireWriteAccess, resultRoutes)
app.use('/api/bids', requireAuth, requireWriteAccess, bidRoutes)
app.use('/api/wallet', requireAuth, requireWriteAccess, walletRoutes)
app.use('/api/deposits', requireAuth, requireWriteAccess, depositRoutes)
app.use('/api/withdrawals', requireAuth, requireWriteAccess, withdrawalRoutes)
app.use('/api/reports', requireAuth, requireWriteAccess, reportRoutes)
app.use('/api/notifications', requireAuth, requireWriteAccess, notificationRoutes)
app.use('/api/slider', requireAuth, requireWriteAccess, sliderRoutes)
app.use('/api/settings', requireAuth, requireWriteAccess, settingRoutes)
app.use('/api/contents', requireAuth, requireWriteAccess, contentRoutes)
app.use('/api/payments', requireAuth, requireWriteAccess, paymentRoutes)
app.use('/api/timings', requireAuth, requireWriteAccess, timingRoutes)

app.get('/api/health', (_req, res) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.json({ status: 'ok', cors: 'enabled' })
})

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Error:', err.message)
  console.error(err.stack)
  res.status(500).json({ error: err.message || 'Internal server error' })
})

initializeDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`)
      console.log(`Environment: ${process.env.NODE_ENV}`)
      console.log(`Database: ${process.env.DATABASE_URL ? 'configured' : 'NOT configured'}`)
    })
  })
  .catch((error) => {
    console.error('Database initialization failed:', error)
    process.exit(1)
  })

export default app
