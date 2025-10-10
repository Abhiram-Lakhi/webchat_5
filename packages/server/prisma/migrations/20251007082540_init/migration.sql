-- CreateTable
CREATE TABLE "AgnoUserMap" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agnoUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgnoUserMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgnoSessionMap" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "agnoSessionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgnoSessionMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionLink" (
    "id" TEXT NOT NULL,
    "fromSessionId" TEXT NOT NULL,
    "toSessionId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgnoUserMap_userId_idx" ON "AgnoUserMap"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AgnoUserMap_userId_agnoUserId_key" ON "AgnoUserMap"("userId", "agnoUserId");

-- CreateIndex
CREATE INDEX "AgnoSessionMap_sessionId_idx" ON "AgnoSessionMap"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "AgnoSessionMap_sessionId_agnoSessionId_key" ON "AgnoSessionMap"("sessionId", "agnoSessionId");

-- CreateIndex
CREATE INDEX "SessionLink_fromSessionId_idx" ON "SessionLink"("fromSessionId");

-- CreateIndex
CREATE INDEX "SessionLink_toSessionId_idx" ON "SessionLink"("toSessionId");
