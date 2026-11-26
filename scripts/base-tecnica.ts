/**
 * Base de conhecimento do bot técnico (Qdrant), direto do servidor, sem o n8n.
 *   npx tsx scripts/base-tecnica.ts status
 *   npx tsx scripts/base-tecnica.ts carregar arquivo.json [outro.json ...]
 *   npx tsx scripts/base-tecnica.ts manual arquivo.pdf --documento "Nome" --fabricante X --modelo Y [--teste]
 * No servidor use o atalho: bash scripts/base-tecnica.sh status | carregar /root/arquivo.json | manual /root/arquivo.pdf ...
 */
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { GeminiEmbeddings, QdrantBase } from '../src/modules/tecnico/clients.js';
import { carregar, parseCarga } from '../src/modules/tecnico/carga.js';
import { fichasDoManual, mId, mNumber, splitPages } from '../src/modules/tecnico/manual.js';

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
  const c = await kb.count('metadata.tipo', 'card_revisado');
  const m = await kb.count('metadata.tipo', 'manual');
  console.log(`  ${String(info.points - c - m).padStart(6)}  H = histórico do grupo`);
  console.log(`  ${String(c).padStart(6)}  C = respostas revisadas por sênior`);
  console.log(`  ${String(m).padStart(6)}  M = manuais`);
  const manuais = await kb.idsWhere('metadata.tipo', 'manual');
  const ultimo = Math.max(0, ...manuais.map(mNumber).filter((n): n is number => n !== null));
  if (ultimo) console.log(`  Última ficha de manual: ${mId(ultimo)}`);
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
} else if (cmd === 'manual' && files.length) {
  const opt = (name: string) => {
    const i = files.indexOf('--' + name);
    return i >= 0 ? files[i + 1] : undefined;
  };
  const pdf = files[0];
  const documento = opt('documento')?.trim();
  if (!documento) {
    console.error('Informe o nome do documento: --documento "Fresenius 4008S V10 - Manual de serviço"');
    process.exit(1);
  }
  const info = { documento, fabricante: opt('fabricante')?.trim() || 'Fresenius', modelo: opt('modelo')?.trim() || '' };
  const { stdout } = await promisify(execFile)('pdftotext', ['-enc', 'UTF-8', pdf, '-'], { maxBuffer: 200 * 1024 * 1024 });
  const pages = splitPages(stdout);
  // Se o documento já foi carregado (inteiro ou em parte), reaproveita a numeração para continuar de onde parou.
  const doDoc = (await kb.idsWhere('metadata.documento', documento)).map(mNumber).filter((n): n is number => n !== null);
  const manuais = (await kb.idsWhere('metadata.tipo', 'manual')).map(mNumber).filter((n): n is number => n !== null);
  const primeiro = doDoc.length ? Math.min(...doDoc) : Math.max(0, ...manuais) + 1;
  const fichas = fichasDoManual(pages, info, primeiro);
  const vazias = pages.length - new Set(fichas.map((f) => f.metadata.pagina)).size;
  console.log(`${pdf}: ${pages.length} páginas, ${fichas.length} fichas (${vazias} páginas sem texto foram puladas).`);
  if (!fichas.length) {
    console.log('Nenhum texto encontrado. O PDF deve ser escaneado (imagem); esse precisa de OCR.');
    process.exit(1);
  }
  console.log(`Ids: ${fichas[0].metadata.id} a ${fichas[fichas.length - 1].metadata.id}${doDoc.length ? ` (documento já tinha ${doDoc.length} fichas na base; continua de onde parou)` : ''}.`);
  if (files.includes('--teste')) {
    for (const f of fichas.slice(0, 2)) console.log(`\n[${f.metadata.id}]\n${f.content.slice(0, 700)}\n`);
    console.log('Modo teste: nada foi gravado. Rode de novo sem --teste para gravar.');
  } else {
    const r = await carregar(kb, fichas, { log: console.log, pausaMs: 1000 });
    console.log(`Pronto: ${r.gravadas} gravadas, ${r.puladas} já estavam na base.`);
  }
} else {
  console.error('Uso: base-tecnica.ts status | carregar arquivo.json [...] | manual arquivo.pdf --documento "Nome" [--fabricante X] [--modelo Y] [--teste]');
  process.exit(1);
}
