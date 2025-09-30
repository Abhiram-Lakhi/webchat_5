// Simple, no-build Admin viewer with de-dup for messages.

const SERVER_ORIGIN = `${location.protocol}//${location.host}`; // e.g. http://localhost:3001
if (!window.io) {
  alert('Socket.IO client not loaded. Check your internet for https://cdn.socket.io/');
}

const socket = window.io(`${SERVER_ORIGIN}/admin`, {
  transports: ['websocket'],
  withCredentials: true,
});

// ---- DOM refs
const connDot = document.getElementById('connDot');
const connText = document.getElementById('connText');
const sessionList = document.getElementById('sessionList');
const searchInput = document.getElementById('search');
const filterChannel = document.getElementById('filterChannel');
const filterStatus = document.getElementById('filterStatus');
const sortOrder = document.getElementById('sortOrder');
const statTotal = document.getElementById('statTotal');
const statWaiting = document.getElementById('statWaiting');
const statActive = document.getElementById('statActive');
const statAvgWait = document.getElementById('statAvgWait');
const chatTitle = document.getElementById('chatTitle');
const chatMeta = document.getElementById('chatMeta');
const messagesEl = document.getElementById('messages');

// ---- State
const state = {
  sessions: /** @type {Record<string, any>} */ ({}),  // sessionId -> {id, status, channel, createdAt, endedAt, user?}
  messages: /** @type {Record<string, Array<any>>} */ ({}), // sessionId -> Message[]
  seen:     /** @type {Record<string, Set<string>>} */ ({}), // sessionId -> Set(messageKey)
  activeSessionId: null,
};

// ---- Helpers
function mapStatusToUi(s) {
  switch (s) {
    case 'queued_for_agent':
    case 'bot_pending': return 'waiting';
    case 'active_with_agent': return 'active';
    case 'closed': return 'closed';
    default: return 'waiting';
  }
}
function fmtTime(ts) {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}
function minsBetween(a, b) {
  try {
    const ms = new Date(b).getTime() - new Date(a).getTime();
    return Math.max(0, Math.round(ms / 60000));
  } catch { return 0; }
}

// message key for dedupe: prefer id, else stable signature
function msgKey(m) {
  if (m?.id) return String(m.id);
  const t = m?.createdAt || m?.timestamp || 0;
  const who = m?.senderType || m?.sender || 'system';
  const text = (m?.text || m?.content || '').toString();
  return `${t}|${who}|${text}`; // good enough fallback
}

function ensureSessionMaps(sessionId) {
  if (!state.messages[sessionId]) state.messages[sessionId] = [];
  if (!state.seen[sessionId]) state.seen[sessionId] = new Set();
}

function addMessage(sessionId, m) {
  ensureSessionMaps(sessionId);
  const key = msgKey(m);
  if (state.seen[sessionId].has(key)) return; // already have it
  state.seen[sessionId].add(key);
  state.messages[sessionId].push(m);
}

function replaceHistory(sessionId, list) {
  ensureSessionMaps(sessionId);
  const s = new Set();
  const arr = [];
  for (const m of list || []) {
    const k = msgKey(m);
    if (s.has(k)) continue;
    s.add(k);
    arr.push(m);
  }
  state.seen[sessionId] = s;
  state.messages[sessionId] = arr;
}

function computeStats() {
  const list = Object.values(state.sessions);
  statTotal.textContent = String(list.length);
  const waiting = list.filter(x => mapStatusToUi(x.status) === 'waiting').length;
  const active = list.filter(x => mapStatusToUi(x.status) === 'active').length;
  statWaiting.textContent = String(waiting);
  statActive.textContent = String(active);

  const waits = list
    .filter(x => mapStatusToUi(x.status) === 'waiting' && x.createdAt)
    .map(x => minsBetween(x.createdAt, Date.now()));
  const avg = waits.length ? Math.round(waits.reduce((a,b)=>a+b,0) / waits.length) : 0;
  statAvgWait.textContent = `${avg}m`;
}

