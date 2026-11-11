-- Estado civil que cada pessoa informa no grupo (#estadocivil), para o #pista. Texto livre e curto.
create table member_relationship (
  bot_id      uuid not null references bots(id) on delete cascade,
  phone       text not null,
  status      text not null,
  updated_at  timestamptz not null default now(),
  primary key (bot_id, phone)
);
