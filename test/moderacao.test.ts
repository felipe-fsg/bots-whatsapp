import { afterEach, describe, expect, it } from 'vitest';
import { world, type World } from './helpers.js';
import { weeklyCheck } from '../src/features/inativos/index.js';
import { curiarJob, periodOf } from '../src/features/curiar/index.js';

const ADMIN = '5511900000001';
const ANA = '5511911111111';
const BRUNO = '5511922222222';
const CAIO = '5511933333333';
const BOT = '5511955555555';

let w: World | undefined;
afterEach(async () => {
  await w?.sql.end();
  w = undefined;
});

async function ctxOf(w: World) {
  return w.runtime.context((await w.runtime.activeBots())[0]!);
}

const at = (day: number, hour = 12) => new Date(Date.UTC(2026, 10, day, hour + 3)); // horário de Brasília

describe('aviso de sumidos (#ativarBAN)', () => {
  it('avisa toda semana, zera quando a pessoa fala e remove depois do 3º aviso', async () => {
    w = await world();
    w.wa.members = [
      { jid: `${ADMIN}@s.whatsapp.net`, phone: ADMIN },
      { jid: `${ANA}@s.whatsapp.net`, phone: ANA },
      { jid: `${BRUNO}@s.whatsapp.net`, phone: BRUNO },
      { jid: `${CAIO}@s.whatsapp.net`, phone: CAIO, admin: true },
      { jid: `${BOT}@s.whatsapp.net`, phone: BOT },
    ];
    // o bot aprende o próprio número das mensagens que ele mesmo manda
    await w.sql`update wa_connections set own_phone = ${BOT}`;
    w.runtime.invalidate();

    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T15:00:00Z', text: '#ativarBAN' });
    expect(w.wa.last()).toContain('Só os admins');
    w.now.value = at(9);
    await w.send({ phone: ADMIN, name: 'Felipe', at: '2026-11-09T15:01:00Z', text: '#ativarBAN' });
    expect(w.wa.last()).toContain('Aviso de sumidos ligado');

    w.now.value = at(16);
    const ctx = await ctxOf(w);
    w.wa.clear();
    await weeklyCheck(ctx);
    // Ana falou só no dia 9, Bruno nunca falou: 7 dias depois de ligar, os dois são avisados
    expect(w.wa.sent).toHaveLength(1);
    expect(w.wa.last()).toContain('Sumidos da semana');
    expect(w.wa.last()).toContain('aviso 1 de 3');
    expect(w.wa.last()).toContain('• *Ana* (+55 11 91111-1111): 7 dias sem interagir (aviso 1 de 3)');
    expect(w.wa.last()).toContain('+55 11 92222-2222: nenhuma mensagem desde que comecei a acompanhar (aviso 1 de 3)');
    expect(w.wa.last()).not.toContain('93333'); // admin do grupo
    expect(w.wa.last()).not.toContain('95555'); // o próprio bot
    expect(w.wa.last()).not.toContain('90000'); // admin do bot

    // rodar de novo na mesma semana não repete
    w.wa.clear();
    await weeklyCheck(ctx);
    expect(w.wa.sent).toHaveLength(0);

    // Ana fala: avisos zerados; Bruno continua sumido
    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-18T12:00:00Z', image: { sha: 'f1' } });
    w.now.value = at(23);
    await weeklyCheck(ctx);
    expect(w.wa.last()).toContain('aviso 2 de 3');
    expect(w.wa.last()).not.toContain('Ana');
    w.now.value = at(30);
    await weeklyCheck(ctx);
    expect(w.wa.last()).toContain('aviso 3 de 3, último');

    // 4ª semana: sem como remover, pede aos admins
    w.now.value = new Date('2026-12-07T15:00:00Z');
    await weeklyCheck(ctx);
    expect(w.wa.last()).toContain('Admins:');
    expect(w.wa.last()).toContain('+55 11 92222-2222');

    // com remoção e menções no provedor
    const removed: string[] = [];
    const mentioned: string[][] = [];
    Object.assign(w.wa, {
      removeParticipant: async (_c: string, jid: string) => void removed.push(jid),
      sendTextMentions: async (chat: string, text: string, jids: string[]) => {
        mentioned.push(jids);
        w!.wa.sent.push({ chat, text });
      },
    });
    w.now.value = new Date('2026-12-14T15:00:00Z');
    await weeklyCheck(await ctxOf(w));
    expect(removed).toEqual([`${BRUNO}@s.whatsapp.net`]);
    expect(w.wa.last()).toContain('Saíram do grupo');
    // Ana sumiu desde 18/11: avisada com menção
    expect(mentioned.at(-1)).toEqual([`${ANA}@s.whatsapp.net`]);
    expect(w.wa.sent.findLast((s) => s.text.includes('Sumidos'))?.text).toContain(`@${ANA}`);

    await w.send({ phone: ADMIN, at: '2026-12-14T16:00:00Z', text: '#desativarBAN' });
    expect(w.wa.last()).toContain('desligado');
    w.wa.clear();
    w.now.value = new Date('2026-12-21T15:00:00Z');
    await weeklyCheck(await ctxOf(w));
    expect(w.wa.sent).toHaveLength(0);
  });
});

