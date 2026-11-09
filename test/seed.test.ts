import { afterEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { freshDb } from './helpers.js';
import { seedSplinter } from '../scripts/seed-splinter.js';
import { seedGeneral } from '../scripts/seed-base.js';
import type { Sql } from '../src/db.js';

let sql: Sql;
afterEach(async () => {
  await sql?.end();
});

describe('seed', () => {
  it('cadastra o exemplo e pode rodar de novo sem duplicar', async () => {
    sql = await freshDb();
    const data = JSON.parse(await readFile('seed/exemplo-splinter.json', 'utf8'));
    const a = await seedSplinter(sql, data);
    const b = await seedSplinter(sql, data);
    expect(b).toEqual(a);
    const [n] = await sql`select (select count(*) from splinter_rules)::int r, (select count(*) from splinter_participants)::int p,
      (select count(*) from splinter_teams)::int t, (select count(*) from splinter_places where participant_id is not null)::int l`;
    expect(n).toEqual({ r: 3, p: 1, t: 1, l: 1 });
  });

  it('cadastra um bot geral no mesmo número, sem desafio', async () => {
    sql = await freshDb();
    const splinter = await seedSplinter(sql, JSON.parse(await readFile('seed/exemplo-splinter.json', 'utf8')));
    const geral = JSON.parse(await readFile('seed/exemplo-geral.json', 'utf8'));
    geral.bot.grupo = '1203630000000099@g.us';
    const ids = await seedGeneral(sql, geral);
    expect(ids.connectionId).toBe(splinter.connectionId);
    const bots = await sql`select module from bots order by module`;
    expect(bots.map((b) => b.module)).toEqual(['geral', 'splinter']);
  });
});
