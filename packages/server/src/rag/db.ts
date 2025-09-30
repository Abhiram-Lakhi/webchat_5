import { PrismaClient } from '@prisma/client';

const DIMS = 1536; // text-embedding-3-small

export async function ensureRagSchema(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS vector;`);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "RagPage" (
      id BIGSERIAL PRIMARY KEY,
      domain   TEXT NOT NULL,
      url      TEXT NOT NULL,
      content  TEXT NOT NULL,
      embedding VECTOR(${DIMS}) NOT NULL,
      createdAt TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "RagPage_domain_idx" ON "RagPage"(domain);`
  );
  // Cosine IVFFlat for fast ANN (safe if it exists already)
  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE indexname = 'RagPage_embedding_idx'
      ) THEN
        CREATE INDEX "RagPage_embedding_idx"
          ON "RagPage" USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
      END IF;
    END$$;
  `);
}