function renderSessions() {
  const q = (searchInput.value || '').toLowerCase();
  const ch = filterChannel.value;
  const st = filterStatus.value;
  const order = sortOrder.value;

  const arr = Object.values(state.sessions);
  arr.sort((a, b) => {
    const aT = a.lastMessageAt || a.createdAt || 0;
    const bT = b.lastMessageAt || b.createdAt || 0;
    return order === 'oldest' ? (aT > bT ? 1 : -1) : (aT > bT ? -1 : 1);
  });

  sessionList.innerHTML = '';
  for (const s of arr) {
    const uiStatus = mapStatusToUi(s.status);
    if (q) {
      const hay = `${s.id} ${s.user?.displayName || ''}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    if (ch && s.channel !== ch) continue;
    if (st && uiStatus !== st) continue;

    const li = document.createElement('li');
    li.className = `session ${state.activeSessionId === s.id ? 'active' : ''}`;
    li.dataset.id = s.id;
    li.innerHTML = `
      <div>
        <div class="session-title">${s.user?.displayName || 'User'} <span class="badge ${s.channel}">${s.channel || 'web'}</span></div>
        <div class="session-line">${uiStatus} • ${fmtTime(s.lastMessageAt || s.createdAt)}</div>
      </div>
      <div class="session-line">#${s.id.slice(0,6)}</div>
    `;
    li.onclick = () => selectSession(s.id);
    sessionList.appendChild(li);
  }
  computeStats();
}

function renderMessages(sessionId) {
  const msgs = state.messages[sessionId] || [];
  messagesEl.innerHTML = '';
  for (const m of msgs) {
    const who = m.senderType || m.sender || 'system';
    const cls =
      who === 'agent' ? 'agent' :
      who === 'user'  ? 'user'  : 'system';

    const div = document.createElement('div');
    div.className = `msg ${cls}`;
    div.innerHTML = `
      <div>${(m.text || m.content || '').toString()}</div>
      <div class="msg-meta">${who} • ${fmtTime(m.createdAt || m.timestamp || Date.now())}</div>
    `;
    messagesEl.appendChild(div);
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function selectSession(sessionId) {
  if (!sessionId) return;
  state.activeSessionId = sessionId;

  const s = state.sessions[sessionId];
  chatTitle.textContent = s ? (s.user?.displayName || `Session ${sessionId.slice(0,6)}`) : `Session ${sessionId.slice(0,6)}`;
  chatMeta.textContent = s ? `${mapStatusToUi(s.status)} • ${s.channel || 'web'} • started ${fmtTime(s.createdAt)}` : '';

  // ask server for history for this session (admin namespace)
  socket.emit('admin:join', { sessionId });
  renderSessions();       // refresh selection highlight
  renderMessages(sessionId);
}

// ---- Socket.IO events
socket.on('connect', () => {
  connDot.classList.remove('dot-off'); connDot.classList.add('dot-on');
  connText.textContent = 'Connected';
});
socket.on('disconnect', () => {
  connDot.classList.remove('dot-on'); connDot.classList.add('dot-off');
  connText.textContent = 'Disconnected';
});

// initial sessions and last-message timestamps
socket.on('admin:bootstrap', (payload) => {
  // payload: { sessions, lastMsgs: [{ sessionId, _max: { createdAt }}] }
  const lastMap = {};
  (payload.lastMsgs || []).forEach(x => { if (x && x.sessionId) lastMap[x.sessionId] = x._max?.createdAt; });

  (payload.sessions || []).forEach(row => {
    if (!row?.id) return;
    state.sessions[row.id] = {
      id: row.id,
      status: row.status,
      channel: row.channel || 'web',
      createdAt: row.createdAt,
      endedAt: row.closedAt || null,
      user: row.user || null,
      lastMessageAt: lastMap[row.id] || row.createdAt,
    };
  });
  renderSessions();
});

// new message persisted (deduped)
socket.on('admin:message:new', (ev) => {
  const { sessionId, message } = ev || {};
  if (!sessionId || !message) return;

  addMessage(sessionId, message);

  // bump lastMessageAt on the session
  if (state.sessions[sessionId]) {
    state.sessions[sessionId].lastMessageAt = message.createdAt || Date.now();
  }
  if (state.activeSessionId === sessionId) {
    renderMessages(sessionId);
  }
  renderSessions();
});

// status updates
socket.on('admin:session:update', (ev) => {
  const sid = ev?.sessionId;
  if (!sid) return;
  const existing = state.sessions[sid] || { id: sid };
  state.sessions[sid] = {
    ...existing,
    status: ev.status ?? existing.status,
    channel: ev.channel ?? existing.channel ?? 'web',
    createdAt: ev.createdAt ?? existing.createdAt,
    endedAt: ev.endedAt ?? existing.endedAt,
  };
  renderSessions();
});

// full history after join (replace & dedupe)
socket.on('message:history', (payload) => {
  const sid = payload?.sessionId;
  if (!sid) return;
  replaceHistory(sid, payload.messages || []);
  if (state.activeSessionId === sid) {
    renderMessages(sid);
  }
});

// optional summary event
socket.on('admin:summary:ready', (ev) => {
  console.log('[summary]', ev);
});

// ---- UI wire-up
[searchInput, filterChannel, filterStatus, sortOrder].forEach(el => {
  el.addEventListener('input', renderSessions);
  el.addEventListener('change', renderSessions);
});
