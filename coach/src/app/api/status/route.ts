import { NextResponse } from 'next/server';
import { ensureDbReady, getDbBackend } from '@/db';

export async function GET() {
  try {
    await ensureDbReady();
    const backend = getDbBackend();
    return NextResponse.json({ db: backend ?? 'unknown', mode: (process.env.DB_MODE || 'auto').toLowerCase() });
  } catch (error) {
    return NextResponse.json({ db: 'error', error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
