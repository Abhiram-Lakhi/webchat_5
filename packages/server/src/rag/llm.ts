import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export const CHAT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
export const EMBED_MODEL = process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small';

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const res = await client.embeddings.create({
    model: EMBED_MODEL,
    input: texts,
    encoding_format: 'float',
  });
  // OpenAI returns Float32Array-ish; normalize to number[]
  return res.data.map((d) => (d.embedding as unknown as number[]));
}

export async function embedQuery(q: string): Promise<number[]> {
  const [v] = await embedTexts([q]);
  return v;
}

export async function chatWithContext(system: string, user: string) {
  const resp = await client.chat.completions.create({
    model: CHAT_MODEL,
    temperature: 0.2,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
  return resp.choices?.[0]?.message?.content?.trim() ?? '';
}
