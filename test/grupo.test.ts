import { afterEach, describe, expect, it } from 'vitest';
import { GROUP, world, type World } from './helpers.js';

const ADMIN = '5511900000001';
const ANA = '5511911111111';

let w: World | undefined;
afterEach(async () => {
  await w?.sql.end();
  w = undefined;
});

describe('#fechargrupo / #abrirgrupo', () => {
  it('só admin fecha e abre; sem permissão no WhatsApp, pede para mudar à mão', async () => {
    w = await world();
    await w.send({ phone: ANA, at: '2026-11-09T12:00:00Z', text: '#fechargrupo' });
    expect(w.wa.last()).toContain('Só os admins podem fechar o grupo');

    // provedor sem a função (ou bot sem ser admin do grupo)
    await w.send({ phone: ADMIN, at: '2026-11-09T12:01:00Z', text: '#FecharGrupo' });
    expect(w.wa.last()).toContain('Não consegui fechar o grupo');

    const calls: [string, boolean][] = [];
    Object.assign(w.wa, { setAdminsOnly: async (chat: string, on: boolean) => void calls.push([chat, on]) });
    await w.send({ phone: ADMIN, at: '2026-11-09T12:02:00Z', text: '#fechar grupo' });
    expect(w.wa.last()).toContain('🔒 Grupo fechado');
    await w.send({ phone: ADMIN, at: '2026-11-09T12:03:00Z', text: '#abrirgrupo' });
    expect(w.wa.last()).toContain('🔓 Grupo aberto');
    expect(calls).toEqual([
      [GROUP, true],
      [GROUP, false],
    ]);
  });
});
