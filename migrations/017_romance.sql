-- #orientação: o que a pessoa quis registrar para o #datealeatorio e o #shippar (só grupos sociais).
-- Opcional e sensível (LGPD): guarda só gênero e orientação, sem telefone completo e sem nome.
-- A pessoa apaga quando quiser com "#orientação remover". Nunca vai para a IA.
create table member_orientations (
  bot_id      uuid not null references bots(id) on delete cascade,
  member_key  text not null,              -- 8 últimos dígitos do telefone
  gender      text not null check (gender in ('h', 'm', 'nb')),
  orientation text not null check (orientation in ('hetero', 'homo', 'bi', 'fora')),
  updated_at  timestamptz not null default now(),
  primary key (bot_id, member_key)
);

-- Casais que já saíram no #shippar e no #datealeatorio, para não repetir.
-- run_at agrupa os casais de uma mesma rodada. Só os pedaços de telefone (8 últimos dígitos).
create table romance_pairs (
  bot_id      uuid not null references bots(id) on delete cascade,
  kind        text not null check (kind in ('ship', 'date')),
  run_at      timestamptz not null,
  pair_key    text not null,              -- "aaaaaaaa|bbbbbbbb", em ordem
  primary key (bot_id, kind, run_at, pair_key)
);
