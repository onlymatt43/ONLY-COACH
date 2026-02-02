import 'dotenv/config';
import { createClient } from '@libsql/client';

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

async function main() {
  if (!url || !authToken) {
    console.error('Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN');
    process.exit(1);
  }
  console.log('Testing Turso…', { url });
  const client = createClient({ url, authToken });
  try {
    const res = await client.execute("select 1 as ok");
    console.log('Query OK:', res.rows);
    await client.execute(
      "CREATE TABLE IF NOT EXISTS ping (id integer primary key autoincrement, created_at integer default (strftime('%s','now')))"
    );
    await client.execute("INSERT INTO ping DEFAULT VALUES");
    const p = await client.execute("SELECT count(*) as n from ping");
    console.log('Ping rows:', p.rows);
    console.log('SUCCESS: Turso accepts credentials');
  } catch (err) {
    console.error('FAIL:', err?.message || err);
    process.exitCode = 2;
  } finally {
    try { await client.close(); } catch {}
  }
}

main();
