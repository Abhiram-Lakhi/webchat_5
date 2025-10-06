// packages/server/index.ts
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import formbody from '@fastify/formbody';
import { Server } from 'socket.io';
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ragInit, ingestSite, ragChat } from './rag/service';
import { appendUserSummary, SummaryEntry } from './storage/summaries';
import twilio from 'twilio';
// Kafka + Admin namespace
import {
  initAdminNamespace,
  emitAdminBootstrap,
  emitAdminMessageNew,
  emitAdminSessionUpdate,
  emitAdminSummary,
} from './admin-socket';
import { initKafka, publishSafe, envelope } from './kafka';

// --- LiveKit (for voice) ---
import { registerVoiceRoutes } from './voice/routes';

dotenv.config();
const prisma = new PrismaClient();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = Fastify({ logger: true });

const PORT = parseInt(process.env.PORT || '3001', 10);
const ORIGIN_USER = process.env.CORS_ORIGIN_USER || 'http://localhost:5173';
const ORIGIN_AGENT = process.env.CORS_ORIGIN_AGENT || 'http://localhost:5174';

// LiveKit env (read-only)
const LIVEKIT_URL = process.env.LIVEKIT_URL || '';
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || '';

// --- Twilio (WhatsApp) ---
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM || ''; // e.g. "whatsapp:+14155238886"
const NGROK_BASE_URL = process.env.NGROK_BASE_URL || ''; // e.g. "https://abc123.ngrok-free.app"
const twilioClient =
  TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN
    ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    : null;

// WA session tracking
const waSessions = new Set<string>(); // sessionId set
const waPhoneToSession = new Map<string, string>(); // phone -> sessionId

await app.register(cors, { origin: [ORIGIN_USER, ORIGIN_AGENT], credentials: true });
await app.register(fastifyStatic, { root: path.join(__dirname, 'public'), prefix: '/' });
await app.register(formbody); // Twilio posts x-www-form-urlencoded

await ragInit();
app.get('/health', async () => ({ ok: true }));

// Register Voice (LiveKit) routes
await registerVoiceRoutes(app);

/** ------------------------------------------------------------------
 * Minimal endpoint to store assistant/user text from the voice room.
 * This does not change any existing flows.
 * ------------------------------------------------------------------ */
app.post('/voice/message', async (req: any, reply) => {
  try {
    const { sessionId, text, senderType } = req.body || {};
    if (!sessionId || !text) {
      return reply.code(400).send({ ok: false, error: 'sessionId and text required' });
    }
    const st: 'user' | 'agent' = senderType === 'user' ? 'user' : 'agent';
    const msg = await prisma.message.create({
      data: { sessionId, text, senderType: st },
    });
    // notify any listeners (same as other places)
    const room = `public:session:${sessionId}`;
    io.to(room).emit('message:new', msg);
    emitAdminMessageNew(sessionId, msg);
    return { ok: true, id: msg.id };
  } catch (e: any) {
    req.log.error(e);
    return reply.code(500).send({ ok: false, error: e?.message || 'save failed' });
  }
});

// --- Web chat history: return messages for a session (used on page reload) ---
app.get('/api/sessions/:id/messages', async (req: any, reply) => {
  try {
    const { id } = req.params as { id: string };
    if (!id) return reply.status(400).send({ ok: false, error: 'session id required' });

    const messages = await prisma.message.findMany({
      where: { sessionId: id },
      orderBy: { createdAt: 'asc' },
    });

    return messages.map((m) => ({
      id: m.id,
      sessionId: m.sessionId,
      text: m.text,
      senderType: m.senderType as 'user' | 'agent' | 'system',
      createdAt: m.createdAt,
    }));
  } catch (e: any) {
    req.log.error(e);
    return reply.status(500).send({ ok: false, error: e?.message || 'failed to load history' });
  }
});

/** Remember the chosen domain per-session for contextual answers */
const sessionDomain = new Map<string, string>();

