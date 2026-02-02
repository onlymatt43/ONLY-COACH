import { NextResponse } from 'next/server';

export async function GET() {
  // Do NOT leak secrets; only booleans
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasTursoUrl = !!process.env.TURSO_DATABASE_URL;
  const hasTursoToken = !!process.env.TURSO_AUTH_TOKEN;
  const mode = (process.env.DB_MODE || 'auto').toLowerCase();
  return NextResponse.json({
    ok: true,
    env: {
      NODE_ENV: process.env.NODE_ENV,
      OPENAI_API_KEY: hasOpenAI,
      TURSO_DATABASE_URL: hasTursoUrl,
      TURSO_AUTH_TOKEN: hasTursoToken,
      DB_MODE: mode
    }
  });
}
