import { io, Socket } from "socket.io-client";

const API_BASE = (import.meta as any).env?.VITE_SERVER_URL || "http://localhost:3001";
let socket: Socket;

export const getSocket = (): Socket => {
  if (!socket) {
    socket = io(API_BASE, { withCredentials: true });
  }
  return socket;
};
