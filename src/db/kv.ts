const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.KV_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

export type ChatMessage = { role: 'user' | 'assistant'; content: string };
const HISTORY_KEY = 'om43:history';

export function hasKV() {
  return !!KV_URL && !!KV_TOKEN;
}

async function kvRequest<T = any>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${KV_URL!.replace(/\/$/, '')}/${path}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    ...init
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`KV ${resp.status}: ${text}`);
  }
  return resp.json() as Promise<T>;
}

export async function kvGetHistory(): Promise<ChatMessage[]> {
  const data = await kvRequest<{ result: string | null }>(`GET/${encodeURIComponent(HISTORY_KEY)}`);
  if (!data.result) return [];
  try {
    return JSON.parse(data.result) as ChatMessage[];
  } catch {
    return [];
  }
}

export async function kvSetHistory(history: ChatMessage[]): Promise<void> {
  const payload = encodeURIComponent(JSON.stringify(history));
  await kvRequest(`SET/${encodeURIComponent(HISTORY_KEY)}/${payload}`);
}

export async function kvAppend(msg: ChatMessage): Promise<void> {
  const list = await kvGetHistory();
  list.push(msg);
  await kvSetHistory(list);
}
