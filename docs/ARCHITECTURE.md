# Webchat Monorepo — Detailed Documentation

This document explains the full repository structure, how components interact, the data model, event flows, key files, and how to run the system locally. It focuses on authored source files and project assets, not third‑party dependencies or compiled outputs.

## 1) High‑Level Overview
- Purpose: Local, full‑stack live chat system where a “User” chats on the web; can request a human; an “Agent” sees the queue, accepts, and continues live. Optional WhatsApp channel and RAG bot support.
- Architecture:
  - Backend: Fastify (HTTP) + Socket.IO (realtime) + Prisma (Postgres/pgvector) + optional Kafka publisher + optional Twilio WhatsApp + optional RAG with OpenAI.
  - Frontend (User): React + Vite app for end users (start chat, send messages, handoff, end chat).
  - Frontend (Agent): React + Vite app for agents (queue, accept, live chat, end/continue).
  - Admin Viewer (static): Lightweight Socket.IO client UI for monitoring (no build needed).
- Monorepo: pnpm workspaces; packages under `packages/*`.

## 2) Top‑Level Files
- `package.json`: Root workspace config and scripts.
  - Scripts:
    - `dev:server`: `pnpm --filter @webchat/server dev`
    - `dev:user`: `pnpm --filter @webchat/web-user dev`
    - `dev:agent`: `pnpm --filter @webchat/web-agent dev`
    - `dev:all`: Run all three concurrently
    - `format`: Run Prettier
  - Workspaces: `packages/*`
- `pnpm-workspace.yaml`: Declares workspace packages.
- `tsconfig.base.json`: Shared TS compiler options (ES2020 target, ESNext modules, strict, ESM interop, etc.).
- `README.md`: Quick start for local dev.
- `README-webchat.md`: Extended overview (features, architecture, requirements, getting started, scripts, structure).
- `docker-compose.yml`: Starts Postgres with `pgvector` (pg16). Exposes 5432 and persists to `pgdata` volume.

Notes:
- The extended README mentions SQLite as an earlier scope. Current server code is wired for Postgres with `pgvector` (see Prisma datasource and RAG schema helper using `CREATE EXTENSION vector`).

## 3) Packages

### 3.1) Server — `packages/server`
Node/TypeScript backend. Major responsibilities: HTTP endpoints (health, RAG ingest, Twilio webhooks), Socket.IO events, message/session persistence (Prisma), optional Kafka publishing, optional admin namespace, optional WhatsApp integration, optional RAG.

Key files:

- `package.json`
  - Scripts: `dev` (tsx watch), `build` (tsc), `start` (node dist), `prisma:gen`, `prisma:dev`, `prisma:studio`.
  - Dependencies: `fastify`, `@fastify/cors`, `@fastify/static`, `@fastify/formbody`, `socket.io`, `@prisma/client`, `dotenv`, `kafkajs`, `openai`, `twilio`, `pg`, `zod`.
- `.env`
  - Typical variables:
    - `PORT=3001`
    - `DATABASE_URL=postgres://...`
    - `CORS_ORIGIN_USER=http://localhost:5173`
    - `CORS_ORIGIN_AGENT=http://localhost:5174`
    - Optional Kafka: `KAFKA_BROKERS`, `KAFKA_CLIENT_ID`, `KAFKA_ENABLED`
    - Optional OpenAI: `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_EMBED_MODEL`
    - Optional Twilio WA: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `NGROK_BASE_URL`
    - Optional Admin: `ADMIN_ENABLED=true`
- `tsconfig.json`: Project config for TypeScript build.
- `prisma/schema.prisma`
  - Datasource: `postgresql` via `DATABASE_URL`.
  - Models:
    - `User`: Basic account with `role`, `displayName`, optional `email` and relations to sessions/assignments/handoffs/endRequests/summaries.
    - `Session`: Chat session lifecycle (`status` with defaults), timestamps, relations to `Message`, `HandoffRequest`, `AgentAssignment`, `EndChatRequest`, and `SessionSummary`.
    - `Message`: Per‑session messages; `senderType` is string (“user” | “agent” | “system”). Indexed by `(sessionId, createdAt)`/`(sessionId, id)`.
    - `HandoffRequest`: Queue item per session with optional acceptance metadata.
    - `AgentAssignment`: Tracks assignment windows.
    - `EndChatRequest`: User/agent initiated end request with triage status.
    - `SessionSummary`: Snapshots of conversation summary, topics[], counts, timings, and a `raw` JSON.
