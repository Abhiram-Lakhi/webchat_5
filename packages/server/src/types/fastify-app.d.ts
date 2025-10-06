// packages/server/src/types/fastify-app.d.ts
import 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    // Optional "store" used by your route typing; runtime can attach it or not.
    store?: {
      getMessages(id: string): Promise<any[]> | any[];
    };
  }
}
