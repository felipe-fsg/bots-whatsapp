-- Leituras do #tarot: no máximo uma por pessoa por dia (admins liberados).
-- Guarda só as cartas sorteadas, sem a pergunta de quem pediu.
create table tarot_readings (
  bot_id      uuid not null references bots(id) on delete cascade,
  member_key  text not null,              -- 8 últimos dígitos do telefone
  day         date not null,              -- dia no fuso do grupo
  cards       text not null,
  created_at  timestamptz not null default now(),
  primary key (bot_id, member_key, day)
);
