# webchat — live user↔agent chat with handoff (local, free, SQLite)

A minimal, **free** (no SaaS) live chat system where a **user** can chat, click **“Talk to a human”**, and an **agent** can see the queue with a **transcript preview**, accept the chat, and continue live in real time.  
This repo contains:

- **Server**: Node.js + Fastify + Socket.IO + Prisma + **SQLite**
- **Web User app**: React + Vite
- **Web Agent app**: React + Vite (queue + accept, shows full history on join)

> Scope is **local development only** (no Docker/Nginx/TLS). Easy to extend & deploy later.

---

## Features

- Realtime messaging (Socket.IO) between user and agent
- “Talk to a human” **handoff** with agent **queue** and transcript **preview**
- Agent “accept” assigns the session and loads **full history**
- Session lifecycle: `bot_pending` → `queued_for_agent` → `active_with_agent` → `closed`
- Simple, local auth model (anonymous user; implicit agent for dev)
- SQLite via Prisma; easily swappable to Postgres later
- Clean monorepo with pnpm workspaces

---

## Architecture

```
apps (React)
 ├─ packages/web-user  → chat UI for end users
 └─ packages/web-agent → queue + chat UI for agents

server (Node)
 └─ packages/server    → Fastify + Socket.IO + Prisma (SQLite)
       ├─ src/index.ts (socket events + minimal HTTP)
       └─ prisma/schema.prisma (data model)
```

### Data Model (Prisma / SQLite)

- **User**: `{ id, role: 'user'|'agent'|'admin', displayName, email?, createdAt }`
- **Session**: `{ id, status: 'bot_pending'|'queued_for_agent'|'active_with_agent'|'closed', userId?, createdAt, closedAt? }`
- **Message**: `{ id, sessionId, senderType: 'user'|'agent'|'system', text, createdAt }`
- **HandoffRequest**: `{ id, sessionId, requestedAt, acceptedAt?, acceptedById? }`
- **AgentAssignment**: `{ id, agentId, sessionId, assignedAt, endedAt? }`

> Note: SQLite does not support Prisma **enums**, so we use `String` fields with defaults.

### Realtime Channels & Events (Socket.IO)

**Rooms**
- `public:session:{sessionId}` — both user & agent join this for live messages
- `room:agents:lobby` — agents in the queue lobby

**Client → Server**
- `hello { role: 'user'|'agent', displayName? }`
- `session:create { displayName }` → creates user + session and joins room
- `session:join { sessionId }` → agent joins a room for an existing session
- `message:send { sessionId, text, senderType }`
- `handoff:request { sessionId }` → puts session in agent queue with preview
- `agent:claim { handoffRequestId }` → assigns session to this agent
- `typing { sessionId, actor: 'user'|'agent' }`
- `session:close { sessionId }` (optional add-on)

**Server → Client**
- `message:history { sessionId, messages[] }` (sent on join or accept)
- `message:new { ...message }`
- `queue:new { handoffRequestId, sessionId, preview: Message[] }` (to lobby)
- `handoff:accepted { sessionId, agentName }`
- `typing { sessionId, actor }`
- `session:closed { sessionId }` (optional add-on)

**HTTP**
- `GET /health` → `{ ok: true }` for liveness checks

### Handoff Flow

1. User chats → clicks **“Talk to a human”**.
2. Server marks session `queued_for_agent`, creates a `HandoffRequest`, emits `queue:new` to the **agents lobby** with a short **preview**.
3. An agent clicks **Accept** → server **atomically** assigns the session, sets status `active_with_agent`, joins the session room, and sends **full transcript** to the agent with `message:history`.
4. Both sides continue chatting live in `public:session:{id}`.

---

## Packages

