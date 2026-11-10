/**
 * Base de conhecimento do bot técnico (Qdrant), direto do servidor, sem o n8n.
 *   npx tsx scripts/base-tecnica.ts status
 *   npx tsx scripts/base-tecnica.ts carregar arquivo.json [outro.json ...]
 * No servidor use o atalho: bash scripts/base-tecnica.sh status | carregar /root/arquivo.json
 */
import { readFile } from 'node:fs/promises';
import { GeminiEmbeddings, QdrantBase } from '../src/modules/tecnico/clients.js';
import { carregar, parseCarga } from '../src/modules/tecnico/carga.js';

const env = process.env;
const [cmd, ...files] = process.argv.slice(2);
if (!env.QDRANT_URL || !env.QDRANT_API_KEY || !env.GEMINI_API_KEY) {
  console.error('Faltam QDRANT_URL, QDRANT_API_KEY ou GEMINI_API_KEY no .env (rode bash scripts/configurar-tecnico.sh).');
  process.exit(1);
}
const collection = env.QDRANT_COLLECTION || 'gss_base_tecnica';
const kb = new QdrantBase(
  env.QDRANT_URL,
  env.QDRANT_API_KEY,
  collection,
  new GeminiEmbeddings(env.GEMINI_API_KEY, env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2'),
);

await kb.ensureIndexes();

if (cmd === 'status') {
  const info = await kb.info();
  console.log(`Coleção ${collection}: ${info.points} fichas no total (vetor de ${info.size ?? '?'} dimensões).`);
  for (const [tipo, nome] of [
    ['ficha', 'H = histórico do grupo'],
    ['card_revisado', 'C = respostas revisadas por sênior'],
    ['manual', 'M = manuais (lista de erros Fresenius etc.)'],
  ] as const) {
    console.log(`  ${String(await kb.count('metadata.tipo', tipo)).padStart(6)}  ${nome}`);
  }
  const marcos = ['H00001', 'H02481', 'M00001', 'M00914'];
  const tem = await kb.existingIds(marcos);
  console.log('Conferência: ' + marcos.map((id) => `${id} ${tem.has(id) ? 'OK' : 'FALTA'}`).join(' · '));
} else if (cmd === 'carregar' && files.length) {
  for (const file of files) {
    const { fichas, erros } = parseCarga(await readFile(file, 'utf8'));
    console.log(`${file}: ${fichas.length} fichas lidas${erros.length ? `, ${erros.length} com problema` : ''}.`);
    for (const e of erros.slice(0, 10)) console.log('  ! ' + e);
    if (!fichas.length) continue;
    const r = await carregar(kb, fichas, { log: console.log, pausaMs: 1000 });
    console.log(`Pronto: ${r.gravadas} gravadas, ${r.puladas} já estavam na base.`);
  }
} else {
  console.error('Uso: base-tecnica.ts status | carregar arquivo.json [...]');
  process.exit(1);
}
