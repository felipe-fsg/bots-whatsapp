-- Nome que cada pessoa usa no WhatsApp (para mostrar quem organiza ou confirmou presença).
create table wa_people (
  connection_id  uuid not null references wa_connections(id) on delete cascade,
  phone          text not null,
  push_name      text not null,
  updated_at     timestamptz not null default now(),
  primary key (connection_id, phone)
);

-- Agenda de eventos do grupo: função do núcleo, vale para qualquer bot.
create table events (
  id               uuid primary key default gen_random_uuid(),
  bot_id           uuid not null references bots(id) on delete cascade,
  title            text not null,
  starts_on        date not null,
  start_time       text,                     -- HH:mm, opcional
  place            text,
  organizer_name   text,
  organizer_phone  text,
  source_msg_id    text,                     -- mensagem com a sugestão (a que o admin respondeu com #agendar)
  created_by       text,
  status           text not null default 'agendado' check (status in ('agendado', 'cancelado', 'passado')),
  created_at       timestamptz not null default now()
);
create index events_upcoming on events (bot_id, status, starts_on);
create unique index events_one_per_suggestion on events (bot_id, source_msg_id) where source_msg_id is not null;

create table event_attendees (
  event_id    uuid not null references events(id) on delete cascade,
  phone       text not null,
  name        text not null,
  created_at  timestamptz not null default now(),
  primary key (event_id, phone)
);
