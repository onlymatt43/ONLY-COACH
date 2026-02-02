import { NextResponse } from 'next/server';
// On utilise les .../ pour remonter les dossiers manuellement
import { db, ensureDbReady } from '../../../db';
import { hasKV, kvGetHistory, kvAppend, ChatMessage } from '../../../db/kv';
import { messages, categories, resources } from '../../../db/schema';
import { eq } from 'drizzle-orm';

export async function GET() {
  try {
    if (hasKV()) {
      const history = await kvGetHistory();
      return NextResponse.json(history);
    }
    await ensureDbReady();
    const history = await db.select().from(messages);
    return NextResponse.json(history as unknown as ChatMessage[]);
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
    let catsCtx: any[] = [];
    let resCtx: any[] = [];

    try {
      await ensureDbReady();
      catsCtx = await db.select().from(categories);
      // Limit resources for context
      resCtx = await db.select().from(resources);
    } catch (e) {
      console.warn('Context load failed (categories/resources)', e);
    }

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
            { role: 'system', content: `You are Coach, an orchestrator for categories and resources. You can plan actions and return them in a fenced block labeled om_actions containing JSON. Schema: [{"type":"create_category","name":"..."}|{"type":"rename_category","id":123,"name":"..."}|{"type":"add_resource","categoryName":"...","title":"...","url":"...","notes":"..."}|{"type":"delete_resource","id":456}]. Keep your normal reply outside the fenced block. Only include om_actions when changes are needed. Current categories: ${JSON.stringify(catsCtx)}. Current resources (trimmed): ${JSON.stringify(resCtx.slice(0, 50))}.` },
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

    // Parse actions block
    const actionMatch = assistantText.match(/```\s*om_actions\s*\n([\s\S]*?)\n```/i);
    if (actionMatch) {
      try {
        const actions = JSON.parse(actionMatch[1]);
        await ensureDbReady();
        for (const a of Array.isArray(actions) ? actions : []) {
          if (a.type === 'create_category' && a.name) {
            await db.insert(categories).values({ name: String(a.name) });
          } else if (a.type === 'rename_category' && a.id && a.name) {
            await db.update(categories).set({ name: String(a.name) }).where(eq(categories.id, Number(a.id)));
          } else if (a.type === 'add_resource') {
            let catId = a.categoryId ? Number(a.categoryId) : null;
            if (!catId && a.categoryName) {
              const found = (catsCtx || []).find((c: any) => String(c.name).toLowerCase() === String(a.categoryName).toLowerCase());
              if (found) catId = Number(found.id);
              else {
                const inserted = await db.insert(categories).values({ name: String(a.categoryName) }).returning();
                catId = inserted[0]?.id ?? null;
              }
            }
            if (catId) {
              await db.insert(resources).values({ categoryId: catId, title: String(a.title || 'Untitled'), url: a.url ? String(a.url) : null, notes: a.notes ? String(a.notes) : null });
            }
          } else if (a.type === 'delete_resource' && a.id) {
            await db.delete(resources).where(eq(resources.id, Number(a.id)));
          }
        }
      } catch (e) {
        console.warn('Failed to process om_actions', e);
      }
    }

    if (hasKV()) {
      try {
        await kvAppend({ role: 'user', content });
        await kvAppend({ role: 'assistant', content: assistantText });
      } catch (e) {
        console.error('KV append failed', e);
      }
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
