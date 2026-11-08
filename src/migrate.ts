import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Sql } from './db.js';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/** Aplica, em ordem, os arquivos de migrations/ que ainda não rodaram. */
export async function migrate(sql: Sql, log: (m: string) => void = console.log): Promise<void> {
  await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  const done = new Set((await sql<{ name: string }[]>`select name from schema_migrations`).map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (done.has(file)) continue;
    const text = await readFile(path.join(dir, file), 'utf8');
    await sql.begin(async (tx) => {
      await tx.unsafe(text);
      await tx`insert into schema_migrations (name) values (${file})`;
    });
    log(`migração aplicada: ${file}`);
  }
}

// npm run migrate
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { connect } = await import('./db.js');
  if (!process.env.DATABASE_URL) throw new Error('Defina DATABASE_URL');
  const sql = connect(process.env.DATABASE_URL);
  await migrate(sql);
  await sql.end();
}
