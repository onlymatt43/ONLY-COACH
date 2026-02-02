import { NextResponse } from 'next/server';
import { db, ensureDbReady } from '@/db';
import { categories } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function GET() {
  try {
    await ensureDbReady();
    const rows = await db.select().from(categories).orderBy(categories.createdAt);
    return NextResponse.json(rows);
  } catch (e) {
    return NextResponse.json({ error: 'categories_get_failed', details: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { name } = await req.json();
    if (!name || typeof name !== 'string') return NextResponse.json({ error: 'invalid_name' }, { status: 400 });
    await ensureDbReady();
    const result = await db.insert(categories).values({ name }).returning();
    return NextResponse.json(result[0]);
  } catch (e) {
    return NextResponse.json({ error: 'categories_post_failed', details: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const { id, name } = await req.json();
    if (!id || !name) return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
    await ensureDbReady();
    await db.update(categories).set({ name }).where(eq(categories.id, Number(id)));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: 'categories_put_failed', details: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
    await ensureDbReady();
    await db.delete(categories).where(eq(categories.id, Number(id)));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: 'categories_delete_failed', details: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