- `src/index.ts` (entry)
  - Fastify server:
    - Registers CORS for the two dev origins; serves static files from `src/public/` at root (`/`).
    - Registers `@fastify/formbody` for Twilio’s `application/x-www-form-urlencoded` webhooks.
    - `/health`: Returns `{ ok: true }`.
  - Socket.IO server attached to Fastify HTTP server.
  - Admin namespace (guarded by `ADMIN_ENABLED`):
    - Initializes via `initAdminNamespace(io)`.
    - Optionally fetches latest sessions and last‑message timestamps to emit `admin:bootstrap`.
  - Queue management:
    - Maintains a `queueCache` (`handoffRequestId -> { sessionId, preview, channel }`).
    - Agents subscribe to `room:agents:lobby` and receive `queue:new` items.
  - Twilio WhatsApp integration:
    - Controlled by `TWILIO_*` envs; if missing, logs and no‑ops for sends.
    - `/webhooks/twilio/status`: Logs delivery status callbacks.
    - `/webhooks/twilio/ping`: Simple XML response.
    - `handleTwilioWA(req,res)`: Main inbound WA webhook logic (creates/looks up session for a phone, persists messages, decides whether to escalate to agents, or replies via bot/RAG).
    - `sendWhatsAppText(toWhatsApp, text)`: Sends outbound WA messages (REST).
  - RAG endpoints:
    - `POST /ingest`: Kicks off site crawling and embedding; remembers domain per `sessionId` for contextual Q&A.
  - Kafka publishing (optional, see `src/kafka.ts`): Emits `SessionStarted` and `MessageCreated` envelopes when enabled.
  - Summarization utilities:
    - Builds a conversation summary (first user intent, duration, participants, topics heuristics), stores via `appendUserSummary` (see `src/storage/summaries.ts`), and can emit to admin.

- `src/admin-socket.ts`
  - Builds `/admin` Socket.IO namespace and exposes helpers:
    - `emitAdminBootstrap(payload)`
    - `emitAdminMessageNew(sessionId, message)`
    - `emitAdminSessionUpdate(sessionId, partial)`
    - `emitAdminSummary(sessionId, summary)`

- `src/kafka.ts`
  - Feature‑flagged: disabled unless `KAFKA_BROKERS` is set (or `KAFKA_ENABLED` explicitly true with brokers).
  - `initKafka()`: Lazily connects producer.
  - `publishSafe(topic, key, payload)`: Sends JSON; swallows failures and disables to keep chat unaffected.
  - `envelope(eventType, sessionId, data)`: Standardizes event.

- `src/channels/whatsapp.ts`
  - Standalone, in‑memory WhatsApp channel sample (Express typings). Manages sessions/messages/maps without DB for a simpler setup.
  - Twilio WA webhook `/twilio/whatsapp`:
    - Creates session on first contact, appends user messages, detects “wants human” to queue handoff, else replies via OpenAI.
  - Agent events:
    - `agent:claim`: Accept queued chat and emit `message:history` back.
    - `message:send`: Agent message relayed to WA.
    - `session:close`: Broadcast session closed.
  - Notes: The primary implementation is in `src/index.ts` with Prisma; this file acts as an alternative demo using in‑memory state.

