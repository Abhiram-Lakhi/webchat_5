// packages/server/src/routes/sessions.ts
import { FastifyInstance } from 'fastify';

export async function sessionsRoutes(app: FastifyInstance) {
  // Replace this with your real store (Prisma/DB/Redis/in-memory)
  const store = app.store ?? { getMessages: (id: string) => [] as any[] };

  app.get('/api/sessions/:id/messages', async (req, reply) => {
    const { id } = req.params as { id: string };
    const rows = await store.getMessages(id); // ensure ascending order
    return rows.map((r: any) => ({
      role: r.role,
      text: r.text,
      ts: r.ts ?? r.createdAt ?? new Date().toISOString(),
    }));
  });
}
