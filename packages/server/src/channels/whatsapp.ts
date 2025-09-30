import type { Express } from "express";
import type { Server as IOServer } from "socket.io";
import { config } from "dotenv";
import twilio from "twilio";
import { OpenAI } from "openai";

config();

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const TWILIO_AUTH_TOKEN  = process.env.TWILIO_AUTH_TOKEN!;
const WHATSAPP_FROM      = process.env.TWILIO_WHATSAPP_FROM!; // e.g. "whatsapp:+14155238886"
const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- In-memory stores (replace with DB if you have one) ---
type Msg = { id: string; sessionId: string; text: string; senderType: "user"|"agent"|"system"; createdAt: string; };
type Session = { sessionId: string; channel: "whatsapp"; phone: string; displayName: string; agentActive: boolean; handoffRequestId?: string; };

const phoneToSession = new Map<string, Session>();
const messagesBySession = new Map<string, Msg[]>();
const queuePreviewByHandoff = new Map<string, { handoffRequestId: string; sessionId: string; preview: Msg[] }>();

const uid = () => Math.random().toString(36).slice(2, 10);

// Helpers
function appendMessage(io: IOServer, m: Msg) {
  const arr = messagesBySession.get(m.sessionId) || [];
  arr.push(m);
  messagesBySession.set(m.sessionId, arr);
  io.emit("message:new", m); // agents see it; your agent UI listens to this
}

async function sendWhatsAppText(toWhatsApp: string, text: string) {
  // Send via direct number
  await client.messages.create({ from: WHATSAPP_FROM, to: toWhatsApp, body: text });
  // If you use a Messaging Service: { messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID, to, body }
}

// crude “wants human” detector
function wantsHuman(s: string) {
  const t = s.toLowerCase();
  return ["agent","human","support","person","representative","help"].some(k => t.includes(k));
}

export function installWhatsApp(app: Express, io: IOServer) {
  // Twilio sends x-www-form-urlencoded by default
  app.post("/twilio/whatsapp", express.urlencoded({ extended: true }), async (req, res) => {
    try {
      const fromRaw = String(req.body.From || "");          // e.g., "whatsapp:+15551234567"
      const body = String(req.body.Body || "").trim();
      if (!fromRaw.startsWith("whatsapp:")) { return res.sendStatus(400); }

      const phone = fromRaw; // preserve the "whatsapp:+..."
      let session = phoneToSession.get(phone);

      // Create a session if first time
      if (!session) {
        const sessionId = "wa_" + uid();
        session = { sessionId, channel: "whatsapp", phone, displayName: "WhatsApp User", agentActive: false };
        phoneToSession.set(phone, session);
        messagesBySession.set(sessionId, []);
        // also broadcast history to agents (empty)
        io.emit("message:history", { sessionId, messages: [] });
      }

      // Record user message; broadcast to agents
      const userMsg: Msg = { id: uid(), sessionId: session.sessionId, text: body, senderType: "user", createdAt: new Date().toISOString() };
      appendMessage(io, userMsg);

      // If agent is active, just notify and stop. Agents will reply and we relay outwards.
      if (session.agentActive) {
        return res.sendStatus(200);
      }

      // Not active yet → bot-first
      if (wantsHuman(body)) {
        // if not already queued, create a handoff request and push to agent UIs
        if (!session.handoffRequestId) {
          const handoffRequestId = "handoff_" + uid();
          session.handoffRequestId = handoffRequestId;

          // preview: last 3 messages
          const prev = (messagesBySession.get(session.sessionId) || []).slice(-3);
          const queueItem = { handoffRequestId, sessionId: session.sessionId, preview: prev };
          queuePreviewByHandoff.set(handoffRequestId, queueItem);

          io.emit("queue:new", queueItem);
        }

        // Optional: confirm to the user
        await sendWhatsAppText(phone, "Okay! Connecting you with a human agent. Please hold…");
        const botMsg: Msg = { id: uid(), sessionId: session.sessionId, text: "User requested a human. Queued for handoff.", senderType: "system", createdAt: new Date().toISOString() };
        appendMessage(io, botMsg);
        return res.sendStatus(200);
      }

      // Bot reply via OpenAI
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini", // small & fast; change if you prefer
        messages: [
          { role: "system", content: "You are a helpful support assistant. Keep replies concise." },
          { role: "user", content: body }
        ]
      });
      const reply = completion.choices[0]?.message?.content?.trim() || "Thanks!";

      await sendWhatsAppText(phone, reply);
      const botMsg: Msg = { id: uid(), sessionId: session.sessionId, text: reply, senderType: "agent", createdAt: new Date().toISOString() };
      appendMessage(io, botMsg);

      res.sendStatus(200);
    } catch (err) {
      console.error("WA webhook error:", err);
      res.sendStatus(500);
    }
  });

  // When an agent accepts a queued chat
  io.on("connection", (socket) => {
    socket.on("agent:claim", (p: { handoffRequestId: string }, ack: Function) => {
      const item = queuePreviewByHandoff.get(p.handoffRequestId);
      if (!item) return ack({ ok:false, error: "already accepted" });

      const sessionId = item.sessionId;
      // find session
      let session: Session | undefined;
      for (const s of phoneToSession.values()) {
        if (s.sessionId === sessionId) { session = s; break; }
      }
      if (!session) return ack({ ok:false, error: "invalid session" });

      session.agentActive = true;
      queuePreviewByHandoff.delete(p.handoffRequestId);

      // send history to this socket only, and inform all agents to remove the queue card
      socket.emit("message:history", { sessionId, messages: messagesBySession.get(sessionId) || [] });
      io.emit("queue:remove", { handoffRequestId: p.handoffRequestId });

      return ack({ ok:true, sessionId });
    });

    // Agent sends a message (relay to WhatsApp if channel=whatsapp)
    socket.on("message:send", async (m: { sessionId: string; text: string; senderType: "agent" }, _ack?: Function) => {
      try {
        // find session from sessionId
        let session: Session | undefined;
        for (const s of phoneToSession.values()) {
          if (s.sessionId === m.sessionId) { session = s; break; }
        }
        if (!session) return;

        if (session.channel === "whatsapp") {
          await sendWhatsAppText(session.phone, m.text);
        }
        appendMessage(io, { id: uid(), sessionId: m.sessionId, text: m.text, senderType: "agent", createdAt: new Date().toISOString() });
      } catch (e) { console.error("send relay error", e); }
    });

    // Close the session
    socket.on("session:close", (p:{sessionId:string}, ack:Function) => {
      // broadcast to UIs
      io.emit("session:closed", { sessionId: p.sessionId });
      return ack({ ok:true });
    });
  });
}