app.post('/ingest', async (req: any, res) => {
  const site = (req.body?.site || '').toString();
  const sessionId = (req.body?.sessionId || '').toString();
  const max = parseInt(req.body?.max_pages ?? process.env.RAG_MAX_PAGES ?? '40', 10);
  if (!site) return res.status(400).send({ ok: false, error: 'site required' });
  try {
    const r = await ingestSite(site, max);
    if (sessionId && r.domain) sessionDomain.set(sessionId, r.domain);
    return r;
  } catch (e: any) {
    req.log.error(e);
    return res.status(500).send({ ok: false, error: e?.message || 'ingest failed' });
  }
});

// Attach Socket.IO to Fastify's own server (no second http server)
const io = new Server(app.server, {
  cors: { origin: [ORIGIN_USER, ORIGIN_AGENT], credentials: true },
});
initKafka();
// Admin namespace (only if enabled)
if (process.env.ADMIN_ENABLED === 'true') {
  initAdminNamespace(io);
  // Optional: initial bootstrap from DB for admin list panel
  try {
    const sessions = await prisma.session.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    // last message per session (simple query)
    const lastMsgs = await prisma.message.groupBy({
      by: ['sessionId'],
      _max: { createdAt: true },
    });
    emitAdminBootstrap({ sessions, lastMsgs });
  } catch (e) {
    app.log.warn({ err: e }, 'admin bootstrap failed (non-fatal)');
  }
}

const lobbyRoom = 'room:agents:lobby';

// NOTE: Added `channel` (web|whatsapp) — this is the ONLY functional change
type QueueItem = {
  handoffRequestId: string;
  sessionId: string;
  preview: any[];
  channel: 'web' | 'whatsapp';
};
const queueCache = new Map<string, QueueItem>();

// -------- summarization helpers --------
function canon(s: string) {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}
function stripGreeting(s: string) {
  return s
    .replace(/^\s*(hi+|h+i+|hello+|hey+|good (morning|afternoon|evening))[\s,!.:-]*/i, '')
    .trim();
}
function minutesBetween(a?: string, b?: string) {
  try {
    if (!a || !b) return null;
    const ms = new Date(b).getTime() - new Date(a).getTime();
    return ms > 0 ? Math.max(1, Math.round(ms / 60000)) : null;
  } catch {
    return null;
  }
}
function summarizeConversation(
  messages: { senderType: string; text: string }[],
  userName: string,
  agentName: string | undefined,
  endedBy: 'user' | 'agent',
  endRequestedBy: 'user' | 'agent' | null,
  startedAtISO?: string,
  endedAtISO?: string,
) {
  const userMsgs = messages.filter((m) => m.senderType === 'user').map((m) => m.text);
  const agentMsgs = messages.filter((m) => m.senderType === 'agent').map((m) => m.text);
  const firstUserRaw = (userMsgs[0] || '').trim();
  const firstUser = stripGreeting(firstUserRaw) || firstUserRaw || 'asked for help';
  const firstQuoted = `"${firstUser.slice(0, 120)}"${firstUser.length > 120 ? '…' : ''}`;
  const msgCount = messages.length;
  const mins = minutesBetween(startedAtISO, endedAtISO);
  const agentLabel = agentName || 'the agent';
  const summary = `${userName} started the chat saying ${firstQuoted}. ${agentLabel} responded. ${userName} asked for assistance. ${agentLabel} acknowledged the request. ${
    mins != null ? `After ${msgCount} messages over ~${mins} minute${mins === 1 ? '' : 's'},` : `After ${msgCount} messages,`
  } the chat was ended by ${endedBy}${
    endRequestedBy ? ` (requested by ${endRequestedBy})` : ''
  }.`
    .replace(/\s+/g, ' ')
    .trim();
  const topics = Array.from(
    new Set(
      canon(`${userMsgs.join(' ')} ${agentMsgs.join(' ')}`)
        .split(/\s+/)
        .filter((w) => w.length > 3),
    ),
  ).slice(0, 8);
  return { summary, topics };
}

