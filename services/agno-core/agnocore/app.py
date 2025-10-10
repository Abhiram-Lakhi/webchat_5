# services/agno-core/agnocore/app.py
import os
from typing import List, Optional, Dict, Any, Tuple
from datetime import datetime, timezone

from fastapi import FastAPI
from pydantic import BaseModel
from dotenv import load_dotenv

# Agno
from agno.agent import Agent
from agno.models.openai import OpenAIChat
from agno.tools.duckduckgo import DuckDuckGoTools
from agno.db.postgres import PostgresDb

# URL parsing for DB URL normalization
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse, quote_plus

# Postgres driver
import psycopg

load_dotenv()
app = FastAPI(title="agno-core", version="0.3.0")

DEFAULT_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

# ---- Normalize DATABASE_URL for psycopg (Prisma uses ?schema=..., psycopg doesn't) ----
RAW_DB_URL = os.getenv("DATABASE_URL")
if not RAW_DB_URL:
    raise RuntimeError("DATABASE_URL not set for agno-core")

from urllib.parse import urlparse, parse_qs, urlencode, urlunparse, quote  # <-- note: quote, not quote_plus

def normalize_pg_url(url: str) -> str:
    """
    Convert Prisma-style '?schema=xxx' to psycopg-compatible 'options=-c search_path=xxx'.
    Spaces must be %20 (NOT '+') for libpq.
    """
    u = urlparse(url)
    q = parse_qs(u.query, keep_blank_values=True)

    schema = None
    if "schema" in q and q["schema"]:
        schema = q["schema"][0]
        del q["schema"]

    if schema:
        opt_val = f"-c search_path={schema}"
        if "options" in q and q["options"]:
            q["options"][0] = (q["options"][0] + " " + opt_val).strip()
        else:
            q["options"] = [opt_val]

    # IMPORTANT: use quote (spaces -> %20), NOT quote_plus (spaces -> '+')
    new_query = urlencode({k: v[0] for k, v in q.items()}, quote_via=quote)
    return urlunparse((u.scheme, u.netloc, u.path, u.params, new_query, u.fragment))


DB_URL = normalize_pg_url(RAW_DB_URL)

# --- Agno's own session db (kept so future Agno features can use it) ---
agno_db = PostgresDb(
    db_url=DB_URL,               # use normalized URL here too
    session_table="agno_sessions",
    memory_table="agno_memories_agno"  # not used directly by us; safe to keep
)

