ALTER TABLE "User"
ADD COLUMN "username" TEXT,
ADD COLUMN "passwordHash" TEXT,
ADD COLUMN "fundsReserved" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lockedUntil" TIMESTAMP(3);

ALTER TABLE "Bid"
ADD COLUMN "payoutMultiplier" DECIMAL(12,2),
ADD COLUMN "idempotencyKey" TEXT;

UPDATE "Bid" AS b
SET "payoutMultiplier" = CASE b."gameType"
  WHEN 'single' THEN r."single"
  WHEN 'jodi' THEN r."jodi"
  WHEN 'single_pana' THEN r."singlePana"
  WHEN 'double_pana' THEN r."doublePana"
  WHEN 'triple_pana' THEN r."triplePana"
  WHEN 'sp' THEN r."sp"
  WHEN 'dp' THEN r."dp"
  WHEN 'tp' THEN r."tp"
  WHEN 'fp' THEN r."fp"
  WHEN 'cp' THEN r."cp"
  WHEN 'half_sangam' THEN r."halfSangam"
  WHEN 'full_sangam' THEN r."fullSangam"
  ELSE 0
END
FROM (
  SELECT "single", "jodi", "singlePana", "doublePana", "triplePana", "sp", "dp", "tp", "fp", "cp", "halfSangam", "fullSangam"
  FROM "GameRate" WHERE "id" = (SELECT MIN("id") FROM "GameRate")
  UNION ALL
  SELECT 10, 100, 160, 320, 1000, 150, 300, 1000, 150, 150, 1200, 12000
  WHERE NOT EXISTS (SELECT 1 FROM "GameRate")
) AS r;

UPDATE "Bid" SET "payoutMultiplier" = 0 WHERE "payoutMultiplier" IS NULL;
ALTER TABLE "Bid" ALTER COLUMN "payoutMultiplier" SET NOT NULL;

ALTER TABLE "DepositRequest" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "WithdrawRequest"
ADD COLUMN "idempotencyKey" TEXT,
ADD COLUMN "fundsReserved" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE UNIQUE INDEX "Bid_userId_idempotencyKey_key" ON "Bid"("userId", "idempotencyKey");
CREATE UNIQUE INDEX "DepositRequest_userId_idempotencyKey_key" ON "DepositRequest"("userId", "idempotencyKey");
CREATE UNIQUE INDEX "WithdrawRequest_userId_idempotencyKey_key" ON "WithdrawRequest"("userId", "idempotencyKey");

ALTER TABLE "User" ADD CONSTRAINT "User_nonnegative_reserved_check"
CHECK ("fundsReserved" >= 0);
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_positive_amount_check" CHECK ("amount" > 0) NOT VALID;
ALTER TABLE "DepositRequest" ADD CONSTRAINT "DepositRequest_positive_amount_check" CHECK ("amount" > 0) NOT VALID;
ALTER TABLE "WithdrawRequest" ADD CONSTRAINT "WithdrawRequest_positive_amount_check" CHECK ("amount" > 0) NOT VALID;
