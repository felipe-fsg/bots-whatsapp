/** Carga de fichas na base técnica (o que o fluxo "Ingestão base técnica" do n8n fazia). */
import type { QdrantBase } from './clients.js';

export interface FichaCarga {
  content: string;
  metadata: Record<string, unknown>;
}

const TEXT_KEYS = ['content', 'pageContent', 'texto', 'text', 'conteudo'];

/**
 * Lê um arquivo de carga. Aceita uma lista JSON, { "itens"|"items"|"fichas": [...] } ou uma ficha por linha (JSONL).
 * Cada ficha precisa de um texto (content, pageContent, texto...) e de um id (metadata.id ou id).
 * Se não houver "metadata", os outros campos viram os metadados.
 */
export function parseCarga(raw: string): { fichas: FichaCarga[]; erros: string[] } {
  let list: unknown[];
  const txt = raw.replace(/^﻿/, '').trim();
  try {
    const j = JSON.parse(txt);
    list = Array.isArray(j) ? j : (j.itens ?? j.items ?? j.fichas ?? j.documentos ?? [j]);
  } catch {
    list = txt.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
  }
  const fichas: FichaCarga[] = [];
  const erros: string[] = [];
  list.forEach((item: any, i) => {
    if (!item || typeof item !== 'object') return erros.push(`item ${i + 1}: não é um objeto`);
    const key = TEXT_KEYS.find((k) => typeof item[k] === 'string' && item[k].trim());
    if (!key) return erros.push(`item ${i + 1}: sem texto (campo content)`);
    const rest = Object.fromEntries(Object.entries(item).filter(([k]) => k !== key && k !== 'metadata'));
    const metadata: Record<string, unknown> = item.metadata && typeof item.metadata === 'object' ? { ...item.metadata } : rest;
    if (metadata.id == null && item.id != null) metadata.id = item.id;
    if (metadata.id == null || String(metadata.id).trim() === '') return erros.push(`item ${i + 1}: sem id (metadata.id)`);
    metadata.id = String(metadata.id).trim().toUpperCase();
    fichas.push({ content: item[key].trim(), metadata });
  });
  return { fichas, erros };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Grava as fichas que ainda não estão na base, em lotes (padrão 50, como no n8n).
 * Fichas cujo id já existe são puladas, então dá para rodar de novo depois de uma falha.
 */
export async function carregar(
  kb: Pick<QdrantBase, 'existingIds' | 'insertMany'>,
  fichas: FichaCarga[],
  opts: { lote?: number; log?: (s: string) => void; pausaMs?: number; esperaMs?: number } = {},
): Promise<{ gravadas: number; puladas: number }> {
  const lote = opts.lote ?? 50;
  const log = opts.log ?? (() => {});
  let gravadas = 0;
  let puladas = 0;
  for (let i = 0; i < fichas.length; i += lote) {
    const part = fichas.slice(i, i + lote);
    const ids = part.map((f) => String(f.metadata.id));
    const ja = await kb.existingIds(ids);
    const novas = part.filter((f) => !ja.has(String(f.metadata.id)));
    puladas += part.length - novas.length;
    for (let tentativa = 1; novas.length; tentativa++) {
      try {
        await kb.insertMany(novas);
        break;
      } catch (err) {
        if (tentativa >= 4) throw err;
        const espera = tentativa * (opts.esperaMs ?? 20_000);
        log(`  falhou (${String(err).slice(0, 160)}); tentando de novo em ${Math.round(espera / 1000)}s`);
        await sleep(espera);
      }
    }
    gravadas += novas.length;
    log(`  ${Math.min(i + lote, fichas.length)}/${fichas.length} (gravadas ${gravadas}, já existiam ${puladas})`);
    if (opts.pausaMs) await sleep(opts.pausaMs);
  }
  return { gravadas, puladas };
}
