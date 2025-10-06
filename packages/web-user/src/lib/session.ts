// packages/web-user/src/lib/session.ts
export const SESSION_KEY = 'webchat:sessionId';
export const DISPLAY_NAME_KEY = 'webchat:displayName';

export function getSavedSessionId(): string | null {
  try { return localStorage.getItem(SESSION_KEY); } catch { return null; }
}

export function saveSessionId(id: string) {
  try { localStorage.setItem(SESSION_KEY, id); } catch {}
}

export function clearSessionId() {
  try { localStorage.removeItem(SESSION_KEY); } catch {}
}

export function getSavedDisplayName(): string | null {
  try { return localStorage.getItem(DISPLAY_NAME_KEY); } catch { return null; }
}

export function saveDisplayName(name: string) {
  try { localStorage.setItem(DISPLAY_NAME_KEY, name); } catch {}
}

export function clearDisplayName() {
  try { localStorage.removeItem(DISPLAY_NAME_KEY); } catch {}
}
