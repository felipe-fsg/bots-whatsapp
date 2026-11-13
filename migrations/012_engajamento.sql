-- Quantas mensagens cada pessoa já mandou no grupo, para o ranking #engajamento.
-- Guarda só a contagem, sem o conteúdo das mensagens.
create table member_message_counts (
  bot_id      uuid not null references bots(id) on delete cascade,
  member_key  text not null,              -- 8 últimos dígitos do telefone
  phone       text not null,
  messages    int not null default 0,
  first_at    timestamptz not null,       -- primeira mensagem contada
  last_at     timestamptz not null,       -- última mensagem contada
  primary key (bot_id, member_key)
);

-- Começa já com o que o bot ainda tem guardado para o #resumo (últimos 3 dias).
insert into member_message_counts (bot_id, member_key, phone, messages, first_at, last_at)
select g.bot_id, right(regexp_replace(g.sender_phone, '\D', '', 'g'), 8), max(regexp_replace(g.sender_phone, '\D', '', 'g')),
       count(*), min(g.sent_at), max(g.sent_at)
from group_messages g join bots b on b.id = g.bot_id
where b.module <> 'tecnico' and length(regexp_replace(coalesce(g.sender_phone, ''), '\D', '', 'g')) >= 8
group by g.bot_id, right(regexp_replace(g.sender_phone, '\D', '', 'g'), 8);
