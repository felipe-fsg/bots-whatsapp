-- Membros conhecidos de cada grupo, para dar boas-vindas a quem entra.
-- A AvisaAPI não avisa entradas, então o bot confere a lista de membros de tempos em tempos.
create table group_members (
  bot_id       uuid not null references bots(id) on delete cascade,
  member_key   text not null,          -- telefone (ou LID, se o telefone não vier)
  welcomed_at  timestamptz,            -- null = já estava no grupo quando o bot começou a acompanhar
  seen_at      timestamptz not null default now(),
  primary key (bot_id, member_key)
);
