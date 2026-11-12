-- Pedidos de #suporte dos admins (problema ou melhoria). Viram issue no GitHub quando há token.
create table support_requests (
  id            serial primary key,
  bot_id        uuid not null references bots(id) on delete cascade,
  phone         text not null,
  name          text,
  text          text not null,
  issue_number  int,
  issue_url     text,
  created_at    timestamptz not null default now()
);
create index on support_requests (bot_id, created_at desc);
