// packages/server/src/integrations/agno.ts
// Uses Node's built-in fetch (Node >=18). No node-fetch import needed.

const AGNO_URL = process.env.AGNO_URL || "http://localhost:7001";

type Msg = { role: "user" | "assistant" | "system"; content: string };

export async function agnoAnswer(params: {
  sessionId: string;
  userId: string;
  messages: Msg[];
  context?: Record<string, unknown>;
}): Promise<{ text: string; sources?: any[] }> {
  const r = await fetch(`${AGNO_URL}/ai/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`agnoAnswer failed: ${r.status} ${t}`);
  }
  const data = await r.json();
  return { text: data?.text ?? "", sources: data?.sources ?? undefined };
}

export async function agnoMemoryUpdate(params: {
  sessionId: string;
  userId: string;
  actor: "user" | "agent" | "bot";
  text: string;
}): Promise<{ ok: boolean }> {
  const r = await fetch(`${AGNO_URL}/ai/memory_update`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`agnoMemoryUpdate failed: ${r.status} ${t}`);
  }
  return { ok: true };
}

export async function agnoSuggest(params: {
  sessionId: string;
  userId: string;
  lastMessages: Msg[];
  max?: number;
}): Promise<{ suggestions: string[] }> {
  const r = await fetch(`${AGNO_URL}/ai/suggest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`agnoSuggest failed: ${r.status} ${t}`);
  }
  const data = await r.json();
  return { suggestions: Array.isArray(data?.suggestions) ? data.suggestions : [] };
}
