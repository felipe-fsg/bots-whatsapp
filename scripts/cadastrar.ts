/**
 * Cadastra ou atualiza um bot a partir de um arquivo JSON (rodar de novo não duplica).
 * Uso: DATABASE_URL=... npx tsx scripts/cadastrar.ts arquivo.json
 * Exemplos: seed/exemplo-splinter.json (desafio fitness) e seed/exemplo-geral.json (grupo de conversa).
 */
import { readFile } from 'node:fs/promises';
import { connect } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { seedGeneral } from './seed-base.js';
import { seedSplinter } from './seed-splinter.js';

const file = process.argv[2];
if (!file || !process.env.DATABASE_URL) {
  console.error('Uso: DATABASE_URL=... npx tsx scripts/cadastrar.ts arquivo.json');
  process.exit(1);
}
const data = JSON.parse(await readFile(file, 'utf8'));
const sql = connect(process.env.DATABASE_URL);
await migrate(sql, console.log);
const ids = data?.bot?.modulo === 'splinter' || data?.desafio ? await seedSplinter(sql, data) : await seedGeneral(sql, data);
console.log(`Pronto: bot "${data.bot.nome}" cadastrado no grupo ${data.bot.grupo}.`);
console.log('Endereço do webhook (o mesmo para todos os grupos deste número):');
console.log(`  https://${process.env.DOMINIO ?? 'SEU_DOMINIO'}/webhook/avisa/${ids.connectionId}?key=${process.env.WEBHOOK_SECRET ?? 'SEU_WEBHOOK_SECRET'}`);
await sql.end();
