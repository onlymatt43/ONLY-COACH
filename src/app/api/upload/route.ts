import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';

export const runtime = 'edge';

export async function POST(req: Request) {
  try {
    const token = process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_BLOB_RW_TOKEN;
    if (!token) {
      return NextResponse.json({ error: 'missing_blob_token' }, { status: 400 });
    }
    const form = await req.formData();
    const file = form.get('file');
    const category = String(form.get('category') || 'uncategorized');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'invalid_file' }, { status: 400 });
    }
    const safeName = (file.name || 'upload').replace(/[^a-zA-Z0-9_.-]/g, '_');
    const key = `categories/${category}/${Date.now()}_${safeName}`;
    const uploaded = await put(key, file, { access: 'public', token });
    return NextResponse.json({ url: uploaded.url, pathname: uploaded.pathname });
  } catch (e) {
    return NextResponse.json({ error: 'upload_failed', details: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
