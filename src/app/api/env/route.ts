import { NextResponse } from 'next/server';
import { db, ensureDbReady } from '@/db';
import { envkeys } from '@/db/schema';
import { eq } from 'drizzle-orm';

// Helper: presence map (never returns values)
function presenceFor(names: string[]) {
  const out: Record<string, boolean> = {};
  for (const n of names) out[n] = !!process.env[n];
  return out;
}

export async function GET() {
  try {
    await ensureDbReady();
    const rows = await db.select().from(envkeys).orderBy(envkeys.createdAt);
    const presence = presenceFor(rows.map((r: any) => r.name));
    return NextResponse.json({ items: rows, presence });
  } catch (e) {
    return NextResponse.json({ error: 'env_list_failed', details: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { name, service, description, location } = await req.json();
    if (!name) return NextResponse.json({ error: 'invalid_name' }, { status: 400 });
    await ensureDbReady();
    const result = await db.insert(envkeys).values({ name, service, description, location }).returning();
    return NextResponse.json(result[0]);
  } catch (e) {
    return NextResponse.json({ error: 'env_add_failed', details: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const { id, name, service, description, location } = await req.json();
    if (!id) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
    await ensureDbReady();
    await db.update(envkeys).set({ name, service, description, location }).where(eq(envkeys.id, Number(id)));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: 'env_update_failed', details: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
    await ensureDbReady();
    await db.delete(envkeys).where(eq(envkeys.id, Number(id)));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: 'env_delete_failed', details: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
