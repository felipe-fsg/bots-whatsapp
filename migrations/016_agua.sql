-- Bot de qualidade da água: laudos que o outro sistema manda para o grupo pedir autorização.
-- Guarda só o que aparece no grupo e a decisão dos admins (o PDF do laudo fica no outro sistema).
create table agua_laudos (
  id              uuid primary key default gen_random_uuid(),
  bot_id          uuid not null references bots(id) on delete cascade,
  external_id     text not null,                 -- código do laudo no outro sistema
  resultado       text not null check (resultado in ('satisfatorio', 'insatisfatorio')),
  dados           jsonb not null default '{}',   -- cliente, equipamento, OS, resumo... como chegaram
  status          text not null default 'pendente' check (status in ('pendente', 'aprovado', 'recusado')),
  group_msg_id    text,                          -- mensagem do bot no grupo (para achar o #aprovar em resposta)
  decided_by      text,                          -- nome de quem decidiu
  decided_phone   text,
  decided_at      timestamptz,
  motivo          text,
  callback_url    text,
  callback_status text,                          -- 'ok', 'falhou: ...' ou null (sem endereço)
  created_at      timestamptz not null default now(),
  unique (bot_id, external_id)
);
create index agua_laudos_pendentes on agua_laudos (bot_id) where status = 'pendente';
