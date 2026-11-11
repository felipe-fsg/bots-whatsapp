-- Instagram que cada pessoa informa no grupo (#insta), para a #listainsta. Só o @, sem mais nada.
create table member_instagram (
  bot_id      uuid not null references bots(id) on delete cascade,
  phone       text not null,
  handle      text not null,
  updated_at  timestamptz not null default now(),
  primary key (bot_id, phone)
);
