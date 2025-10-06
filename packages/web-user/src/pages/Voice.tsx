// packages/web-user/src/pages/Voice.tsx
import React, { useMemo, useState } from 'react';
import { LiveKitRoom, useTracks, RoomAudioRenderer } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { getSavedDisplayName, getSavedSessionId, saveSessionId } from '../lib/session';

const API_BASE = (import.meta as any).env?.VITE_SERVER_URL || 'http://localhost:3001';

// Optional manual override via .env in packages/web-user/.env
const MANUAL_LIVEKIT_URL   = (import.meta as any).env?.VITE_LIVEKIT_URL || '';
const MANUAL_LIVEKIT_TOKEN = (import.meta as any).env?.VITE_LIVEKIT_TOKEN || '';

type TokenResp = {
  ok: boolean;
  token: string;
  roomName: string;
  sessionId: string;
  livekitUrl: string;
  error?: string;
};

function AssistantAudio() {
  useTracks([Track.Source.Microphone, Track.Source.Unknown]);
  return <RoomAudioRenderer />;
}

export default function Voice() {
  const [displayName, setDisplayName] = useState(getSavedDisplayName() || '');
  const [sessionId, setSessionId] = useState(getSavedSessionId() || '');
  const [token, setToken] = useState<string | null>(null);
  const [livekitUrl, setLivekitUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canStart = useMemo(() => !!displayName && !busy, [displayName, busy]);

  const startVoice = async () => {
    setBusy(true);
    setError(null);
    try {
      // Manual mode (env-provided token & URL)
      if (MANUAL_LIVEKIT_URL && MANUAL_LIVEKIT_TOKEN) {
        if (!sessionId) {
          const sid = `manual_${Date.now()}`;
          setSessionId(sid);
          saveSessionId(sid);
        }
        setLivekitUrl(MANUAL_LIVEKIT_URL);
        setToken(MANUAL_LIVEKIT_TOKEN);
        return;
      }

      // Server-issued token (recommended)
      const r = await fetch(`${API_BASE}/voice/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName, sessionId: sessionId || undefined }),
      });
      const data: TokenResp = await r.json();
      if (!data.ok) throw new Error(data.error || 'token error');

      if (!sessionId) {
        setSessionId(data.sessionId);
        saveSessionId(data.sessionId);
      }
      setLivekitUrl(data.livekitUrl);
      setToken(data.token);
    } catch (e: any) {
      setError(e?.message || 'failed to start voice');
    } finally {
      setBusy(false);
    }
  };

  if (token && livekitUrl) {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: 16 }}>
        <h1>Voice Chat</h1>
        <p style={{ opacity: 0.7 }}>
          Session: <code>{sessionId}</code>
        </p>
        <p style={{ fontSize: 12, opacity: 0.7 }}>
          Mode: <b>{MANUAL_LIVEKIT_TOKEN ? 'Manual token' : 'Server token'}</b>
        </p>

        <LiveKitRoom
          serverUrl={livekitUrl}
          token={token}
          connect={true}
          video={false}
          audio={true}
          onDisconnected={(reason) => {
            console.warn('LiveKit disconnected:', reason);
            setError(`Disconnected: ${String(reason || 'unknown')}`);
            setToken(null);
          }}
          onError={(err) => {
            console.error('LiveKit error:', err);
            setError(err?.message || String(err));
          }}
        >
          <AssistantAudio />
          <div style={{ marginTop: 16, opacity: 0.7 }}>
            Connected to LiveKit. Speak to start. (Assistant audio will play automatically.)
          </div>
          {error && <div style={{ marginTop: 12, color: 'crimson' }}>{error}</div>}
        </LiveKitRoom>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 520, margin: '64px auto', padding: 16 }}>
      <h1>Start Voice Chat</h1>

      <div style={{ fontSize: 12, marginBottom: 8, opacity: 0.7 }}>
        {MANUAL_LIVEKIT_TOKEN ? (
          <>Manual token mode is <b>enabled</b> (using <code>VITE_LIVEKIT_URL</code> / <code>VITE_LIVEKIT_TOKEN</code>).</>
        ) : (
          <>Will request a token from <code>{API_BASE}/voice/token</code>.</>
        )}
      </div>

      <label style={{ display: 'block', marginBottom: 8 }}>Your name</label>
      <input
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        placeholder="Your name"
        style={{ width: '100%', marginBottom: 12, padding: 8 }}
      />
      <button onClick={startVoice} disabled={!canStart} style={{ padding: '8px 14px' }}>
        {busy ? 'Starting…' : 'Start Voice Chat'}
      </button>
      {error && <div style={{ marginTop: 12, color: 'crimson' }}>{error}</div>}
    </div>
  );
}
