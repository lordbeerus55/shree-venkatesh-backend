ALTER TABLE "Admin" ADD COLUMN "alertsSeenAt" TIMESTAMP(3);

CREATE TABLE "AdminAlert" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "userId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAlert_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdminAlert_createdAt_idx" ON "AdminAlert"("createdAt");

ALTER TABLE "AdminAlert" ADD CONSTRAINT "AdminAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
