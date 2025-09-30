import { PrismaClient } from '@prisma/client';
import { ensureRagSchema } from './db';
import { crawl } from './crawler';
import { chatWithContext, embedQuery, embedTexts } from './llm';

const prisma = new PrismaClient();

type ChatArgs = {
  sessionId: string;
  message: string;
  domain?: string;
  k?: number;
};

export async function ragInit() {
  await ensureRagSchema(prisma);
  return true;
}

function chunk(text: string, size = 1200): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

export async function ingestSite(site: string, maxPages = 40) {
  const start = site.startsWith('http') ? site : `https://${site}`;
  const domain = new URL(start).hostname;

  const pages = await crawl(start, maxPages);

  // delete old rows for domain
  await prisma.$executeRawUnsafe(`DELETE FROM "RagPage" WHERE domain = $1`, domain);

  // embed in small batches
  for (const p of pages) {
    const pieces = chunk(p.text, 1000);
    if (!pieces.length) continue;

    const embs = await embedTexts(pieces);
    for (let i = 0; i < pieces.length; i++) {
      const vec = '[' + embs[i].map((x) => (Number.isFinite(x) ? x.toFixed(6) : '0')).join(',') + ']';
      await prisma.$executeRawUnsafe(
        `INSERT INTO "RagPage"(domain, url, content, embedding) VALUES ($1,$2,$3, '${vec}'::vector)`,
        domain,
        p.url,
        pieces[i]
      );
    }
  }

  return { ok: true, domain, pages: pages.length };
}

async function retrieve(domain: string | undefined, q: string, k: number) {
  if (!domain) return [];
  const qv = await embedQuery(q);
  const vec = '[' + qv.map((x) => (Number.isFinite(x) ? x.toFixed(6) : '0')).join(',') + ']';

  // cosine distance (smaller is closer). We’ll sort ascending and take top K
  const rows: Array<{ url: string; content: string; score: number }> = await prisma.$queryRawUnsafe(
    `
      SELECT url, content, (1 - (embedding <=> '${vec}'::vector)) as score
      FROM "RagPage"
      WHERE domain = $1
      ORDER BY embedding <=> '${vec}'::vector ASC
      LIMIT $2
    `,
    domain,
    Math.max(1, k)
  );

  return rows.map((r) => ({ url: r.url, snippet: r.content, score: r.score }));
}

export async function ragChat(args: ChatArgs): Promise<{ reply: string; sources: any[] }> {
  const { message, domain, k = 4 } = args;

  const ctx = await retrieve(domain, message, k);
  const block =
    ctx.length > 0
      ? ctx.map((c, i) => `[${i + 1}] ${c.url}\n${c.snippet}`).join('\n\n')
      : '(no site context available)';

  const system = `You are a helpful assistant for the user's currently loaded website.
Use ONLY the facts inside [CONTEXT] when the question is about the site. If those facts are missing,
answer briefly with general knowledge. Be concise. If you used site text, end with short citations like [1], [2].

[CONTEXT]
${block}`;

  const reply = await chatWithContext(system, message);
  return { reply, sources: ctx.map((c, i) => ({ id: i + 1, url: c.url, score: c.score })) };
}
