import React from "react";
import type { Socket } from "socket.io-client";
import { getSocket } from "../lib/socket";
import { EVENTS } from "../lib/events";

export type Message = { id:string; sessionId:string; text:string; senderType:"user"|"agent"|"system"; createdAt:string; };
export type Channel = "web"|"whatsapp"|"sms";
export type Conversation = {
  sessionId: string;
  handoffRequestId?: string;
  name: string;
  channel: Channel;
  phone?: string;
  lastText?: string;
  waiting?: boolean;
};

type Ctx = {
  socket: Socket;
  connected: boolean;

  queue: Conversation[];
  active: Conversation[];
  selected?: Conversation;
  select: (c: Conversation) => void;

  messages: Record<string, Message[]>;
  closed: Record<string, boolean>;
  endRequests: Record<string, string | undefined>;

  accept: (handoffRequestId: string, meta: Partial<Conversation>) => void;
  send: (sessionId: string, text: string) => void;
  endNow: (sessionId: string) => void;
  endAccept: (sessionId: string) => void;
  endDecline: (sessionId: string) => void;
};

const AgentContext = React.createContext<Ctx | null>(null);
export const useAgent = () => {
  const c = React.useContext(AgentContext);
  if (!c) throw new Error("useAgent must be used within AgentProvider");
  return c;
};

