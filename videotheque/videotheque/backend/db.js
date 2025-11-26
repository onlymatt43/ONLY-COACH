const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

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

const db = openDb();

module.exports = {
  db,
  getCodes() {
    return db.prepare('SELECT code, activatedAt, meta FROM codes ORDER BY id DESC').all().map((r) => ({ code: r.code, activatedAt: r.activatedAt, meta: r.meta ? JSON.parse(r.meta) : null }));
  },
  findCode(code) {
    const r = db.prepare('SELECT id, code, activatedAt, meta FROM codes WHERE code = ?').get(code);
    return r ? { id: r.id, code: r.code, activatedAt: r.activatedAt, meta: r.meta ? JSON.parse(r.meta) : null } : null;
  },
  createCodes(entries) {
    const insert = db.prepare('INSERT OR IGNORE INTO codes (code, activatedAt, meta) VALUES (?, ?, ?)');
    const tx = db.transaction((rows) => {
      for (const r of rows) insert.run(r.code, r.activatedAt || null, JSON.stringify(r.meta || null));
    });
    tx(entries);
  },
  activateCode(code, timestamp) {
    const now = timestamp || Date.now();
    const stmt = db.prepare('UPDATE codes SET activatedAt = ? WHERE code = ? AND (activatedAt IS NULL OR activatedAt = 0)');
    const info = stmt.run(now, code);
    return info.changes > 0;
  },
  updateActivatedAt(code, timestamp) {
    const now = timestamp || Date.now();
    const stmt = db.prepare('UPDATE codes SET activatedAt = ? WHERE code = ?');
    const info = stmt.run(now, code);
    return info.changes > 0;
  },
  close() {
    try { db.close(); } catch (e) { /* ignore */ }
  },
};