- `src/public` (served at `/`)
  - `widget.html`: Small RAG chat UI: enter a site to index, ask questions with citations; posts `{ source:'rag-widget', type:'indexed', domain }` to parent.
  - `widget.js`: Floating widget script to embed on any site; spawns two buttons:
    - Site Chat (iframe to `widget.html` with optional `data-base` API).
    - WhatsApp link (prefills `join <code>` initially or `site <domain>` after index).
  - `admin/` (static admin viewer):
    - `index.html`: Loads Socket.IO client from CDN and `admin.js`.
    - `admin.js`: Connects to `/admin`, maintains sessions/messages (with dedupe), renders stats, filters, and history. Listens for:
      - `admin:bootstrap`, `admin:message:new`, `admin:session:update`, `message:history`, `admin:summary:ready`.
    - `admin.css`: Styles for header, stats, sidebar, messages, badges.

- `src/rag`
  - `service.ts`:
    - `ragInit()`: Ensures pgvector schema and indexes exist.
    - `ingestSite(site, maxPages)`: Crawls same‑domain pages, chunks content, embeds via OpenAI, stores into `RagPage`.
    - `ragChat({ sessionId, message, domain, k })`: Retrieves top‑k similar chunks, builds a [CONTEXT], calls OpenAI for concise reply with citations.
  - `db.ts`: Executes `CREATE EXTENSION IF NOT EXISTS vector;` and creates the `RagPage` table, indexes, and IVFFlat cosine index.
  - `crawler.ts`: Fetches pages (respecting domain), removes non‑content tags, extracts visible text and in‑domain links; throttled.
  - `llm.ts`: OpenAI client; `embedTexts`, `embedQuery`, `chatWithContext`. Models configurable via env.

- `src/storage/summaries.ts`
  - `appendUserSummary(userDisplayName, userId, entry)`: Upserts `SessionSummary` by `sessionId`, storing snapshot fields and raw JSON copy.

- `prisma/migrations/*`
  - Generated Prisma migrations creating/modifying Postgres schema as per `schema.prisma`.

- `dist/*`
  - Compiled JS/CSS outputs of the server and admin public assets (do not edit directly).

Environment & Ports:
- Server: `PORT` (default 3001), health at `/health`.
- CORS: `CORS_ORIGIN_USER=http://localhost:5173`, `CORS_ORIGIN_AGENT=http://localhost:5174`.
- DB: Point `DATABASE_URL` to the compose‑up Postgres.


### 3.2) Web User — `packages/web-user`
React + Vite application for end users.

Key files:
- `package.json`: Vite dev server on port 5173; React 18.
- `src/main.tsx`: React entry; wraps with `BrowserRouter`.
- `src/App.tsx`: Routes `/` to `Home`, `/chat` to `Chat`.
- `src/styles.css`: Page layout, hero, cards, FAB widget styles, reusable helpers.
- `src/lib/socket.ts`:
  - `getSocket()`: Singleton socket.io client to `VITE_SERVER_URL` (default `http://localhost:3001`).
- `src/lib/channels.ts`: Utilities to open WhatsApp with an optional join code.
- `src/components/ChannelCard.tsx`: Reusable UI card.
- `src/components/FloatingWidget.tsx`:
  - Floating Action Button that opens a mini menu for WhatsApp, SMS, and Live Web Chat.
  - WhatsApp link uses `VITE_WA_NUMBER` and `VITE_WA_JOIN_CODE` if provided.
  - SMS opens `sms:+<number>`.
  - Live Chat navigates to `/chat`.
- `src/pages/Home.tsx`:
  - Landing page with product copy and the floating widget mounted.
- `src/pages/Chat.tsx`:
  - Manages user chat lifecycle and UI banners:
    - Name gate (Start Chat), session creation (`session:create`), messaging (`message:send`), handoff (`handoff:request`), end flow (`session:end:request`).
    - Subscribes to server events: `message:history`, `message:new`, `handoff:accepted`, `session:closed`, `session:end:declined`.
    - De‑dupes messages by ID and avoids double listeners with ref guards.

Environment:
- `VITE_SERVER_URL` (default `http://localhost:3001`), `VITE_WA_NUMBER`, `VITE_WA_JOIN_CODE`, `VITE_SMS_NUMBER`.


