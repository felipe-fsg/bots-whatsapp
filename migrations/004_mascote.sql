-- Mascote (personagem) de cada grupo. Sem linha aqui, vale o mascote padrão do módulo.
create table bot_mascots (
  bot_id      uuid primary key references bots(id) on delete cascade,
  name        text not null,
  persona     text not null,                -- instruções de personalidade para a IA
  set_by      text,
  updated_at  timestamptz not null default now()
);
