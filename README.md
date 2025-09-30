# Webchat — Local live chat with handoff, WhatsApp, and RAG

End-to-end live chat system where a user chats on the web, can request a human, an agent sees the queue with transcript preview, accepts the chat, and continues live in real time. WhatsApp channel, admin monitor, Kafka event publishing, and RAG bot for site-aware answers.

This monorepo contains:
- Server: Fastify + Socket.IO + Prisma (Postgres/pgvector) + Kafka + Twilio WhatsApp + OpenAI RAG
- Web User app: React + Vite
- Web Agent app: React + Vite
- Admin viewer (static): read-only dashboard under `/admin`

Useful references: docs/ARCHITECTURE.md and README-webchat.md

## Features
- Realtime messaging between user and agent (Socket.IO)
- Handoff: “Talk to a human” queues session for agents with transcript preview
- Agent accept: assigns session, loads full history, and joins live
- End chat flow: user can request end; agent accepts or declines
- Channels: Web by default; optional WhatsApp via Twilio
- RAG bot: site ingest + contextual answers with citations (OpenAI + pgvector)
- Admin namespace: simple live monitor at `/admin`
- Event streaming: optional Kafka publish for sessions, messages, and summaries

## Requirements
- Node.js 20+
- pnpm: `npm i -g pnpm`
- Docker (for local Postgres with pgvector via docker-compose)
- Optional: OpenAI API key (RAG), Twilio credentials (WhatsApp), Kafka broker

## Quick Start

1) Install dependencies (root)
- `pnpm install`

2) Start Postgres with pgvector
- `docker compose up -d`

3) Configure server env (packages/server/.env)
```
PORT=3001
DATABASE_URL=postgresql://webchat:webchat@localhost:5432/webchat?schema=public
CORS_ORIGIN_USER=http://localhost:5173
CORS_ORIGIN_AGENT=http://localhost:5174

# Admin monitor
ADMIN_ENABLED=true

# Kafka
# KAFKA_ENABLED=true
# KAFKA_BROKERS=localhost:9092
# KAFKA_CLIENT_ID=webchat

# RAG / OpenAI
# OPENAI_API_KEY=sk-...
# OPENAI_MODEL=gpt-4o-mini
# OPENAI_EMBED_MODEL=text-embedding-3-small

# Twilio WhatsApp
# TWILIO_ACCOUNT_SID=AC...
# TWILIO_AUTH_TOKEN=...
# TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
# NGROK_BASE_URL=https://<your-ngrok>.ngrok-free.app
```

4) Generate Prisma client and apply schema
- From repo root:
  - `pnpm --filter @webchat/server prisma:gen`
  - `pnpm --filter @webchat/server run prisma:dev`

5) Run apps (separate terminals or `dev:all`)
- Server: `pnpm dev:server` → http://localhost:3001/health
- User app: `pnpm dev:user` → http://localhost:5173
- Agent app: `pnpm dev:agent` → http://localhost:5174
- All at once (optional): `pnpm dev:all`

6) Admin
- Open http://localhost:3001/admin (static read-only monitor)

## Usage and Workflow

- User app
  - Open http://localhost:5173
  - Enter a name → Start Chat → send messages
  - Click “Talk to a human” to queue a handoff
  - If agent accepts, you will see a banner and continue chatting live
  - Use “End chat” to request closing the session (agent must accept)

- Agent app
  - Open http://localhost:5174
  - Queue list shows waiting conversations with last-message preview and channel
  - Click Accept to claim a conversation; full history loads and live chat begins
  - Quick replies and composer send messages; you can also end immediately or accept/decline user end requests

- Admin viewer
  - Open http://localhost:3001/admin/
  - Shows live sessions/messages and emits summary data on close

## WhatsApp Channel 

- Configure Twilio in `.env` (see above) and expose the server publicly (e.g., via ngrok)
- Set Twilio WhatsApp webhook URLs:
  - Inbound: `POST https://<public>/webhooks/twilio/whatsapp` (also accepts `/twilio/whatsapp`)
  - Status callbacks: `POST https://<public>/webhooks/twilio/status`
- Inbound messages create or reuse a WhatsApp session, send to agents, and receive bot replies until an agent accepts
- Agent replies are relayed to WhatsApp

## RAG Bot and Widget (Optional)

