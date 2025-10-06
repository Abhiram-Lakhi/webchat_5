-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('web', 'whatsapp', 'voice');

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "channel" "Channel" NOT NULL DEFAULT 'web';