describe('#curiar', () => {
  it('admin liga e desliga o pedido de fotos', async () => {
    w = await world();
    const ctx = await ctxOf(w);
    w.now.value = at(9, 10);
    await curiarJob(ctx);
    expect(w.wa.sent).toHaveLength(0);

    await w.send({ phone: ANA, at: '2026-11-09T12:00:00Z', text: '#curiar' });
    expect(w.wa.last()).toContain('Só os admins');
    await w.send({ phone: ADMIN, at: '2026-11-09T12:01:00Z', text: '#curiar' });
    expect(w.wa.last()).toContain('Pedido de fotos ligado');

    w.ai.textAnswer = '📸 Bom dia, alunos! Mostrem o que estão fazendo!';
    await curiarJob(ctx);
    expect(w.ai.prompts.at(-1)).toContain('de manhã (10h)');
    expect(w.wa.last()).toBe('📸 Bom dia, alunos! Mostrem o que estão fazendo!');

    await w.send({ phone: ADMIN, at: '2026-11-09T12:02:00Z', text: '#nãocuriar' });
    expect(w.wa.last()).toContain('desligado');
    const n = w.wa.sent.length;
    await curiarJob(ctx);
    expect(w.wa.sent).toHaveLength(n);
    expect([periodOf(10), periodOf(15), periodOf(21)]).toEqual(['manha', 'tarde', 'noite']);
  });
});

describe('#promover e #demover', () => {
  it('admin promove e demove pelo @, sem ficar sem admin', async () => {
    w = await world();
    await w.send({ phone: ANA, at: '2026-11-09T12:00:00Z', text: '#promover @Bruno', mentions: [`${BRUNO}@s.whatsapp.net`] });
    expect(w.wa.last()).toContain('Só os admins');

    await w.send({ phone: BRUNO, name: 'Bruno', at: '2026-11-09T12:00:30Z', text: 'oi' });
    await w.send({ phone: ADMIN, at: '2026-11-09T12:01:00Z', text: '#promover @Bruno', mentions: [`${BRUNO}@s.whatsapp.net`] });
    expect(w.wa.last()).toBe('🛡️ *Bruno* agora é admin do bot.');
    await w.send({ phone: BRUNO, name: 'Bruno', at: '2026-11-09T12:02:00Z', text: '#admins' });
    expect(w.wa.last()).toContain('• Bruno');

    // Bruno, agora admin, demove o Felipe
    await w.send({ phone: BRUNO, name: 'Bruno', at: '2026-11-09T12:03:00Z', text: '#demover @Felipe', mentions: [`${ADMIN}@s.whatsapp.net`] });
    expect(w.wa.last()).toContain('não é mais admin');
    expect((await w.sql`select phone from bot_admins`).map((r) => r.phone)).toEqual([BRUNO]);

    await w.send({ phone: BRUNO, name: 'Bruno', at: '2026-11-09T12:04:00Z', text: '#demover @Bruno', mentions: [`${BRUNO}@s.whatsapp.net`] });
    expect(w.wa.last()).toContain('pelo menos um admin');
    await w.send({ phone: BRUNO, name: 'Bruno', at: '2026-11-09T12:05:00Z', text: '#demover' });
    expect(w.wa.last()).toContain('Marque quem');
    await w.send({ phone: BRUNO, name: 'Bruno', at: '2026-11-09T12:06:00Z', text: '#promover 11 91111-1111' });
    expect(w.wa.last()).toContain('agora é admin');
  });
});

describe('#ban', () => {
  it('só admin, exige citar a mensagem, protege admins e remove (ou pede aos admins)', async () => {
    w = await world();
    const quoted = (phone: string) => ({ id: 'X1', participant: `${phone}@s.whatsapp.net` });
    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T15:00:00Z', text: '#ban', quoted: quoted(BRUNO) });
    expect(w.wa.last()).toContain('Só os admins podem remover');
    await w.send({ phone: ADMIN, name: 'Felipe', at: '2026-11-09T15:01:00Z', text: '#ban' });
    expect(w.wa.last()).toContain('respondendo');
    await w.send({ phone: ADMIN, name: 'Felipe', at: '2026-11-09T15:02:00Z', text: '#ban', quoted: quoted(ADMIN) });
    expect(w.wa.last()).toContain('admin do bot');

    // sem como remover pela API: pede aos admins
    await w.send({ phone: BRUNO, name: 'Bruno', at: '2026-11-09T15:03:00Z', text: 'oi' });
    await w.send({ phone: ADMIN, name: 'Felipe', at: '2026-11-09T15:04:00Z', text: '#ban', quoted: quoted(BRUNO) });
    expect(w.wa.last()).toContain('Não consegui remover *Bruno*');

    const removed: string[] = [];
    w.wa.removeParticipant = async (_chat: string, jid: string) => {
      removed.push(jid);
    };
    await w.send({ phone: ADMIN, name: 'Felipe', at: '2026-11-09T15:05:00Z', text: '#BAN', quoted: quoted(BRUNO) });
    expect(removed).toEqual([`${BRUNO}@s.whatsapp.net`]);
    expect(w.wa.last()).toContain('*Bruno* foi removido(a) do grupo');
  });
});
