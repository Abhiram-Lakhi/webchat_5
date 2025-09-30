// packages/server/src/admin-socket.ts
import type { Server, Namespace } from 'socket.io';

let nspRef: Namespace | null = null;

export function initAdminNamespace(io: Server) {
  if (nspRef) return nspRef;
  const nsp = io.of('/admin');
  nsp.on('connection', (socket) => {
    socket.on('admin:join', ({ sessionId }) => {
      if (sessionId) socket.join(`session:${sessionId}`);
    });
    // bootstrap is emitted from index.ts after DB query
  });
  nspRef = nsp;
  return nsp;
}

export function emitAdminBootstrap(payload: any) {
  nspRef?.emit('admin:bootstrap', payload);
}

export function emitAdminMessageNew(sessionId: string, messageRow: any) {
  nspRef?.to(`session:${sessionId}`).emit('admin:message:new', { sessionId, message: messageRow });
  nspRef?.emit('admin:message:new', { sessionId, message: messageRow });
}

export function emitAdminSessionUpdate(sessionId: string, partial: any) {
  nspRef?.emit('admin:session:update', { sessionId, ...partial });
}

export function emitAdminSummary(sessionId: string, summary: any) {
  nspRef?.emit('admin:summary:ready', { sessionId, summary });
}