### 3.3) Web Agent — `packages/web-agent`
React + Vite application for agents. Shows a queue, accept button, active conversations, message list, quick‑reply chips, and close/continue controls.

Key files:
- `package.json`: Vite dev server on port 5174; React 18.
- `src/main.tsx`: Mounts `<App/>`.
- `src/App.tsx`: Routes `/` to `Dashboard`.
- `src/styles.css`: Core layout, sidebar list, badges, messages, composer, quick‑reply styles.
- `src/lib/socket.ts`:
  - `getSocket()`: Singleton socket.io client to `VITE_SERVER_URL` (default `http://localhost:3001`).
- `src/lib/events.ts`: Centralized event names for queue/messages/end flow.
- `src/agent/AgentProvider.tsx` (core state + effects):
  - Context exposes: socket connection state, queue list, active list, selected conversation, per‑session messages, closed flags, end request map.
  - Listeners:
    - `queue:bootstrap`, `queue:new`, `queue:remove` (queue lifecycle)
    - `message:history`, `message:new` (messaging)
    - `session:closed` (terminal state)
    - `session:end:requested` (user asks to end; agent can accept/decline)
  - Actions:
    - `accept(handoffRequestId)`: Claims and moves conversation from queue to active; selects it.
    - `send(sessionId, text)`: Sends agent message.
    - `endNow(sessionId)`: Immediate end.
    - `endAccept(sessionId)`: Accepts user end request.
    - `endDecline(sessionId)`: Declines user end request and clears the banner locally.
- `src/ui/Header.tsx`: Shows total/waiting/active/avg stats (avg placeholder).
- `src/ui/Sidebar.tsx`:
  - Search, filter buttons (presentational), list of queued+active items.
  - Displays channel badge (Web/WhatsApp/SMS) and last text; allows Accept for queued.
- `src/ui/ChatPane.tsx`:
  - Shows selected conversation’s header (initials, name, channel), message list, quick buttons, composer, and end controls.

Environment:
- `VITE_SERVER_URL` (default `http://localhost:3001`).


## 4) Data Model (Prisma/Postgres)
- `User`: `{ id, role, displayName, email?, createdAt }` plus relations.
- `Session`: `{ id, status, userId?, createdAt, closedAt? }` plus relations.
- `Message`: `{ id, sessionId, senderType, text, createdAt, senderId? }`.
- `HandoffRequest`: `{ id, sessionId, requestedAt, acceptedAt?, acceptedById? }`.
- `AgentAssignment`: `{ id, agentId, sessionId, assignedAt, endedAt? }`.
- `EndChatRequest`: `{ id, sessionId, requestedAt, requestedBy, acceptedAt?, declinedAt?, acceptedById?, status }`.
- `SessionSummary`: `{ id, sessionId (unique), userId?, userDisplayName, agentDisplayName, summary, topics[], messageCount, startedAt, endedAt, endedBy, endRequestedBy?, raw, createdAt }`.


## 5) Socket.IO Events (Canonical)
Client → Server:
- `hello { role: 'user'|'agent', displayName? }`
- `session:create { displayName }`
- `session:join { sessionId }`
- `message:send { sessionId, text, senderType }`
- `handoff:request { sessionId }`
- `agent:claim { handoffRequestId }`
- `session:end:request { sessionId }`
- `session:end:accept { requestId }`
- `session:end:decline { requestId }`
- `session:close { sessionId }`

Server → Client:
- `message:history { sessionId, messages[] }`
- `message:new { id, sessionId, text, senderType, createdAt }`
- `queue:bootstrap [ { handoffRequestId, sessionId, preview[], channel } ]`
- `queue:new { handoffRequestId, sessionId, preview[], channel }`
- `queue:remove { handoffRequestId }`
- `handoff:accepted { sessionId, agentName }`
- `session:end:requested { sessionId, requestId, requestedBy }`
- `session:end:declined { sessionId }`
- `session:closed { sessionId }`

Admin namespace `/admin`:
- `admin:bootstrap { sessions, lastMsgs }`
- `admin:message:new { sessionId, message }`
- `admin:session:update { sessionId, ...partial }`
- `admin:summary:ready { sessionId, summary }`


