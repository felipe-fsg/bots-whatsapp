-- Mensagens dos grupos atendidos, guardadas por poucos dias só para o #resumo.
-- Localização entra como "[localização]", sem coordenadas. Apagadas automaticamente (ver features/resumo).
create table group_messages (
  bot_id        uuid not null references bots(id) on delete cascade,
  msg_id        text not null,
  sent_at       timestamptz not null,
  sender_phone  text,
  sender_name   text,
  text          text not null,
  primary key (bot_id, msg_id)
);
create index group_messages_by_time on group_messages (bot_id, sent_at);
