const path = require('path');
const fs = require('fs');
let Database;
try {
  Database = require('better-sqlite3');
} catch (e) {
  console.warn('better-sqlite3 not available — falling back to JSON-based storage for local dev');
  Database = null;
}

const dbPath = path.join(__dirname, 'data', 'db.sqlite');
const jsonCodesPath = path.join(__dirname, 'data', 'codes.json');

function openDb() {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath);

  // Ensure codes table
  db.exec(`
    CREATE TABLE IF NOT EXISTS codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      activatedAt INTEGER NULL,
      meta TEXT NULL
    );
  `);

  // If DB empty and codes.json exists, import them
  const count = db.prepare('SELECT COUNT(*) as c FROM codes').get().c;
  if (count === 0 && fs.existsSync(jsonCodesPath)) {
    try {
      const raw = fs.readFileSync(jsonCodesPath, 'utf-8');
      const items = JSON.parse(raw);
      const insert = db.prepare('INSERT OR IGNORE INTO codes (code, activatedAt, meta) VALUES (?, ?, ?)');
      const insertMany = db.transaction((rows) => {
        for (const r of rows) insert.run(r.code, r.activatedAt || null, JSON.stringify(r.meta || null));
      });
      insertMany(items);
      console.log(`db: imported ${items.length} codes from codes.json`);
    } catch (e) {
      console.warn('db import failed:', e?.message || e);
    }
  }

  return db;
}

let db = null;
if (Database) db = openDb();

function jsonReadCodes() {
  try {
    if (!fs.existsSync(jsonCodesPath)) return [];
    return JSON.parse(fs.readFileSync(jsonCodesPath, 'utf-8')) || [];
  } catch (e) {
    return [];
  }
}

function jsonWriteCodes(items) {
  fs.writeFileSync(jsonCodesPath, JSON.stringify(items, null, 2));
}

module.exports = {
  get db() { return db; },
  getCodes() {
    if (db) {
      return db.prepare('SELECT code, activatedAt, meta FROM codes ORDER BY id DESC').all().map((r) => ({ code: r.code, activatedAt: r.activatedAt, meta: r.meta ? JSON.parse(r.meta) : null }));
    }
    return jsonReadCodes();
  },
  findCode(code) {
    if (db) {
      const r = db.prepare('SELECT id, code, activatedAt, meta FROM codes WHERE code = ?').get(code);
      return r ? { id: r.id, code: r.code, activatedAt: r.activatedAt, meta: r.meta ? JSON.parse(r.meta) : null } : null;
    }
    const items = jsonReadCodes();
    return items.find((c) => c.code === code) || null;
  },
  createCodes(entries) {
    if (db) {
      const insert = db.prepare('INSERT OR IGNORE INTO codes (code, activatedAt, meta) VALUES (?, ?, ?)');
      const tx = db.transaction((rows) => {
        for (const r of rows) insert.run(r.code, r.activatedAt || null, JSON.stringify(r.meta || null));
      });
      tx(entries);
      return;
    }
    // fallback to JSON append
    const existing = jsonReadCodes();
    const merged = existing.concat(entries.map((e) => ({ code: e.code, activatedAt: e.activatedAt || null, meta: e.meta || null })));
    jsonWriteCodes(merged);
  },
  activateCode(code, timestamp) {
    const now = timestamp || Date.now();
    if (db) {
      const stmt = db.prepare('UPDATE codes SET activatedAt = ? WHERE code = ? AND (activatedAt IS NULL OR activatedAt = 0)');
      const info = stmt.run(now, code);
      return info.changes > 0;
    }
    const items = jsonReadCodes();
    const entry = items.find((c) => c.code === code);
    if (!entry) return false;
    if (!entry.activatedAt) {
      entry.activatedAt = now;
      jsonWriteCodes(items);
      return true;
    }
    return false;
  },
  updateActivatedAt(code, timestamp) {
    const now = timestamp || Date.now();
    if (db) {
      const stmt = db.prepare('UPDATE codes SET activatedAt = ? WHERE code = ?');
      const info = stmt.run(now, code);
      return info.changes > 0;
    }
    const items = jsonReadCodes();
    const entry = items.find((c) => c.code === code);
    if (!entry) return false;
    entry.activatedAt = now;
    jsonWriteCodes(items);
    return true;
  },
  close() {
    try { db.close(); } catch (e) { /* ignore */ }
  },
};
