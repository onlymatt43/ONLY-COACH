import { NextResponse } from 'next/server';
import { db, ensureDbReady } from '@/db';
import { resources } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function GET(req: Request) {
  try {
    await ensureDbReady();
    const { searchParams } = new URL(req.url);
    const categoryId = searchParams.get('categoryId');
    if (categoryId) {
      const rows = await db.select().from(resources).where(eq(resources.categoryId, Number(categoryId))).orderBy(resources.createdAt);
      return NextResponse.json(rows);
    }
    const all = await db.select().from(resources).orderBy(resources.createdAt);
    return NextResponse.json(all);
  } catch (e) {
    return NextResponse.json({ error: 'resources_get_failed', details: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { categoryId, title, url, notes } = await req.json();
    if (!categoryId || !title) return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
    await ensureDbReady();
    const result = await db.insert(resources).values({ categoryId: Number(categoryId), title, url, notes }).returning();
    return NextResponse.json(result[0]);
  } catch (e) {
    return NextResponse.json({ error: 'resources_post_failed', details: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const { id, title, url, notes } = await req.json();
    if (!id) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
    await ensureDbReady();
    await db.update(resources).set({ title, url, notes }).where(eq(resources.id, Number(id)));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: 'resources_put_failed', details: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
    await ensureDbReady();
    await db.delete(resources).where(eq(resources.id, Number(id)));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: 'resources_delete_failed', details: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