## 6) RAG Subsystem (Optional)
- Endpoint `POST /ingest` indexes a website (crawl + embed) and stores in `RagPage` with `vector` embedding.
- `ragChat()` retrieves top‑k similar chunks and asks OpenAI to answer concisely with citations.
- Requires Postgres with `pgvector` extension and `OPENAI_API_KEY`.


## 7) WhatsApp Channel (Optional)
- Twilio config via env (`TWILIO_*`).
- Webhooks:
  - `/webhooks/twilio/ping` (test)
  - `/webhooks/twilio/status` (delivery updates)
  - Inbound handler (within `index.ts` function): persists user messages, can enqueue handoff when “wants human”, else replies via RAG.
- Outbound sends via Twilio REST (`sendWhatsAppText`).


## 8) Kafka Publishing (Optional)
- Enable by providing `KAFKA_BROKERS`. Config via `KAFKA_ENABLED`, `KAFKA_CLIENT_ID`.
- Events:
  - `SessionStarted` → `chat.sessions`
  - `MessageCreated` → `chat.messages`
- Fails closed (won’t break chat if Kafka is down).


## 9) Admin Viewer (Static)
- Served from `/admin/` path. No build step.
- Connects to `/admin` namespace and renders session list, stats, history.
- Designed for quick operational visibility in local dev.


## 10) Running Locally
1. Prereqs: Node.js 20+, pnpm, Docker (for Postgres).
2. Start DB: `docker compose up -d` at repo root.
3. Server env: create `packages/server/.env` with `DATABASE_URL`, `PORT`, `CORS_ORIGIN_*`, and optional toggles.
4. Install: `pnpm install` at repo root.
5. Prisma: `pnpm --filter @webchat/server prisma:gen && pnpm --filter @webchat/server prisma:dev`.
6. Run in three terminals:
   - `pnpm dev:server` → http://localhost:3001/health
   - `pnpm dev:user` → http://localhost:5173
   - `pnpm dev:agent` → http://localhost:5174


## 11) File Inventory (Authored/Relevant)
- Root:
  - `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `README.md`, `README-webchat.md`, `docker-compose.yml`
- `packages/server`:
  - `.env` (local)
  - `package.json`, `tsconfig.json`
  - `prisma/schema.prisma`, `prisma/migrations/*`
  - `src/index.ts`, `src/admin-socket.ts`, `src/kafka.ts`
  - `src/channels/whatsapp.ts`
  - `src/public/admin/{index.html,admin.js,admin.css}`
  - `src/public/{widget.html,widget.js, test_widget.html}`
  - `src/rag/{service.ts,db.ts, llm.ts, crawler.ts}`
  - `src/storage/summaries.ts`
  - `dist/**` (compiled)
- `packages/web-user`:
  - `package.json`, `tsconfig.json`
  - `src/{main.tsx,App.tsx,styles.css}`
  - `src/lib/{socket.ts,channels.ts}`
  - `src/components/{FloatingWidget.tsx,ChannelCard.tsx}`
  - `src/pages/{Home.tsx,Chat.tsx}`
- `packages/web-agent`:
  - `package.json`, `tsconfig.json`, `index.html`
  - `src/{main.tsx,App.tsx,styles.css}`
  - `src/lib/{events.ts,socket.ts}`
  - `src/agent/AgentProvider.tsx`
  - `src/ui/{Header.tsx,Sidebar.tsx,ChatPane.tsx}`

(Other directories like `node_modules/` and `dist/` are generated dependencies/outputs.)


## 12) Notes & Future Improvements
- Align READMEs to consistently reference Postgres (pgvector) rather than SQLite (now historical).
- Add authentication for agent and admin UIs.
- Add persistent queues and agent assignment constraints (skills, concurrency limits).
- Add tests for socket event flows and RAG integration stubs.
- Harden Twilio webhook verification and error handling.
- Improve admin stats (accurate AVG wait from DB, filters wired to queries).

