// packages/server/src/voice/routes.ts
import type { FastifyInstance } from 'fastify';
import { AccessToken } from 'livekit-server-sdk';

const LIVEKIT_URL = process.env.LIVEKIT_URL || '';
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || '';
const DEFAULT_ROOM = process.env.LIVEKIT_DEFAULT_ROOM || 'voice_test123';

export async function registerVoiceRoutes(app: FastifyInstance) {
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    app.log.error('[voice] missing LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET');
  } else {
    app.log.info(
      { url: LIVEKIT_URL, room: DEFAULT_ROOM },
      '[voice] LiveKit URL/room ready'
    );
  }

  // ping
  app.get('/voice/health', async () => ({ ok: true }));

  /**
   * POST /voice/token
   * body: { displayName?: string, sessionId?: string, roomName?: string }
   */
  app.post('/voice/token', async (req: any, reply) => {
    try {
      const { displayName, sessionId, roomName } = (req.body ?? {}) as {
        displayName?: string;
        sessionId?: string;
        roomName?: string;
      };

      const identity =
        (displayName?.trim() || 'web_user') +
        '_' +
        (sessionId?.trim() || Math.random().toString(36).slice(2));

      const room = roomName?.trim() || DEFAULT_ROOM;

      // IMPORTANT: iss must be the API key; token must be signed with the secret
      const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
        identity,
        ttl: 60 * 5, // 5 minutes
      });

      at.addGrant({
        roomJoin: true,
        room,
        canPublish: true,
        canSubscribe: true,
      });

      const token = await at.toJwt();

      return reply.send({
        ok: true,
        token,
        livekitUrl: LIVEKIT_URL,
        roomName: room,
        sessionId: sessionId || identity, // echo something the client can save
      });
    } catch (e: any) {
      req.log.error(e);
      return reply.code(500).send({ ok: false, error: e?.message || 'token failed' });
    }
  });
}
