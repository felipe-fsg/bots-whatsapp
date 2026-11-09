-- Atividade dos membros, para avisar quem está sumido (#ativarBAN).
-- Guarda só quando a pessoa falou por último, sem o conteúdo das mensagens.
create table member_activity (
  bot_id          uuid not null references bots(id) on delete cascade,
  member_key      text not null,             -- 8 últimos dígitos do telefone
  phone           text not null,
  tracked_since   timestamptz not null default now(),  -- desde quando o bot acompanha a pessoa
  last_seen_at    timestamptz,               -- última mensagem no grupo (null = nunca falou desde que o bot acompanha)
  warnings        int not null default 0,    -- avisos seguidos sem interagir; zera quando a pessoa fala
  last_warned_at  timestamptz,
  primary key (bot_id, member_key)
);

-- Telefone do próprio número do bot, aprendido das mensagens que ele mesmo manda (nunca é avisado).
alter table wa_connections add column own_phone text;
