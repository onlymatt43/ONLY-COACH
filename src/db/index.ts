import { createClient, Client } from '@libsql/client';
import { drizzle, LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from './schema';

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

const patchedFetch: typeof fetch = async (input, init) => {
  if (process.env.NODE_ENV !== 'production') {
    const kind = typeof input;
    if (kind === 'object' && input !== null) {
      const maybe = input as Record<string, unknown>;
      console.debug('patchedFetch request', {
        url: (maybe as any).url,
        method: (maybe as any).method
      });
    } else {
      console.debug('patchedFetch request', { input });
    }
  }

  let resource: RequestInfo | URL = input as RequestInfo;
  let options: RequestInit | undefined = init;

  if (input instanceof Request) {
    resource = input;
  } else if (typeof input === 'object' && input !== null && 'url' in (input as Record<string, unknown>)) {
    const requestLike = input as Record<string, unknown>;
    resource = requestLike.url as string;
    const { url: _omit, ...rest } = requestLike;
    options = rest as RequestInit;
  }

  const response = await fetch(resource, options);
  const body: any = response.body;
  if (body && typeof body.cancel !== 'function' && typeof body.destroy === 'function') {
    body.cancel = body.destroy.bind(body);
  }
  return response;
};

let client: Client | null = null;
let dbInstance: LibSQLDatabase<typeof schema> | null = null;
let activeBackend: 'remote' | 'local' | null = null;

async function initDb() {
  const mode = (process.env.DB_MODE || 'auto').toLowerCase(); // remote | local | auto

  const initRemote = async () => {
    if (!url || !authToken) throw new Error('Missing Turso credentials');
    client = createClient({ url, authToken, fetch: patchedFetch });
    dbInstance = drizzle(client, { schema });
    await client.execute(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s','now'))
      )
    `);
    activeBackend = 'remote';
    console.log('DB ready: remote Turso');
  };

  const initLocal = async () => {
    client = createClient({ url: 'file:.data/dev.db' });
    dbInstance = drizzle(client, { schema });
    await client.execute(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s','now'))
      )
    `);
    activeBackend = 'local';
    console.log('DB ready: local file .data/dev.db');
  };

  try {
    if (mode === 'remote') {
      await initRemote();
      return;
    }
    if (mode === 'local') {
      await initLocal();
      return;
    }
    // auto: try remote, then local
    await initRemote();
  } catch (err) {
    console.error('Remote Turso init failed', err);
    if (mode === 'remote') throw err; // explicit remote -> propagate
    await initLocal();
  }
}

const ready = initDb();
export const ensureDbReady = () => ready;
export const db = new Proxy({} as LibSQLDatabase<typeof schema>, {
  get(_target, prop) {
    if (!dbInstance) {
      throw new Error('DB not initialized yet');
    }
    // @ts-ignore
    return dbInstance[prop];
  }
});
export const getDbBackend = () => activeBackend;
