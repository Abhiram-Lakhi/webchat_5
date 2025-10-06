import React, { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { getSocket } from '../lib/socket';
import {
  getSavedSessionId, saveSessionId, clearSessionId,
  getSavedDisplayName, saveDisplayName, clearDisplayName
} from '../lib/session';

type Message = {
  id: string;
  sessionId: string;
  text: string;
  senderType: 'user'|'agent'|'system';
  createdAt: string;
};

export default function Chat() {
  const socket: Socket = getSocket();

  // name gate (hydrate from storage so label shows after reload)
  const [displayName, setDisplayName] = useState(getSavedDisplayName() || '');

  // initialize from localStorage so UI survives reload
  const initialSessionId = getSavedSessionId() || '';
  const [hasStarted, setHasStarted] = useState(!!initialSessionId);

  // chat state
  const [sessionId, setSessionId] = useState(initialSessionId);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [closed, setClosed] = useState(false);

  // UX banners
  const [queued, setQueued] = useState(false);
  const [agentActive, setAgentActive] = useState(false);
  const [agentName, setAgentName] = useState<string | null>(null);
  const [endRequested, setEndRequested] = useState(false);

  // prevent double listeners & provide message de-dup
  const listenersBound = useRef(false);
  const seenIds = useRef<Set<string>>(new Set());

  // hello once (role only; name will be sent at Start Chat)
  useEffect(() => {
    socket.emit('hello', { role: 'user' });
  }, [socket]);

  // if we already have a sessionId (from storage), ask the server for history once
  useEffect(() => {
    if (initialSessionId) {
      socket.emit('session:join', { sessionId: initialSessionId });
      setHasStarted(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (listenersBound.current) return;
    listenersBound.current = true;

    const onHistory = (p: { sessionId: string; messages: Message[] }) => {
      setSessionId(p.sessionId);
      saveSessionId(p.sessionId);
      setHasStarted(true);

      setMessages(p.messages || []);
      seenIds.current = new Set((p.messages || []).map(m => m.id));
      setClosed(false);
      setQueued(false);
      setAgentActive(false);
      setEndRequested(false);
    };

    const onNew = (m: Message) => {
      if (m.sessionId !== sessionId) return;
      if (seenIds.current.has(m.id)) return;
      seenIds.current.add(m.id);
      setMessages(v => [...v, m]);
    };

    const onAccepted = (p: { sessionId: string; agentName?: string }) => {
      if (p.sessionId !== sessionId) return;
      setQueued(false);
      setAgentActive(true);
      setAgentName(p.agentName || 'Agent');
    };

    const onClosed = (p: { sessionId: string }) => {
      if (p.sessionId !== sessionId) return;
      setClosed(true);
      setEndRequested(false);
      setQueued(false);
      setAgentActive(false);
      clearSessionId();
      clearDisplayName(); // clear saved name when chat ends
    };

    const onDeclined = (p: { sessionId: string }) => {
      if (p.sessionId !== sessionId) return;
      setEndRequested(false);
      alert('Agent chose to continue the chat.');
    };

    socket.on('message:history', onHistory);
    socket.on('message:new', onNew);
    socket.on('handoff:accepted', onAccepted);
    socket.on('session:closed', onClosed);
    socket.on('session:end:declined', onDeclined);

    return () => {
      socket.off('message:history', onHistory);
      socket.off('message:new', onNew);
      socket.off('handoff:accepted', onAccepted);
      socket.off('session:closed', onClosed);
      socket.off('session:end:declined', onDeclined);
      listenersBound.current = false;
    };
  }, [sessionId, socket]);

  const createSession = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const name = (displayName || '').trim();
    if (!name) return;

    // persist name so it survives refresh
    saveDisplayName(name);

    socket.emit('hello', { role: 'user', displayName: name });

    socket.emit('session:create', { displayName: name }, (res: any) => {
      if (res?.ok && res.sessionId) {
        saveSessionId(res.sessionId);
        setHasStarted(true);
        setSessionId(res.sessionId);
        setMessages([]);
        seenIds.current = new Set();
        setClosed(false);
        setQueued(false);
        setAgentActive(false);
        setEndRequested(false);

        socket.emit('session:join', { sessionId: res.sessionId });
      } else {
        alert(res?.error || 'Failed to start chat');
      }
    });
  };

  const sendMessage = () => {
    if (!input || !sessionId || closed) return;
    socket.emit('message:send', { sessionId, text: input, senderType: 'user' });
    setInput('');
  };

  const requestHandoff = () => {
    if (!sessionId || closed || agentActive) return;
    socket.emit('handoff:request', { sessionId }, (res: any) => {
      if (res?.ok) setQueued(true);
      else alert(res?.error || 'Failed to request agent');
    });
  };

  const requestEnd = () => {
    if (!sessionId || closed) return;
    socket.emit('session:end:request', { sessionId }, (res: any) => {
      if (res?.ok) setEndRequested(true);
      else alert(res?.error || 'Failed to request end');
    });
  };

  return (
    <div className="container" style={{ maxWidth: 720, margin: '0 auto', padding: 16 }}>
      <h1>@webchat/web-user</h1>

      {hasStarted && (
        <>
          <div style={{ marginBottom: 8, opacity: 0.8 }}>
            Session: <code>{sessionId}</code>
          </div>

          {queued && !closed && <div className="banner">Waiting for an agent to join…</div>}
          {agentActive && !closed && (
            <div className="banner">{agentName || 'Agent'} has joined the chat.</div>
          )}
          {endRequested && !closed && (
            <div className="banner">End chat requested — waiting for agent to confirm…</div>
          )}
          {closed && <div className="banner">The chat has been ended.</div>}

          <div style={{ border: '1px solid var(--border)', padding: 12, height: 360, overflow: 'auto', borderRadius: 12, background: 'var(--bg-elev)' }}>
            {messages.map(m => (
              <div key={m.id} style={{ marginBottom: 8 }}>
                <b>
                  {m.senderType === 'user'
                    ? (displayName || 'User')
                    : m.senderType === 'agent'
                    ? (agentName || 'Agent')
                    : 'system'}
                  :
                </b>{' '}
                {m.text}{' '}
                <small>({new Date(m.createdAt).toLocaleTimeString()})</small>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input
              style={{ flex: 1 }}
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={closed ? 'Chat is closed' : 'Type a message…'}
              disabled={closed}
              onKeyDown={e => (e.key === 'Enter' ? sendMessage() : null)}
            />
            <button onClick={sendMessage} disabled={closed}>Send</button>
            <button onClick={requestHandoff} disabled={closed || queued || agentActive}>
              {queued ? 'Waiting for agent…' : 'Talk to a human'}
            </button>
            <button onClick={requestEnd} disabled={closed || endRequested}>End chat</button>
          </div>
        </>
      )}

      {!hasStarted && (
        <div className="modal-backdrop">
          <form className="modal-card" onSubmit={createSession}>
            <h3 style={{ marginTop: 0, marginBottom: 8 }}>Welcome 👋</h3>
            <p style={{ marginTop: 0, color: 'var(--muted)' }}>What’s your name?</p>
            <input
              autoFocus
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Your name"
              type="text"
              style={{ marginBottom: 12 }}
            />
            <button type="submit" style={{ width: '100%' }}>Start Chat</button>
          </form>
        </div>
      )}
    </div>
  );
}
