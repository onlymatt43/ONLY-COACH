import { NextResponse } from 'next/server';
// On utilise les .../ pour remonter les dossiers manuellement
import { db, ensureDbReady } from '../../../db';
import { messages } from '../../../db/schema';

export async function GET() {
  try {
    await ensureDbReady();
    const history = await db.select().from(messages);
    return NextResponse.json(history);
  } catch (error) {
    console.error('GET /api/chat failed', error);
    return NextResponse.json({
      error: "Erreur DB",
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { content } = await req.json();
    await ensureDbReady();
    await db.insert(messages).values({ role: 'user', content });

    const ollamaHost = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
    const response = await fetch(`${ollamaHost}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'llama3', prompt: content, stream: false }),
    });

    const data = await response.json();
    await db.insert(messages).values({ role: 'assistant', content: data.response });

    return NextResponse.json({ role: 'assistant', content: data.response });
  } catch (error) {
    console.error('POST /api/chat failed', error);
    return NextResponse.json({
      error: "Erreur",
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}
