-- Competição aberta de treinos (#monitorartreinos): qualquer um entra com #ficargostoso / #ficargostosa,
-- pontuação individual (sem duplas) e parabéns do mascote para quem mais pontuou no dia.

alter table splinter_challenges
  add column open_mode      boolean not null default false,  -- true = competição aberta
  add column daily_congrats boolean not null default true;   -- parabéns às 23h59 (#ativarparabens / #desativarparabens)