// ---------------- WhatsApp helpers ----------------
const wantsHuman = (s: string) => {
  const t = s.toLowerCase();
  return ['agent', 'human', 'support', 'person', 'representative', 'help'].some((k) =>
    t.includes(k),
  );
};

async function sendWhatsAppText(toWhatsApp: string, text: string) {
  if (!twilioClient || !TWILIO_WHATSAPP_FROM) {
    console.warn('[WA] Missing Twilio config; skipping send');
    return;
  }
  try {
    const r = await twilioClient.messages.create({
      from: TWILIO_WHATSAPP_FROM, // "whatsapp:+14155238886"
      to: toWhatsApp, // "whatsapp:+<recipient>"
      body: text,
      statusCallback: NGROK_BASE_URL ? `${NGROK_BASE_URL}/webhooks/twilio/status` : undefined,
    });
    console.log('[WA] REST send accepted by Twilio', { to: toWhatsApp, sid: r.sid });
  } catch (err: any) {
    console.error('[WA] REST send error', err?.message || err);
  }
}

// Twilio delivery status (optional)
app.post('/webhooks/twilio/status', async (req: any, res) => {
  console.log('[WA] status', req.body);
  res.send('ok');
});

// Simple TwiML echo/ping
app.post('/webhooks/twilio/ping', async (req: any, res) => {
  console.log('[WA] ping webhook hit', { body: req.body });
  res.header('Content-Type', 'text/xml');
  res.send('<Response><Message>pong ✅</Message></Response>');
});

// Utility to run heavy work off the request lifecycle
function background(fn: () => Promise<void>) {
  setImmediate(() => fn().catch((e) => console.error('[WA] background error', e)));
}

