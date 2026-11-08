-- Núcleo multi-cliente: clientes, números de WhatsApp e bots (um bot = um grupo).

create extension if not exists pgcrypto;

create table tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

-- Um número de WhatsApp conectado num provedor (hoje AvisaAPI).
-- O token não fica no banco: token_env diz qual variável de ambiente guarda o token.
create table wa_connections (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,
  provider    text not null default 'avisa' check (provider in ('avisa')),
  base_url    text not null default 'https://www.avisaapi.com.br/api',
  token_env   text not null,
  -- Para onde repassar mensagens de conversas que nenhum bot atende (ex.: fluxo antigo no n8n).
  forward_url   text,
  -- Se preenchido, só repassa estas conversas. Vazio = repassa todas as que nenhum bot atende.
  forward_chats text[] not null default '{}',
  created_at  timestamptz not null default now()
);

create table bots (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  connection_id  uuid not null references wa_connections(id),
  name           text not null,
  module         text not null,            -- ex.: 'splinter'
  chat_jid       text not null,            -- ex.: 1203...@g.us
  active         boolean not null default true,
  settings       jsonb not null default '{}',
  created_at     timestamptz not null default now(),
  unique (connection_id, chat_jid)
);

create table bot_admins (
  bot_id  uuid not null references bots(id) on delete cascade,
  phone   text not null,                   -- só dígitos, com DDI
  name    text,
  primary key (bot_id, phone)
);

-- Evita processar a mesma mensagem duas vezes (o provedor pode reenviar o webhook).
create table processed_messages (
  provider_msg_id  text primary key,
  bot_id           uuid references bots(id) on delete cascade,
  received_at      timestamptz not null default now()
);

-- O WhatsApp identifica pessoas por LID (@lid) em menções e respostas.
-- Guardamos LID -> telefone aprendido das mensagens e da lista de membros do grupo.
create table wa_contacts (
  connection_id  uuid not null references wa_connections(id) on delete cascade,
  lid            text not null,
  phone          text not null,
  updated_at     timestamptz not null default now(),
  primary key (connection_id, lid)
);
