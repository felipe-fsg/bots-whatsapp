import { describe, expect, it } from 'vitest';
import { fichasDoManual, mNumber, splitPages, splitText } from '../src/modules/tecnico/manual.js';

const info = { documento: 'Fresenius 4008S V10 - Manual de serviço', fabricante: 'Fresenius', modelo: '4008S' };
const rodape = 'Fresenius Medical Care 4008 S (versão V10) 03/2011';
const pagina = (titulo: string) => `${titulo}\n\nTexto técnico de ${titulo}: ${'bomba de sangue, sensor e válvula. '.repeat(6)}\n${rodape}`;

describe('manuais em PDF', () => {
  it('separa as páginas do pdftotext', () => {
    expect(splitPages('a\fb\f')).toEqual(['a', 'b']);
  });

  it('gera fichas M com documento e página, pulando páginas vazias e rodapé repetido', () => {
    const pages = Array.from({ length: 10 }, (_, i) => pagina('Capítulo 4: Especificações 4-' + (i + 1)));
    pages[2] = '   \n' + rodape;
    const fichas = fichasDoManual(pages, info, 915);
    expect(fichas).toHaveLength(9);
    expect(fichas[0].metadata).toMatchObject({ id: 'M00915', tipo: 'manual', documento: info.documento, pagina: 'p. 1', modelo: '4008S' });
    expect(fichas[2].metadata.pagina).toBe('p. 4');
    expect(fichas[2].metadata.id).toBe('M00917');
    expect(fichas[0].content.startsWith(info.documento + ', p. 1\nCapítulo 4')).toBe(true);
    expect(fichas.some((f) => f.content.includes(rodape))).toBe(false);
  });

  it('divide página longa em partes e mantém a numeração estável', () => {
    const longa = Array.from({ length: 12 }, (_, i) => `Parágrafo ${i}. ` + 'x'.repeat(500)).join('\n\n');
    const partes = splitText(longa);
    expect(partes.length).toBeGreaterThan(2);
    expect(partes.every((p) => p.length <= 2600)).toBe(true);
    expect(partes.join(' ').replace(/\s/g, '')).toBe(longa.replace(/\s/g, ''));
    const a = fichasDoManual([longa, pagina('Outra')], info, 1000);
    const b = fichasDoManual([longa, pagina('Outra')], info, 1000);
    expect(a.map((f) => f.metadata.id)).toEqual(b.map((f) => f.metadata.id));
    expect(a[0].content).toContain('(parte 1 de');
    expect(a[a.length - 1].metadata.pagina).toBe('p. 2');
  });

  it('lê o número do id M', () => {
    expect(mNumber('M00914')).toBe(914);
    expect(mNumber('H00001')).toBeNull();
  });
});