// Main WA webhook (mounted on both paths)
async function handleTwilioWA(req: any, res: any) {
  const fromRaw = String(req.body?.From || '');
  const msgBody = String(req.body?.Body || '').trim();
  const toRaw = String(req.body?.To || '');
  console.log('[WA] inbound', { from: fromRaw, to: toRaw, body: msgBody, sid: req.body?.SmsMessageSid });

  // (A) Immediately reply via TwiML so the user sees *something*
  res.header('Content-Type', 'text/xml');
  res.send('<Response><Message>Got it — working on your reply…</Message></Response>');
  // (B) Do the actual bot/relay in the background and send via REST
  background(async () => {
    if (!fromRaw.startsWith('whatsapp:')) {
      console.warn('[WA] invalid From:', fromRaw);
      return;
    }
    const phone = fromRaw;

    // get/create session bound to this phone
    let sessionId = waPhoneToSession.get(phone);
    if (!sessionId) {
      const user = await prisma.user.create({
        data: { role: 'user', displayName: 'WhatsApp User' },
      });
      const session = await prisma.session.create({
        data: { status: 'bot_pending', userId: user.id },
      });
      emitAdminSessionUpdate(session.id, {
        status: session.status,
      channel: 'whatsapp',
      createdAt: session.createdAt,
      });
      publishSafe(
        'chat.sessions',
        session.id,
        envelope('SessionStarted', session.id, {
          channel: 'whatsapp',
          userDisplayName: 'WhatsApp User',
        }),
      );
      sessionId = session.id;
      waPhoneToSession.set(phone, sessionId);
      waSessions.add(sessionId);
      console.log('[WA] new session', { phone, sessionId });
    }

    const room = `public:session:${sessionId}`;

    // save inbound user message
    const userMsg = await prisma.message.create({
      data: { sessionId, text: msgBody, senderType: 'user' },
    });
    io.to(room).emit('message:new', userMsg);
    emitAdminMessageNew(sessionId, userMsg);
    publishSafe(
      'chat.messages',
      sessionId,
      envelope('MessageCreated', sessionId, {
        messageId: userMsg.id,
        senderType: 'user',
        text: userMsg.text,
        createdAt: userMsg.createdAt,
        channel: 'whatsapp',
      }),
    );

    // already with agent?
    const session = await prisma.session.findUnique({ where: { id: sessionId } });
    if (session?.status === 'active_with_agent') {
      console.log('[WA] already with agent; no bot reply');
      return;
    }

    // escalate if user asks
    if (wantsHuman(msgBody)) {
      const alreadyQueued = await prisma.handoffRequest.findFirst({
        where: { sessionId, acceptedAt: null },
      });
      if (!alreadyQueued) {
        await prisma.session.update({
          where: { id: sessionId },
          data: { status: 'queued_for_agent' },
        });
        const hr = await prisma.handoffRequest.create({ data: { sessionId } });
        const recent = await prisma.message.findMany({
          where: { sessionId },
          orderBy: { createdAt: 'desc' },
          take: 5,
        });
        const item: QueueItem = {
          handoffRequestId: hr.id,
          sessionId,
          preview: recent.reverse(),
          channel: 'whatsapp', // <--- added
        };
        queueCache.set(hr.id, item);
        io.to(lobbyRoom).emit('queue:new', item);
        console.log('[WA] queued for agent', { sessionId, handoffRequestId: hr.id });
      }
      await sendWhatsAppText(phone, 'Okay! Connecting you with a human agent. Please hold…');
      await prisma.message.create({
        data: {
          sessionId,
          text: 'User requested a human. Queued for handoff.',
          senderType: 'system',
        },
      });
      return;
    }

    // bot (RAG) reply
    try {
      const domain = sessionDomain.get(sessionId);
      const r = await ragChat({ sessionId, message: msgBody, domain, k: 4 });
      const replyText = r.reply || 'Thanks for your message!';
      const botMsg = await prisma.message.create({
        data: { sessionId, text: replyText, senderType: 'agent' },
      });
      io.to(room).emit('message:new', botMsg);
      await sendWhatsAppText(phone, replyText);
    } catch (e) {
      console.error('[WA] RAG error', e);
      const fallback = 'Sorry, I could not generate a reply right now.';
      const failMsg = await prisma.message.create({
        data: { sessionId, text: fallback, senderType: 'agent' },
      });
      io.to(room).emit('message:new', failMsg);
      await sendWhatsAppText(phone, fallback);
    }
  });
}

app.post('/twilio/whatsapp', handleTwilioWA);
app.post('/webhooks/twilio/whatsapp', handleTwilioWA);

