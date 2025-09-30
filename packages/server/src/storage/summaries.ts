import { PrismaClient } from '@prisma/client';

export type SummaryEntry = {
  sessionId: string;
  startedAt: string;
  endedAt: string;
  summary: string;
  topics: string[];
  messageCount: number;
  // optional extras we attach in index.ts
  participants?: { user: string; agent: string };
  endedBy?: 'user' | 'agent';
  endRequestedBy?: 'user' | 'agent' | null;
};

const prisma = new PrismaClient();

/**
 * Writes (or overwrites) the per-session summary into Postgres.
 * We use upsert keyed by sessionId to avoid duplicates if retried.
 */
export async function appendUserSummary(
  userDisplayName: string,
  userId: string | undefined | null,
  entry: SummaryEntry
) {
  const agentDisplayName = entry.participants?.agent ?? 'Agent';

  const raw = {
    userDisplayName,
    userId: userId ?? null,
    ...entry
  };

  await prisma.sessionSummary.upsert({
    where: { sessionId: entry.sessionId },
    update: {
      userId: userId ?? null,
      userDisplayName,
      agentDisplayName,
      summary: entry.summary,
      topics: entry.topics,
      messageCount: entry.messageCount,
      startedAt: new Date(entry.startedAt),
      endedAt: new Date(entry.endedAt),
      endedBy: entry.endedBy ?? 'agent',
      endRequestedBy: entry.endRequestedBy ?? null,
      raw
    },
    create: {
      sessionId: entry.sessionId,
      userId: userId ?? null,
      userDisplayName,
      agentDisplayName,
      summary: entry.summary,
      topics: entry.topics,
      messageCount: entry.messageCount,
      startedAt: new Date(entry.startedAt),
      endedAt: new Date(entry.endedAt),
      endedBy: entry.endedBy ?? 'agent',
      endRequestedBy: entry.endRequestedBy ?? null,
      raw
    }
  });
}
