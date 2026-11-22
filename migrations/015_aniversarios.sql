-- #nascimento: dia e mês do aniversário (ano só se a pessoa quiser informar).
-- Guarda só o telefone para poder marcar a pessoa; o nome vem de wa_people.
create table birthdays (
  bot_id        uuid not null references bots(id) on delete cascade,
  member_key    text not null,              -- 8 últimos dígitos do telefone
  phone         text not null,              -- só dígitos, para marcar com @
  day           smallint not null check (day between 1 and 31),
  month         smallint not null check (month between 1 and 12),
  year          smallint,                   -- opcional
  greeted_year  smallint,                   -- último ano em que o bot deu parabéns
  updated_at    timestamptz not null default now(),
  primary key (bot_id, member_key)
);

-- #horoscopo: no máximo um por pessoa por dia (admins liberados). Não guarda o texto.
create table horoscope_readings (
  bot_id      uuid not null references bots(id) on delete cascade,
  member_key  text not null,
  day         date not null,
  primary key (bot_id, member_key, day)
);
