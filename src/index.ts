import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import path from 'path'
import { requireAuth } from './middleware/auth'

import authRoutes from './routes/auth'
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

// CORS configuration - allow all origins
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS')
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200)
  }
  next()
})
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

app.use('/uploads', express.static(path.join(__dirname, '..', process.env.UPLOAD_DIR || 'uploads')))

app.use('/api/auth', authRoutes)

app.use('/api/users', requireAuth, userRoutes)
app.use('/api/markets', requireAuth, marketRoutes)
app.use('/api/game-rates', requireAuth, gameRateRoutes)
app.use('/api/results', requireAuth, resultRoutes)
app.use('/api/bids', requireAuth, bidRoutes)
app.use('/api/wallet', requireAuth, walletRoutes)
app.use('/api/deposits', requireAuth, depositRoutes)
app.use('/api/withdrawals', requireAuth, withdrawalRoutes)
app.use('/api/reports', requireAuth, reportRoutes)
app.use('/api/notifications', requireAuth, notificationRoutes)
app.use('/api/slider', requireAuth, sliderRoutes)
app.use('/api/settings', requireAuth, settingRoutes)
app.use('/api/contents', requireAuth, contentRoutes)
app.use('/api/payments', requireAuth, paymentRoutes)
app.use('/api/timings', requireAuth, timingRoutes)

app.get('/api/health', (_req, res) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.json({ status: 'ok', cors: 'enabled' })
})

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err)
  res.status(500).json({ error: 'Internal server error' })
})

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
  console.log(`Environment: ${process.env.NODE_ENV}`)
  console.log(`Database: ${process.env.DATABASE_URL ? 'configured' : 'NOT configured'}`)
})

export default app
