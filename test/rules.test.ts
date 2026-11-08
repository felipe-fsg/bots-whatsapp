import { describe, expect, it } from 'vitest';
import { decide, findRule, hashtags, inPeriod, parseCommand, parseVerdict } from '../src/modules/splinter/rules.js';
import type { Rule } from '../src/modules/splinter/types.js';
import { parseWhatsmeowEvent } from '../src/core/whatsapp/whatsmeow.js';
import { samePhone } from '../src/core/phone.js';

const rule = (o: Partial<Rule>): Rule => ({ id: 1, category: 'Treino', hashtag: '#treino', kind: 'treino', points: 1, max_per_day: 1, active: true, ...o });
const ch = { require_location: true, max_workouts_week: 5 };

describe('hashtags e regras', () => {
  it('acha a hashtag exata, sem confundir #pose com #posedodia', () => {
    const rules = [rule({ id: 1, hashtag: '#pose', kind: 'pose', category: 'Pose' }), rule({ id: 2 })];
    expect(hashtags('Bora! #Treino #foco')).toEqual(['#treino', '#foco']);
    expect(findRule('Hoje teve #TREINO pesado', rules)?.id).toBe(2);
    expect(findRule('#posedodia', rules)).toBeUndefined();
    expect(findRule('sem hashtag', rules)).toBeUndefined();
  });

  it('respeita datas e horário limite', () => {
    const c = { starts_on: '2026-11-09', ends_on: '2026-11-30', checkin_deadline: '23:59' };
    expect(inPeriod('2026-11-09', '07:00', c)).toBe(true);
    expect(inPeriod('2026-11-08', '07:00', c)).toBe(false);
    expect(inPeriod('2026-12-01', '07:00', c)).toBe(false);
    expect(inPeriod('2026-11-10', '23:59', { ...c, checkin_deadline: '22:00' })).toBe(false);
  });

  it('decide o status na mesma ordem do n8n', () => {
    expect(decide(rule({}), ch, { duplicatePhoto: true, sameDay: 0, sameWeek: 0 }).reason).toBe('Foto já usada antes');
    expect(decide(rule({}), ch, { duplicatePhoto: false, sameDay: 1, sameWeek: 0 }).reason).toBe('Categoria já pontuada hoje');
    expect(decide(rule({}), ch, { duplicatePhoto: false, sameDay: 0, sameWeek: 5 }).reason).toBe('Limite semanal de treinos atingido');
    expect(decide(rule({}), ch, { duplicatePhoto: false, sameDay: 0, sameWeek: 4 }).status).toBe('aguardando_localizacao');
    expect(decide(rule({ kind: 'outro' }), ch, { duplicatePhoto: false, sameDay: 0, sameWeek: 9 })).toEqual({ status: 'valido', reason: '', points: 1 });
  });

  it('entende os comandos', () => {
    expect(parseCommand('!ranking')).toEqual({ type: 'ranking' });
    expect(parseCommand('#equipes')).toEqual({ type: 'equipes' });
    expect(parseCommand('#equipe Tartarugas Ninja @5511 @5522')).toEqual({ type: 'equipe', name: 'Tartarugas Ninja' });
    expect(parseCommand('?tapioca')).toEqual({ type: 'alimento', food: 'tapioca' });
    expect(parseCommand('? ')).toBeNull();
    expect(parseCommand('#recusar foto sem a pose')).toEqual({ type: 'recusar', note: 'foto sem a pose' });
    expect(parseCommand('#inscrever  Maria   Silva')).toEqual({ type: 'inscrever', name: 'Maria Silva' });
    expect(parseCommand('bom dia @all')).toBeNull();
  });

  it('lê o veredito da IA', () => {
    const opts = ['SAUDAVEL', 'NAO_SAUDAVEL', 'DUVIDA'] as const;
    expect(parseVerdict('VEREDITO: **NAO_SAUDAVEL**\nMOTIVO: tem bacon.', opts, 'DUVIDA')).toEqual({ verdict: 'NAO_SAUDAVEL', why: 'tem bacon.' });
    expect(parseVerdict('não sei', opts, 'DUVIDA').verdict).toBe('DUVIDA');
  });

  it('compara telefones pelos 8 últimos dígitos (com ou sem o 9)', () => {
    expect(samePhone('5511911111111', '551111111111')).toBe(true);
    expect(samePhone('5511911111111', '5511922222222')).toBe(false);
  });
});

describe('evento do whatsmeow', () => {
  it('lê foto com legenda, telefone pelo SenderAlt e resposta citada', () => {
    const msg = parseWhatsmeowEvent({
      event: {
        Info: { ID: 'A1', Chat: 'x@g.us', Sender: '123@lid', SenderAlt: '5511911111111:3@s.whatsapp.net', PushName: 'Ana', Timestamp: '2026-11-09T10:00:00Z' },
        Message: { ephemeralMessage: { message: { imageMessage: { caption: ' #treino ', fileSHA256: 'abc', mimetype: 'image/jpeg', contextInfo: { stanzaID: 'Q1', participant: '999@lid', quotedMessage: { conversation: 'Ana Souza' } } } } } },
      },
    });
    expect(msg).toMatchObject({ id: 'A1', type: 'image', text: '#treino', senderPhone: '5511911111111', senderLid: '123@lid', image: { sha256: 'abc' }, quoted: { messageId: 'Q1', participant: '999@lid', text: 'Ana Souza' } });
  });

  it('ignora eventos que não são mensagem', () => {
    expect(parseWhatsmeowEvent({ event: { type: 'presence' } })).toBeNull();
  });
});
