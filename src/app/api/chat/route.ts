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
    let dbOk = true;
    try {
      await ensureDbReady();
      await db.insert(messages).values({ role: 'user', content });
    } catch (e) {
      dbOk = false;
      console.error('DB not available, proceeding stateless', e instanceof Error ? e.message : String(e));
    }
    const apiKey = process.env.OPENAI_API_KEY;
    let assistantText = '';

    if (apiKey) {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content }
          ],
          temperature: 0.7
        })
      });

      if (!resp.ok) {
        const errBody = await resp.text();
        throw new Error(`OpenAI HTTP ${resp.status}: ${errBody}`);
      }
      const data = await resp.json();
      assistantText = data?.choices?.[0]?.message?.content ?? '';
    } else {
      const ollamaHost = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
      const response = await fetch(`${ollamaHost}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'llama3', prompt: content, stream: false }),
      });
      const data = await response.json();
      assistantText = data.response ?? '';
    }

    if (dbOk) {
      await db.insert(messages).values({ role: 'assistant', content: assistantText });
    }
    return NextResponse.json({ role: 'assistant', content: assistantText });
  } catch (error) {
    console.error('POST /api/chat failed', error);
    return NextResponse.json({
      error: "Erreur",
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}