# --- Our durable memory table (simple & robust) ---
CREATE_MEM_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS agno_memories (
  id            BIGSERIAL PRIMARY KEY,
  user_id       TEXT NOT NULL,
  session_id    TEXT NOT NULL,
  actor         TEXT NOT NULL,          -- 'user' | 'agent' | 'bot'
  text          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agno_mem_user ON agno_memories(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agno_mem_session ON agno_memories(session_id, created_at DESC);
"""

def get_conn():
    return psycopg.connect(DB_URL)

def ensure_tables():
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(CREATE_MEM_TABLE_SQL)

ensure_tables()


# --------- Schemas ---------
class Msg(BaseModel):
    role: str   # 'user' | 'assistant' | 'system'
    content: str

class AnswerReq(BaseModel):
    sessionId: str
    userId: str
    messages: List[Msg]
    context: Optional[Dict[str, Any]] = None

class AnswerRes(BaseModel):
    text: str
    sources: List[Dict[str, str]] = []

class MemoryUpdateReq(BaseModel):
    sessionId: str
    userId: str
    actor: str   # 'user' | 'agent' | 'bot'
    text: str
    ts: Optional[str] = None

class SuggestReq(BaseModel):
    sessionId: str
    userId: str
    lastMessages: List[Msg]
    max: int = 3

class SuggestRes(BaseModel):
    suggestions: List[str]

# --------- Durable memory helpers ---------
def remember_row(user_id: str, session_id: str, actor: str, text: str):
    if not text.strip():
        return
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO agno_memories (user_id, session_id, actor, text, created_at) VALUES (%s, %s, %s, %s, %s)",
            (user_id, session_id, actor, text, datetime.now(timezone.utc)),
        )

def load_recent_memories(user_id: str, limit: int = 50) -> List[Tuple[str, str, str, datetime]]:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT session_id, actor, text, created_at FROM agno_memories WHERE user_id=%s ORDER BY created_at DESC LIMIT %s",
            (user_id, limit),
        )
        return list(cur.fetchall())

def format_memory_block(user_id: str, limit: int = 50) -> str:
    rows = load_recent_memories(user_id, limit=limit)
    if not rows:
        return ""
    rows = list(reversed(rows))  # present oldest->newest
    lines = [f"Known persistent facts for user {user_id} (from prior sessions):"]
    for sess, actor, text, ts in rows:
        t = ts.strftime("%Y-%m-%d %H:%M")
        lines.append(f"- [{t}] ({actor}) S:{sess}: {text}")
    return "\n".join(lines) + "\n\n"

# --------- Two agent factories (as in your screenshot idea) ---------
def build_chat_agent(session_id: str, user_id: str) -> Agent:
    """Primary chat agent that answers end-users."""
    return Agent(
        name="webchat_chat_agent",
        session_id=session_id,
        user_id=user_id,
        model=OpenAIChat(id=DEFAULT_MODEL),
        tools=[DuckDuckGoTools()],
        db=agno_db,
        markdown=True,
    )

def build_coach_agent(session_id: str, user_id: str) -> Agent:
    """Secondary agent specialized for coaching suggestions to human agents."""
    return Agent(
        name="webchat_coach_agent",
        session_id=session_id,
        user_id=user_id,
        model=OpenAIChat(id=DEFAULT_MODEL),
        tools=[DuckDuckGoTools()],
        db=agno_db,
        markdown=True,
    )

# --------- Prompt helper ---------
def as_chat_prompt(history: List[Msg], context: Optional[Dict[str, Any]], memory_block: str) -> str:
    ctx = ""
    if context:
        ctx_lines = [f"{k}: {v}" for k, v in context.items()]
        ctx = "Context:\n" + "\n".join(ctx_lines) + "\n\n"

    lines = []
    for m in history[-12:]:
        role = m.role.lower()
        if role == "system":
            lines.append(f"SYSTEM: {m.content}")
        elif role in ("assistant", "agent", "bot"):
            lines.append(f"ASSISTANT: {m.content}")
        else:
            lines.append(f"USER: {m.content}")
    if not lines:
        lines = ["USER: Hello"]

    instr = (
        "You are WebChat's helpful assistant. Use the MEMORY section as ground truth about the user "
        "whenever relevant. Be concise and factual. If unsure, say you’re not sure."
    )

    mem = f"MEMORY:\n{memory_block}\n" if memory_block else ""
    return f"{ctx}{mem}{instr}\n\n" + "\n".join(lines) + "\n\nASSISTANT:"

# --------- Endpoints ---------
@app.get("/ai/health")
def health():
    return {"ok": True, "model": DEFAULT_MODEL}

@app.post("/ai/answer", response_model=AnswerRes)
def answer(req: AnswerReq):
    memory_block = format_memory_block(req.userId, limit=50)
    agent = build_chat_agent(req.sessionId, req.userId)
    prompt = as_chat_prompt(req.messages, req.context, memory_block)

    result = agent.run(prompt)

    # ---- extract final text robustly ----
    def extract_text(run) -> str:
        for attr in ("content", "output_text", "text"):
            v = getattr(run, attr, None)
            if isinstance(v, str) and v.strip():
                return v.strip()
        # as a fallback, try last assistant message
        try:
            msgs = getattr(run, "messages", None)
            if msgs:
                for m in reversed(msgs):
                    if getattr(m, "role", "") == "assistant":
                        c = getattr(m, "content", "")
                        if isinstance(c, str) and c.strip():
                            return c.strip()
        except Exception:
            pass
        # last resort
        return str(run)

    text = extract_text(result)

    # optional: pull tool sources if any
    sources: List[Dict[str, str]] = []
    try:
        if hasattr(result, "sources") and isinstance(result.sources, list):
            for s in result.sources:
                title = (s.get("title") or s.get("snippet") or "source")
                url = s.get("href") or s.get("url")
                if url:
                    sources.append({"title": str(title), "url": str(url)})
    except Exception:
        pass

    return AnswerRes(text=text, sources=sources)


@app.post("/ai/memory_update")
def memory_update(req: MemoryUpdateReq):
    # Persist every turn as durable memory
    remember_row(req.userId, req.sessionId, req.actor, req.text)
    # Best-effort to feed Agno's internal memory if supported
    try:
        ag = build_chat_agent(req.sessionId, req.userId)
        if hasattr(ag, "remember"):
            ag.remember(f"[{req.actor}] {req.text}")  # type: ignore[attr-defined]
        elif hasattr(ag, "memory") and hasattr(ag.memory, "remember"):
            ag.memory.remember(f"[{req.actor}] {req.text}")  # type: ignore[attr-defined]
    except Exception:
        pass
    return {"ok": True}

@app.post("/ai/suggest", response_model=SuggestRes)
def suggest(req: SuggestReq):
    agent = build_coach_agent(req.sessionId, req.userId)
    tail = "\n".join([f"{m.role.upper()}: {m.content}" for m in req.lastMessages[-8:]])
    coach = (
        "You assist a human support agent in a live chat.\n"
        f"From the recent thread below, propose up to {req.max} concise next-message suggestions.\n"
        "- Max 25 words each\n- Helpful, specific, and polite\n"
        "- No preambles or numbering, just the suggestions\n"
        "- Don't repeat the user's words\n\nThread:\n"
    )
    plan = agent.run(coach + tail)
    raw = str(plan).strip()
    candidates = [s.strip(" -•\t\r\n") for s in raw.split("\n") if s.strip()]
    suggestions = [c for c in candidates if 3 <= len(c.split()) <= 25][: req.max]
    if not suggestions:
        suggestions = [raw[:120]]
    return SuggestRes(suggestions=suggestions)

def run():
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "7001")))
