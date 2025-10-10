import os
from typing import List, Optional, Dict, Any

from fastapi import FastAPI
from pydantic import BaseModel
from dotenv import load_dotenv

# ---- Agno (STRICT, Postgres-only) ----
from agno.agent import Agent
from agno.models.openai import OpenAIChat
from agno.tools.duckduckgo import DuckDuckGoTools
from agno.storage.postgres import PostgresStorage
from agno.memory.postgres import PostgresMemoryDb


load_dotenv()
app = FastAPI(title="agno-core", version="0.1.0")

DEFAULT_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

# Connections
DB_URL = os.getenv("DATABASE_URL")
if not DB_URL:
    raise RuntimeError("DATABASE_URL not set for agno-core")

# Create shared Postgres-backed storage + memory databases for agents
storage = PostgresStorage(
    table_name="agno_sessions",        # will be created if missing
    db_url=DB_URL,
)
memory_db = PostgresMemoryDb(
    table_name="agno_memories",        # will be created if missing
    db_url=DB_URL,
)

# --------- Schemas ---------
class Msg(BaseModel):
    role: str
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

# --------- Agent factory ---------
def build_agent(session_id: str, user_id: str) -> Agent:
    return Agent(
        name="webchat_agent",
        session_id=session_id,
        user_id=user_id,
        model=OpenAIChat(id=DEFAULT_MODEL),
        tools=[DuckDuckGoTools()],
        add_history_to_messages=True,
        storage=storage,
        memory=memory_db,          # enables persistent, agentic memory in Postgres
        enable_agentic_memory=True,
    )

# --------- Endpoints ---------
@app.get("/ai/health")
def health():
    return {"ok": True}

@app.post("/ai/answer", response_model=AnswerRes)
def answer(req: AnswerReq):
    agent = build_agent(req.sessionId, req.userId)

    # Make a single user prompt from provided history (agent has storage+memory)
    user_turns = [m.content for m in req.messages if m.role == "user"]
    prompt = "\n\n".join(user_turns) if user_turns else "Hello"

    # Optional domain/context preface
    if req.context:
        ctx_lines = [f"{k}: {v}" for k, v in req.context.items()]
        context_block = "Context:\n" + "\n".join(ctx_lines) + "\n\n"
    else:
        context_block = ""

    result = agent.run(context_block + prompt)

    # Try to collect any sources from tools (best-effort; keep shape stable)
    sources: List[Dict[str, str]] = []
    if hasattr(result, "sources") and isinstance(result.sources, list):
        for s in result.sources:
            title = s.get("title") or s.get("snippet") or "source"
            url = s.get("href") or s.get("url")
            if url:
                sources.append({"title": str(title), "url": str(url)})

    return AnswerRes(text=str(result), sources=sources)

@app.post("/ai/memory_update")
def memory_update(req: MemoryUpdateReq):
    # We invoke the agent to make sure memory DB has the right identity,
    # then append memory from this message. If your Agno exposes a MemoryManager
    # API, you can replace this with a direct memory call.
    agent = build_agent(req.sessionId, req.userId)
    # Let agent "see" the message for memory extraction; keep it cheap:
    agent.remember(f"[{req.actor}] {req.text}")
    return {"ok": True}

@app.post("/ai/suggest", response_model=SuggestRes)
def suggest(req: SuggestReq):
    agent = build_agent(req.sessionId, req.userId)

    # Compose a coaching prompt for human-agent suggestions
    tail = "\n".join([f"{m.role.upper()}: {m.content}" for m in req.lastMessages[-8:]])
    coach = (
        "You are assisting a human agent in a live chat. "
        "Given the recent thread, propose concise next-message suggestions "
        f"(max {req.max}), each <= 25 words, helpful and specific. "
        "Do not repeat the user's words. No preambles—just suggestions."
    )
    plan = agent.run(coach + "\n\nThread:\n" + tail)

    # Split heuristically into bullets/lines
    raw = str(plan)
    candidates = [s.strip(" -•\n\r\t") for s in raw.split("\n") if s.strip()]
    suggestions = [c for c in candidates if 3 <= len(c.split()) <= 25][: req.max]
    if not suggestions:
        suggestions = [raw[:120]]

    return SuggestRes(suggestions=suggestions)

def run():
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "7001")))
