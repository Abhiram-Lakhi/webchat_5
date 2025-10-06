// packages/web-user/src/lib/socket.ts
import { io, Socket } from "socket.io-client";
import { getSavedSessionId } from "./session";

const API_BASE = (import.meta as any).env?.VITE_SERVER_URL || "http://localhost:3001";

let socket: Socket;

// ensure single instance across HMR
export const getSocket = (): Socket => {
  if (!socket) {
    socket = io(API_BASE, { withCredentials: true });

    // ⬇️ If a sessionId exists, rejoin on connect so server can send history
    socket.on('connect', () => {
      const sessionId = getSavedSessionId();
      if (sessionId) {
        socket.emit('session:join', { sessionId }); // server should respond with message:history
      }
    });
  }
  return socket;
};
