#!/usr/bin/env node
// Sync a local folder to Vercel Blob and register resources in Only-Coach
// Usage:
//  node scripts/sync-folder-to-blob.mjs <folderPath> --category <catIdOrName> --base <COACH_URL>
// Env:
//  BLOB_READ_WRITE_TOKEN: Vercel Blob RW token (required)
//  OPENAI_API_KEY optional (not used here)

import { put } from '@vercel/blob';
import fs from 'node:fs/promises';
import path from 'node:path';

const argv = process.argv.slice(2);
if (argv.length === 0) {
  console.error('Usage: node scripts/sync-folder-to-blob.mjs <folderPath> --category <catIdOrName> --base <COACH_URL>');
  process.exit(1);
}
const folder = path.resolve(argv[0]);
const getArg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const catArg = getArg('category', 'VIDEOTHEQUE');
const base = getArg('base', process.env.COACH_URL || 'http://localhost:3000');
const token = process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_BLOB_RW_TOKEN;
if (!token) {
  console.error('Missing BLOB_READ_WRITE_TOKEN env');
  process.exit(1);
}

async function resolveCategoryId() {
  const res = await fetch(`${base}/api/categories`);
  const cats = await res.json();
  let id = null;
  if (/^\d+$/.test(catArg)) {
    id = Number(catArg);
  } else {
    const found = cats.find((c) => String(c.name).toLowerCase() === String(catArg).toLowerCase());
    if (found) id = found.id;
    else {
      const created = await fetch(`${base}/api/categories`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: catArg }) });
      const cat = await created.json();
      id = cat.id;
    }
  }
  return id;
}

async function* walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      yield* walk(full);
    } else if (e.isFile()) {
      yield full;
    }
  }
}

function toKey(catId, filePath) {
  const rel = path.relative(folder, filePath).split(path.sep).join('/');
  const safe = rel.replace(/[^a-zA-Z0-9_.\/-]/g, '_');
  return `categories/${catId}/${safe}`;
}

async function main() {
  const catId = await resolveCategoryId();
  const uploaded = [];
  for await (const file of walk(folder)) {
    const stat = await fs.stat(file);
    if (stat.size === 0) continue;
    const key = toKey(catId, file);
    const data = await fs.readFile(file);
    const blob = await put(key, new Blob([data]), { access: 'public', token });
    uploaded.push({ file, url: blob.url });
    const title = path.basename(file);
    await fetch(`${base}/api/resources`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoryId: catId, title, url: blob.url })
    });
    console.log('Uploaded:', file, '->', blob.url);
  }
  console.log(`Done. Uploaded ${uploaded.length} files.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