**Server**
- [`fastify@4.x`](https://www.fastify.io/) – HTTP server
- [`@fastify/cors@8.x`](https://github.com/fastify/fastify-cors) – CORS (compatible with Fastify v4)
- [`socket.io@4.x`](https://socket.io/) – websockets
- [`prisma@5.x`](https://www.prisma.io/) + [`@prisma/client@5.x`] – ORM
- [`dotenv`](https://github.com/motdotla/dotenv) – load `.env`

**Frontend**
- [`react@18`](https://react.dev/), [`react-dom@18`]
- [`vite@5`](https://vitejs.dev/) – dev server/bundler
- [`socket.io-client@4.x`]

**Repo tooling**
- [`pnpm@9`](https://pnpm.io/) – workspaces + fast installs
- `prettier`, `concurrently` (optional helper)

---

## Requirements

- **Node.js 20+** (use **nvm** or **nvm-windows** to isolate):
  - Windows: https://github.com/coreybutler/nvm-windows
  - macOS/Linux: https://github.com/nvm-sh/nvm
- **pnpm**: `npm i -g pnpm`

---

## Getting Started (Windows/macOS/Linux)

> On Windows, use **PowerShell**. On macOS/Linux, use your terminal.

### 1) Ensure pnpm workspace file exists

Create **`pnpm-workspace.yaml`** at the repo root:

```yaml
packages:
  - "packages/*"
```

### 2) Install dependencies (root)

```bash
pnpm install
```

### 3) Configure server environment

Create `packages/server/.env`:

```env
DATABASE_URL="file:./prisma/dev.db"
PORT=3001
CORS_ORIGIN_USER=http://localhost:5173
CORS_ORIGIN_AGENT=http://localhost:5174
```

### 4) Generate Prisma client & migrate (create SQLite DB)

```bash
pnpm --filter @webchat/server prisma:gen
pnpm --filter @webchat/server prisma:dev
# This creates packages/server/prisma/dev.db and applies the schema
```

> If you prefer inside the server folder:
> ```bash
> cd packages/server
> pnpm install
> npx prisma generate
> npx prisma migrate dev --name init
> ```

### 5) Run (three terminals)

```bash
# Terminal A (server)
pnpm dev:server
# → http://localhost:3001/health

# Terminal B (user app)
pnpm dev:user
# → http://localhost:5173

# Terminal C (agent app)
pnpm dev:agent
# → http://localhost:5174
```

---

## Using the Apps

1. Open **User app** → enter a name → **Start Chat** → send messages.  
   Click **“Talk to a human”** to queue a handoff.

2. Open **Agent app** → you’ll see **Queued handoffs** with:
   - `sessionId`
   - `handoffRequestId`
   - last few messages (**preview**)

3. Click **Accept** on a queue card → the agent joins the session:  
   - Full **history** loads
   - Both sides chat live in real time

---

## Configuration & Scripts

### Repo scripts (root `package.json`)
- `dev:server` → run API (Fastify + Socket.IO) on **3001**
- `dev:user` → run user web app (Vite) on **5173**
- `dev:agent` → run agent web app (Vite) on **5174**
- `format` → `prettier -w .`

### Server scripts (`packages/server/package.json`)
- `dev` → `tsx watch src/index.ts`
- `build` → TypeScript build
- `start` → run built JS
- `prisma:gen` → `prisma generate`
- `prisma:dev` → `prisma migrate dev --name init`
- `prisma:studio` → open Prisma DB UI (optional)

---

## Project Structure

```
webchat/
├─ pnpm-workspace.yaml
├─ package.json
├─ tsconfig.base.json
├─ packages/
│  ├─ server/
│  │  ├─ .env
│  │  ├─ package.json
│  │  ├─ prisma/
│  │  │  └─ schema.prisma
│  │  └─ src/
│  │     └─ index.ts
│  ├─ web-user/
│  │  ├─ package.json
│  │  ├─ index.html
│  │  └─ src/
│  │     ├─ main.tsx
│  │     └─ App.tsx
│  └─ web-agent/
│     ├─ package.json
│     ├─ index.html
│     └─ src/
│        ├─ main.tsx
│        └─ App.tsx
```

---

## Implementation Notes

### Backend (Fastify + Socket.IO)
- Fastify provides a small HTTP surface (`/health`) and the server instance used by Socket.IO.
- Socket.IO handles client identification (`hello`), room subscription, message broadcast, and queue events.
- **CORS** configured to allow the two local Vite dev servers.

### Database (Prisma + SQLite)
- Single-file dev DB at `packages/server/prisma/dev.db`.
- No SQL schema hand-writing; Prisma manages migrations.
- Status/role/senderType stored as **strings** (SQLite has no native enums).
- Index on `{ sessionId, createdAt }` for fast transcript fetch.

### Websockets (Socket.IO)
- Each session has a **public room** (`public:session:{id}`) where the user and the assigned agent exchange messages.
- Agents also join the **lobby room** (`room:agents:lobby`) to receive `queue:new`.
- On **handoff**, agents receive a minimal **preview** first; on **accept**, the **full history** is loaded.

---

## Common Troubleshooting

- **pnpm warns about workspaces**  
  Create `pnpm-workspace.yaml` at the root (see above).

- **`'prisma' is not recognized`**  
  Run `pnpm install` at the **repo root**. Then:  
  `pnpm --filter @webchat/server prisma:gen` and `pnpm --filter @webchat/server prisma:dev`  
  (Or inside `packages/server`: `npx prisma generate`, `npx prisma migrate dev --name init`)

- **Prisma enum error on SQLite**  
  SQLite doesn’t support Prisma enums; this project uses **string** fields instead.

- **Fastify plugin mismatch** (e.g., `@fastify/cors` expects v5)  
  Use `@fastify/cors@8` with Fastify v4, or upgrade both to v5/v10 respectively:
  - Keep v4: `pnpm --filter @webchat/server add @fastify/cors@8`
  - Upgrade: `pnpm --filter @webchat/server add fastify@^5 @fastify/cors@^10`

- **Vite “Unexpected {”** in TSX  
  JSX/TSX uses single `{ ... }` (not `{{ ... }}`); ensure React files don’t contain doubled braces.

---

## Security & Privacy (local)

- Inputs sanitized; plain-text storage of messages in SQLite for dev.
- No external calls or third-party backends.
- If you enable attachments later, restrict MIME types and size.

---

## Roadmap (optional next steps)

- **Typing indicators** and **End chat** (code snippets ready)
- **Agent login** (simple local users table + bcrypt)
- **No-agent-online** capture form (store contact in session)
- **Deployment** (Nginx + Let’s Encrypt + optional Docker Compose)
- **Voice** (later): WebRTC + TURN (coturn) if needed

---

## Switching to Postgres (later)

1. Install Postgres & create a DB.
2. Change `DATABASE_URL` in `packages/server/.env`:
   ```
   DATABASE_URL="postgresql://USER:PASS@localhost:5432/webchat?schema=public"
   ```
3. Run:
   ```bash
   pnpm --filter @webchat/server prisma:dev
   ```
4. Start apps as usual.

---

## License

Internal / demo use. Add your own license if needed.