// ---------------- sockets (web) ----------------
io.on('connection', (socket) => {
  socket.on('hello', (payload: { role: 'user' | 'agent'; displayName?: string }) => {
    socket.data.role = payload.role;
    socket.data.displayName =
      payload.displayName || (payload.role === 'agent' ? 'Agent' : 'User');
    if (payload.role === 'agent') {
      socket.join(lobbyRoom);
      io.to(socket.id).emit('agent:hello', { ok: true });
      io.to(socket.id).emit('queue:bootstrap', Array.from(queueCache.values()));
    } else {
      io.to(socket.id).emit('user:hello', { ok: true });
    }
  });

  // Create session and greet once (web)
  socket.on('session:create', async (payload: { displayName: string }, cb?: Function) => {
    try {
      const user = await prisma.user.create({
        data: { role: 'user', displayName: payload.displayName || 'Guest' },
      });
      socket.data.userId = user.id;
      socket.data.displayName = user.displayName;

      const session = await prisma.session.create({
        data: { status: 'bot_pending', userId: user.id },
      });
      emitAdminSessionUpdate(session.id, {
        status: session.status,
        channel: 'web',
        createdAt: session.createdAt,
      });
      publishSafe(
        'chat.sessions',
        session.id,
        envelope('SessionStarted', session.id, {
          channel: 'web',
          userDisplayName: user.displayName || null,
        }),
      );
      const room = `public:session:${session.id}`;
      socket.join(room);

      cb && cb({ ok: true, sessionId: session.id });
      io.to(socket.id).emit('message:history', { sessionId: session.id, messages: [] });

      const greet = await prisma.message.create({
        data: {
          sessionId: session.id,
          senderType: 'agent',
          text: `Hi ${user.displayName}! How can I help you today?`,
        },
      });
      io.to(room).emit('message:new', greet);
    } catch (e: any) {
      cb && cb({ ok: false, error: e.message });
    }
  });

  socket.on('session:join', async (payload: { sessionId: string }, cb?: Function) => {
    try {
      const room = `public:session:${payload.sessionId}`;
      socket.join(room);
      const messages = await prisma.message.findMany({
        where: { sessionId: payload.sessionId },
        orderBy: { createdAt: 'asc' },
      });
      cb && cb({ ok: true });
      io.to(socket.id).emit('message:history', { sessionId: payload.sessionId, messages });
    } catch (e: any) {
      cb && cb({ ok: false, error: e.message });
    }
  });

  socket.on(
    'message:send',
    async (payload: { sessionId: string; text: string; senderType?: 'user' | 'agent' }) => {
      const senderType = payload.senderType || (socket.data.role === 'agent' ? 'agent' : 'user');

      const msg = await prisma.message.create({
        data: {
          sessionId: payload.sessionId,
          text: payload.text,
          senderType: senderType === 'agent' ? 'agent' : 'user',
        },
      });
      emitAdminMessageNew(payload.sessionId, msg);
      publishSafe(
        'chat.messages',
        payload.sessionId,
        envelope('MessageCreated', payload.sessionId, {
          messageId: msg.id,
          senderType: msg.senderType,
          senderId: msg.senderId ?? null,
          text: msg.text,
          createdAt: msg.createdAt,
          channel: 'web',
        }),
      );
      const room = `public:session:${payload.sessionId}`;
      io.to(room).emit('message:new', msg);

      if (senderType === 'user') {
        const session = await prisma.session.findUnique({
          where: { id: payload.sessionId },
        });
        if (session && session.status === 'bot_pending') {
          try {
            const domain = sessionDomain.get(payload.sessionId);
            const r = await ragChat({ sessionId: payload.sessionId, message: payload.text, domain, k: 4 });
            const reply = await prisma.message.create({
              data: { sessionId: payload.sessionId, text: r.reply || '…', senderType: 'agent' },
            });
            io.to(room).emit('message:new', reply);
          } catch {
            const fail = await prisma.message.create({
              data: {
                sessionId: payload.sessionId,
                text: `Sorry, I could not generate a reply right now.`,
                senderType: 'agent',
              },
            });
            io.to(room).emit('message:new', fail);
          }
        }
      }

      // Relay agent messages to WhatsApp if this session is WA
      if (
        senderType === 'agent' &&
        waSessions.has(payload.sessionId) &&
        twilioClient &&
        TWILIO_WHATSAPP_FROM
      ) {
        try {
          let phone: string | undefined;
          for (const [k, v] of waPhoneToSession.entries()) {
            if (v === payload.sessionId) {
              phone = k;
              break;
            }
          }
          if (phone) await sendWhatsAppText(phone, payload.text);
        } catch (e) {
          console.error('WA relay error:', e);
        }
      }
    },
  );

  // Handoff (web-originated)
  socket.on('handoff:request', async (payload: { sessionId: string }, cb?: Function) => {
    try {
      const session = await prisma.session.update({
        where: { id: payload.sessionId },
        data: { status: 'queued_for_agent' },
      });
      const hr = await prisma.handoffRequest.create({ data: { sessionId: session.id } });
      emitAdminSessionUpdate(session.id, { status: 'queued_for_agent' });
      publishSafe('chat.handoffs', session.id, envelope('HandoffRequested', session.id, {}));
      const recent = await prisma.message.findMany({
        where: { sessionId: session.id },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });
      const item: QueueItem = {
        handoffRequestId: hr.id,
        sessionId: session.id,
        preview: recent.reverse(),
        channel: 'web', // <--- added
      };
      queueCache.set(hr.id, item);
      io.to(lobbyRoom).emit('queue:new', item);
      cb && cb({ ok: true });
    } catch (e: any) {
      cb && cb({ ok: false, error: e.message });
    }
  });

  socket.on('agent:claim', async (payload: { handoffRequestId: string }, cb?: Function) => {
    try {
      let agentId = socket.data.agentId as string | undefined;
      if (!agentId) {
        const agent = await prisma.user.create({
          data: { role: 'agent', displayName: socket.data.displayName || 'Agent' },
        });
        agentId = agent.id;
        socket.data.agentId = agentId;
      }

      const updated = await prisma.$transaction(async (tx) => {
        const res = await tx.handoffRequest.updateMany({
          where: { id: payload.handoffRequestId, acceptedAt: null },
          data: { acceptedAt: new Date(), acceptedById: agentId! },
        });
        if (res.count === 0) throw new Error('already accepted');

        const hr2 = await tx.handoffRequest.findUnique({
          where: { id: payload.handoffRequestId },
        });
        if (!hr2) throw new Error('handoff not found');

        await tx.session.update({
          where: { id: hr2.sessionId },
          data: { status: 'active_with_agent' },
        });
        await tx.agentAssignment.create({
          data: { agentId: agentId!, sessionId: hr2.sessionId },
        });
        return hr2;
      });
      emitAdminSessionUpdate(updated.sessionId, {
        status: 'active_with_agent',
        agentId: socket.data.agentId || null,
      });
      publishSafe(
        'chat.assignments',
        updated.sessionId,
        envelope('AgentAssigned', updated.sessionId, {
          agentId: socket.data.agentId || null,
        }),
      );

      queueCache.delete(payload.handoffRequestId);
      io.to(lobbyRoom).emit('queue:remove', { handoffRequestId: payload.handoffRequestId });

      const room = `public:session:${updated.sessionId}`;
      socket.join(room);
      const history = await prisma.message.findMany({
        where: { sessionId: updated.sessionId },
        orderBy: { createdAt: 'asc' },
      });
      io.to(socket.id).emit('message:history', {
        sessionId: updated.sessionId,
        messages: history,
      });
      io.to(room).emit('handoff:accepted', {
        sessionId: updated.sessionId,
        agentName: socket.data.displayName || 'Agent',
      });
      cb && cb({ ok: true, sessionId: updated.sessionId });
    } catch (e: any) {
      cb && cb({
        ok: false,
        error: e?.message === 'already accepted' ? 'already accepted' : e.message,
      });
    }
  });

  // End chat flow
  socket.on('session:end:request', async (payload: { sessionId: string }, cb?: Function) => {
    try {
      const exists = await prisma.endChatRequest.findFirst({
        where: { sessionId: payload.sessionId, status: 'pending' },
      });
      if (exists) return cb && cb({ ok: true });

      const req = await prisma.endChatRequest.create({
        data: { sessionId: payload.sessionId, requestedBy: 'user', status: 'pending' },
      });
      const room = `public:session:${payload.sessionId}`;
      io.to(room).emit('session:end:requested', {
        sessionId: payload.sessionId,
        requestId: req.id,
        requestedBy: 'user',
      });
      cb && cb({ ok: true });
    } catch (e: any) {
      cb && cb({ ok: false, error: e.message });
    }
  });

  socket.on('session:end:decline', async (payload: { requestId: string }, cb?: Function) => {
    try {
      const req = await prisma.endChatRequest.findUnique({ where: { id: payload.requestId } });
      if (!req) throw new Error('request not found');
      const agentId = socket.data.agentId as string | undefined;
      if (!agentId) throw new Error('not agent');
      await prisma.endChatRequest.update({
        where: { id: req.id },
        data: { status: 'declined', declinedAt: new Date(), acceptedById: agentId },
      });
      const room = `public:session:${req.sessionId}`;
      io.to(room).emit('session:end:declined', { sessionId: req.sessionId });
      cb && cb({ ok: true });
    } catch (e: any) {
      cb && cb({ ok: false, error: e.message });
    }
  });

  socket.on('session:end:accept', async (payload: { requestId: string }, cb?: Function) => {
    try {
      const req = await prisma.endChatRequest.findUnique({ where: { id: payload.requestId } });
      if (!req) throw new Error('request not found');
      const agentId = socket.data.agentId as string | undefined;
      if (!agentId) throw new Error('not agent');
      await prisma.endChatRequest.update({
        where: { id: req.id },
        data: { status: 'accepted', acceptedAt: new Date(), acceptedById: agentId },
      });
      await closeSession(req.sessionId, 'agent', 'user');
      cb && cb({ ok: true });
    } catch (e: any) {
      cb && cb({ ok: false, error: e.message });
    }
  });

  socket.on('session:close', async (payload: { sessionId: string }, cb?: Function) => {
    try {
      if (socket.data.role !== 'agent') return cb && cb({ ok: false, error: 'only agent may close directly' });
      await closeSession(payload.sessionId, 'agent', null);
      cb && cb({ ok: true });
    } catch (e: any) {
      cb && cb({ ok: false, error: e.message });
    }
  });

  async function closeSession(
    sessionId: string,
    endedBy: 'user' | 'agent',
    endRequestedBy: 'user' | 'agent' | null,
  ) {
    const session = await prisma.session.update({
      where: { id: sessionId },
      data: { status: 'closed', closedAt: new Date() },
    });
    const [msgs, sessWithUser, assignment] = await Promise.all([
      prisma.message.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' } }),
      prisma.session.findUnique({ where: { id: sessionId }, include: { user: true } }),
      prisma.agentAssignment.findFirst({
        where: { sessionId, endedAt: null },
        include: { agent: true },
      }),
    ]);
    const startedAt = session.createdAt?.toISOString?.() || new Date().toISOString();
    const endedAt = (session.closedAt ?? new Date()).toISOString();
    const userName = sessWithUser?.user?.displayName || 'User';
    const agentName = assignment?.agent?.displayName || 'Agent';
    const { summary, topics } = summarizeConversation(
      msgs,
      userName,
      agentName,
      endedBy,
      endRequestedBy,
      startedAt,
      endedAt,
    );

    const entry: SummaryEntry = { sessionId, startedAt, endedAt, summary, topics, messageCount: msgs.length };
    (entry as any).participants = { user: userName, agent: agentName };
    (entry as any).endedBy = endedBy;
    (entry as any).endRequestedBy = endRequestedBy;

    await appendUserSummary(userName, sessWithUser?.user?.id, entry);
    const room = `public:session:${sessionId}`;
    io.to(room).emit('session:closed', { sessionId, endedBy, endRequestedBy });
    emitAdminSessionUpdate(sessionId, { status: 'closed', endedAt: new Date().toISOString() });
    publishSafe('chat.sessions', sessionId, envelope('SessionEnded', sessionId, { reason: endRequestedBy ? 'polite' : 'force' }));
    try {
      emitAdminSummary(sessionId, {
        messageCount: (entry as any).messageCount,
        durationSeconds: (entry as any).durationSeconds ?? null,
        summary: entry.summary,
        topics: entry.topics,
      });
      publishSafe('chat.summaries', sessionId, envelope('SummaryCreated', sessionId, {
        messageCount: (entry as any).messageCount,
        durationSeconds: (entry as any).durationSeconds ?? null,
      }));
    } catch (e) {
      console.warn('summary emit failed', e);
    }
  }
});

// Start Fastify (and thus Socket.IO) on the same server
await app.listen({ port: PORT, host: '0.0.0.0' });
console.log(`Server listening on http://localhost:${PORT}`);
