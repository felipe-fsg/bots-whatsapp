-- Bot de dúvidas técnicas: cada resposta do bot vira um "card" que os sêniores revisam.
-- O id do card forma o id da ficha revisada na base vetorial (C00012 = card 12), por isso é global.
create table tecnico_cards (
  id               serial primary key,
  bot_id           uuid not null references bots(id) on delete cascade,
  question_msg_id  text,
  bot_msg_id       text,                 -- id da mensagem do bot no WhatsApp (a revisão responde a ela)
  asked_by_name    text,
  asked_by_phone   text,
  question         text not null default '',
  answer           text not null default '',
  sources          text not null default '',   -- fichas usadas, ex.: "C00003, H02414"
  status           text not null default 'nao_revisada'
                   check (status in ('nao_revisada', 'revisada_correta', 'corrigida', 'acrescentada', 'lixeira')),
  previous_status  text,
  reviewed_by      text,
  reviewed_at      timestamptz,
  correction       text,
  addition         text,
  deleted_by       text,
  deleted_at       timestamptz,
  created_at       timestamptz not null default now()
);
create index tecnico_cards_bot_msg on tecnico_cards (bot_id, bot_msg_id);