- Site ingest endpoint (server): `POST /ingest { site, max_pages? }` → indexes the site into Postgres (`RagPage`)
- Bot answers: When a session is in `bot_pending`, user messages trigger `ragChat` with top-K snippets + citations
- Standalone widget (served by server):
  - Page: `/widget.html` (RAG chat with ingest bar)
  - Embed script: `/widget.js` (adds floating bubbles for site chat + WhatsApp)
  - Example embed:
    ```html
    <script src="http://localhost:3001/widget.js"
            data-src="http://localhost:3001/widget.html"
            data-base="http://localhost:3001"></script>
    ```
  - On ingest, widget can prefill a WhatsApp message like `site https://<domain>`

## Data Model (Prisma/Postgres)
- User: id, role, displayName, email?, createdAt, relations to sessions/assignments/handoffs/endRequests/summaries
- Session: id, status (bot_pending | queued_for_agent | active_with_agent | closed), userId?, createdAt, closedAt?, relations
- Message: id, sessionId, senderType (user | agent | system), text, createdAt
- HandoffRequest: id, sessionId, requestedAt, acceptedAt?, acceptedById?
- AgentAssignment: id, agentId, sessionId, assignedAt, endedAt?
- EndChatRequest: id, sessionId, requestedAt, requestedBy, acceptedAt?, declinedAt?, acceptedById?, status
- SessionSummary: id, sessionId (unique), userId?, userDisplayName, agentDisplayName, summary, topics[], messageCount, startedAt, endedAt, endedBy, endRequestedBy?, raw, createdAt

## Socket.IO Events (Canonical)
- Client → Server: `hello`, `session:create`, `session:join`, `message:send`, `handoff:request`, `agent:claim`, `session:end:request`, `session:end:accept`, `session:end:decline`, `session:close`
- Server → Client: `message:history`, `message:new`, `queue:bootstrap`, `queue:new`, `queue:remove`, `handoff:accepted`, `session:end:requested`, `session:end:declined`, `session:closed`
- Admin namespace `/admin`: `admin:bootstrap`, `admin:message:new`, `admin:session:update`, `admin:summary:ready`

## Repository Structure
- pnpm-workspace.yaml, tsconfig.base.json, docker-compose.yml
- packages/
  - server: Fastify + Socket.IO + Prisma + optional Kafka/Twilio/OpenAI, public assets under `src/public`
  - web-user: React/Vite user app (`/` and `/chat` routes, floating widget menu)
  - web-agent: React/Vite agent app (queue, accept, live chat, end flow)
- docs/
  - ARCHITECTURE.md: in-depth architecture, flows, and file-level notes

## Scripts
- Root
  - `dev:server`: run API on 3001
  - `dev:user`: run user app on 5173
  - `dev:agent`: run agent app on 5174
  - `dev:all`: run all three concurrently
  - `format`: `prettier -w .`
- Server (packages/server)
  - `dev`: tsx watch `src/index.ts`
  - `build` / `start`: TypeScript build and run
  - `prisma:gen` / `prisma:dev` / `prisma:studio`

## Configuration Notes
- CORS: allow both Vite dev origins via `CORS_ORIGIN_USER` and `CORS_ORIGIN_AGENT`
- Kafka: publishing is auto-disabled if brokers are missing or connection fails
- Twilio: if credentials are missing, WhatsApp send is skipped but the app continues to run
- RAG: requires `OPENAI_API_KEY` and Postgres with `pgvector` extension

## Troubleshooting
- Postgres connection errors: ensure `docker compose ps` shows postgres healthy and `DATABASE_URL` is correct
- Prisma errors: run `pnpm --filter @webchat/server prisma:gen` and `prisma:dev`; verify the `postgresql` provider in `schema.prisma`
- CORS errors: check `CORS_ORIGIN_USER`/`CORS_ORIGIN_AGENT` envs match your dev ports
- OpenAI/RAG not responding: set `OPENAI_API_KEY`; server logs will show failures and fall back replies
- Twilio webhooks: verify public URL, webhook paths, and that `NGROK_BASE_URL` is set for delivery status callbacks

## Production Considerations
- Replace Vite dev servers with built assets behind a reverse proxy (Nginx, Caddy)
- Harden authentication and agent identity (currently a simple dev default)
- Add persistence/observability for queue state and admin metrics
- Review rate limits and add input validation on all endpoints/events

For deeper internals and file-by-file notes, see docs/ARCHITECTURE.md.
