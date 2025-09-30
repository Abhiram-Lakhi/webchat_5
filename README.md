
# webchat (local-only, SQLite, no infra)

## Prereqs
- Node.js 20+ (use nvm to isolate)
- pnpm (`npm i -g pnpm`)

## Setup
```bash
pnpm i
cd packages/server
pnpm prisma:gen
pnpm prisma:dev
```

## Run (three terminals)
```bash
pnpm dev:server
pnpm dev:user
pnpm dev:agent
```
- Server: http://localhost:3001/health
- User app: http://localhost:5173
- Agent app: http://localhost:5174

## Flow
1. In **User app**: enter a name -> **Start Chat** -> send a few messages.
2. Click **Talk to a human** -> this creates a handoff request.
3. In **Agent app**: open DevTools Console; you'll see `queue:new` events printed.
   Copy the `handoffRequestId` from the payload and run:
   ```js
   socket.emit('agent:claim', { handoffRequestId: 'PASTE_ID' }, console.log)
   ```
4. The agent joins the session and sees full history; both sides can chat live.

> This is a minimal scaffold for clarity. You can polish the Agent UI to list the queue and add an "Accept" button easily.
