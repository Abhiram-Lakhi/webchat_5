-- CreateTable
CREATE TABLE "agno_memories" (
    "id" BIGSERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agno_memories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agno_memories_user_id_created_at_idx" ON "agno_memories"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "agno_memories_session_id_created_at_idx" ON "agno_memories"("session_id", "created_at" DESC);
