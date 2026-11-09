/** Parte comum do cadastro de qualquer bot: cliente, número (conexão), grupo e admins. */
import { z } from 'zod';
import type { Sql } from '../src/db.js';
import { digits } from '../src/core/phone.js';

export const BaseSeed = z.object({
  cliente: z.string(),
  conexao: z.object({
    nome: z.string(),
    url_base: z.string().default('https://www.avisaapi.com.br/api'),
    variavel_do_token: z.string(),
    repassar_para: z.string().nullish(),
    repassar_so_estes_grupos: z.array(z.string()).default([]),
  }),
  bot: z.object({ nome: z.string(), modulo: z.string().default('geral'), grupo: z.string().endsWith('@g.us') }),
  admins: z.array(z.object({ nome: z.string(), telefone: z.string() })).default([]),
});
export type BaseSeed = z.infer<typeof BaseSeed>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function upsertBase(tx: any, s: BaseSeed): Promise<{ botId: string; connectionId: string }> {
  const tenant =
    (await tx`select id from tenants where name = ${s.cliente}`)[0] ?? (await tx`insert into tenants (name) values (${s.cliente}) returning id`)[0]!;

  const connRow = {
    label: s.conexao.nome,
    base_url: s.conexao.url_base,
    token_env: s.conexao.variavel_do_token,
    forward_url: s.conexao.repassar_para ?? null,
    forward_chats: s.conexao.repassar_so_estes_grupos,
  };
  const existingConn = (await tx`select id from wa_connections where token_env = ${connRow.token_env}`)[0];
  const conn = existingConn
    ? (await tx`update wa_connections set ${tx(connRow)} where id = ${existingConn.id} returning id`)[0]!
    : (await tx`insert into wa_connections ${tx(connRow)} returning id`)[0]!;

  const [bot] = await tx`
    insert into bots (tenant_id, connection_id, name, module, chat_jid)
    values (${tenant.id}, ${conn.id}, ${s.bot.nome}, ${s.bot.modulo}, ${s.bot.grupo})
    on conflict (connection_id, chat_jid) do update set name = excluded.name, module = excluded.module, active = true
    returning id`;

  for (const a of s.admins) {
    await tx`insert into bot_admins (bot_id, phone, name) values (${bot!.id}, ${digits(a.telefone)}, ${a.nome})
      on conflict (bot_id, phone) do update set name = excluded.name`;
  }
  return { botId: bot!.id, connectionId: conn.id };
}

/** Bot geral: só as funções do núcleo (agenda, resumo, mascote). */
export async function seedGeneral(sql: Sql, input: unknown) {
  const s = BaseSeed.parse(input);
  return sql.begin((tx) => upsertBase(tx, s));
}
