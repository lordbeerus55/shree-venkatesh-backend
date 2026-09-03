# Shree Venkatesh — Backend Server

Node.js + Express + TypeScript + Prisma + PostgreSQL

## Setup

### 1. Install dependencies
```bash
cd server
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env with your PostgreSQL connection string and JWT secret
```

### 3. Run database migrations & generate Prisma client
```bash
npm run db:migrate
```

### 4. Seed initial data (admin user, markets, game rates, etc.)
```bash
npm run db:seed
```

### 5. Start the dev server
```bash
npm run dev
```

Server runs on **http://localhost:5000**

---

## Default Admin Credentials
- **Username**: `admin`
- **Password**: `admin@123`

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Admin login → JWT |
| GET | `/api/auth/me` | Current admin info |
| POST | `/api/auth/change-password` | Change password |
| GET | `/api/users` | List users |
| POST | `/api/users` | Create user |
| GET | `/api/users/:id` | User detail |
| PUT | `/api/users/:id` | Update user |
| DELETE | `/api/users/:id` | Delete user |
| PATCH | `/api/users/:id/ban` | Toggle ban |
| POST | `/api/users/:id/add-points` | Add wallet points |
| POST | `/api/users/:id/withdraw-points` | Withdraw wallet points |
| GET | `/api/markets` | List markets with schedules |
| POST | `/api/markets` | Create market |
| PUT | `/api/markets/:id` | Update market |
| DELETE | `/api/markets/:id` | Delete market |
| PUT | `/api/markets/:id/schedules/:scheduleId` | Update schedule |
| GET | `/api/game-rates` | Get game rates |
| PUT | `/api/game-rates` | Update game rates |
| GET | `/api/results` | List results |
| POST | `/api/results` | Declare result (auto-calculates winners) |
| PUT | `/api/results/:id` | Update result |
| GET | `/api/bids` | List bids (filterable) |
| POST | `/api/bids/:id/revert` | Revert bid + refund |
| GET | `/api/wallet` | List wallet transactions |
| GET | `/api/wallet/user/:userId` | User's wallet history |
| GET | `/api/deposits` | List deposit requests |
| POST | `/api/deposits/:id/approve` | Approve deposit |
| POST | `/api/deposits/:id/reject` | Reject deposit |
| GET | `/api/withdrawals` | List withdrawal requests |
| POST | `/api/withdrawals/:id/approve` | Approve withdrawal |
| POST | `/api/withdrawals/:id/reject` | Reject withdrawal |
| GET | `/api/reports/dashboard?date=YYYY-MM-DD` | Dashboard stats |
| GET | `/api/reports/market-transactions?date=` | Market P&L |
| GET | `/api/reports/sell-report?date=` | Sell report by game type |
| GET | `/api/notifications` | List notifications |
| POST | `/api/notifications` | Create notification |
| PUT | `/api/notifications/:id` | Update notification |
| DELETE | `/api/notifications/:id` | Delete notification |
| GET | `/api/slider` | List slider images |
| POST | `/api/slider` | Upload slider image |
| DELETE | `/api/slider/:id` | Delete slider image |
| GET | `/api/settings` | Get all settings |
| PUT | `/api/settings` | Bulk update settings |
| GET | `/api/contents` | Get all content |
| PUT | `/api/contents/:key` | Update content (videos/withdraw_rules/game_rules) |
| GET | `/api/payments` | List payment methods |
| POST | `/api/payments` | Add payment method |
| PUT | `/api/payments/:id` | Update payment method |
| DELETE | `/api/payments/:id` | Delete payment method |
| GET | `/api/timings` | Get deposit/withdraw timings |
| PUT | `/api/timings/:type` | Update timing (deposit/withdraw) |
| GET | `/api/health` | Health check |

All routes except `/api/auth/login` require `Authorization: Bearer <token>` header.