export const AgentProvider: React.FC<{children: React.ReactNode}> = ({ children }) => {
  const socket = getSocket();
  const [connected, setConnected] = React.useState(false);

  const [queue, setQueue] = React.useState<Conversation[]>([]);
  const [active, setActive] = React.useState<Conversation[]>([]);
  const [selected, setSelected] = React.useState<Conversation | undefined>(undefined);
  const [messages, setMessages] = React.useState<Record<string, Message[]>>({});
  const [closed, setClosed] = React.useState<Record<string, boolean>>({});
  const [endRequests, setEndRequests] = React.useState<Record<string, string|undefined>>({});

  const upsert = (list: Conversation[], c: Conversation) => {
    const i = list.findIndex(x => x.sessionId === c.sessionId);
    if (i === -1) return [c, ...list];
    const copy = list.slice(); copy[i] = { ...copy[i], ...c }; return copy;
  };

  React.useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      socket.emit(EVENTS.HELLO, { role: "agent", displayName: "Agent One" });
      // server will send queue via queue:bootstrap
    };
    const onDisconnect = () => setConnected(false);

    // IMPORTANT: include channel coming from server (web | whatsapp | sms)
    const onBootstrap = (items: Array<{handoffRequestId:string; sessionId:string; preview:Message[]; channel?: Channel}>) => {
      const mapped = items.map(it => ({
        sessionId: it.sessionId,
        handoffRequestId: it.handoffRequestId,
        name: "Visitor",
        channel: (it.channel || "web") as Channel,
        lastText: it.preview?.[it.preview.length-1]?.text || "",
        waiting: true
      }));
      setQueue(mapped);
    };

    // IMPORTANT: include channel here too
    const onQueueNew = (it: {handoffRequestId:string; sessionId:string; preview:Message[]; channel?: Channel}) => {
      setQueue(prev => prev.some(x => x.handoffRequestId === it.handoffRequestId)
        ? prev
        : [{
            sessionId: it.sessionId,
            handoffRequestId: it.handoffRequestId,
            name: "Visitor",
            channel: (it.channel || "web") as Channel,
            lastText: it.preview?.[it.preview.length-1]?.text,
            waiting: true
          },
          ...prev
        ]);
    };

    const onQueueRemove = (p:{handoffRequestId:string}) => {
      setQueue(prev => prev.filter(x => x.handoffRequestId !== p.handoffRequestId));
    };

    const onHistory = (p:{sessionId:string; messages:Message[]}) => {
      setMessages(prev => ({ ...prev, [p.sessionId]: p.messages || [] }));
      setClosed(prev => ({ ...prev, [p.sessionId]: false }));
    };

    const onNew = (m: Message) => {
      setMessages(prev => ({ ...prev, [m.sessionId]: [...(prev[m.sessionId]||[]), m] }));
      setActive(prev => prev.map(c => c.sessionId === m.sessionId ? { ...c, lastText: m.text } : c));
      setQueue(prev => prev.map(c => c.sessionId === m.sessionId ? { ...c, lastText: m.text } : c));
    };

    const onClosed = (p:{sessionId:string}) => {
      setClosed(prev => ({ ...prev, [p.sessionId]: true }));
      setEndRequests(prev => ({ ...prev, [p.sessionId]: undefined }));

      // if currently selected, keep it selected but it's closed now
      setActive(prev => prev.map(c => c.sessionId === p.sessionId ? { ...c } : c));
    };

    const onEndRequested = (p:{sessionId:string; requestId:string; requestedBy:"user"|"agent"}) => {
      setEndRequests(prev => ({ ...prev, [p.sessionId]: p.requestId }));
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on(EVENTS.QUEUE_BOOTSTRAP, onBootstrap);
    socket.on(EVENTS.QUEUE_NEW, onQueueNew);
    socket.on(EVENTS.QUEUE_REMOVE, onQueueRemove);
    socket.on(EVENTS.MESSAGE_HISTORY, onHistory);
    socket.on(EVENTS.MESSAGE_NEW, onNew);
    socket.on(EVENTS.SESSION_CLOSED, onClosed);
    socket.on(EVENTS.END_REQUESTED, onEndRequested);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off(EVENTS.QUEUE_BOOTSTRAP, onBootstrap);
      socket.off(EVENTS.QUEUE_NEW, onQueueNew);
      socket.off(EVENTS.QUEUE_REMOVE, onQueueRemove);
      socket.off(EVENTS.MESSAGE_HISTORY, onHistory);
      socket.off(EVENTS.MESSAGE_NEW, onNew);
      socket.off(EVENTS.SESSION_CLOSED, onClosed);
      socket.off(EVENTS.END_REQUESTED, onEndRequested);
    };
  }, [socket]);

  const accept = (handoffRequestId: string, meta: Partial<Conversation>) => {
    socket.emit(EVENTS.AGENT_CLAIM, { handoffRequestId }, (res:any) => {
      if (!res?.ok || !res.sessionId) { 
        if (res?.error === "already accepted") {
          setQueue(prev => prev.filter(x => x.handoffRequestId !== handoffRequestId));
        } else {
          alert(res?.error || "Failed to accept");
        }
        return;
      }
      const c: Conversation = {
        sessionId: res.sessionId,
        name: meta.name || "Visitor",
        channel: (meta.channel || "web") as Channel,
        phone: meta.phone,
        lastText: meta.lastText,
        waiting: false
      };
      setActive(prev => upsert(prev, c));
      setQueue(prev => prev.filter(x => x.handoffRequestId !== handoffRequestId));
      setSelected(c);
    });
  };

  const send = (sessionId: string, text: string) => {
    if (!text.trim() || closed[sessionId]) return;
    socket.emit(EVENTS.MESSAGE_SEND, { sessionId, text, senderType: "agent" });
  };

  const endNow = (sessionId:string) => {
    socket.emit(EVENTS.SESSION_CLOSE, { sessionId }, (res:any)=>{ if(!res?.ok) alert(res?.error || "Failed to end"); });
  };
  const endAccept = (sessionId:string) => {
    const id = endRequests[sessionId]; if (!id) return;
    socket.emit(EVENTS.END_ACCEPT, { requestId: id }, (res:any)=>{ if(!res?.ok) alert(res?.error || "Failed to accept end"); });
  };
  const endDecline = (sessionId:string) => {
    const id = endRequests[sessionId]; if (!id) return;
    socket.emit(EVENTS.END_DECLINE, { requestId: id }, (res:any)=>{ if(!res?.ok) alert(res?.error || "Failed to decline end"); else setEndRequests(p=>({ ...p, [sessionId]: undefined })); });
  };

  return (
    <AgentContext.Provider value={{
      socket, connected,
      queue, active, selected, select:setSelected,
      messages, closed, endRequests,
      accept, send, endNow, endAccept, endDecline
    }}>
      {children}
    </AgentContext.Provider>
  );
};
