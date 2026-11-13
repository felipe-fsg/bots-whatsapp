-- #pausar / #despausar e #reiniciar do desafio fitness.

alter table splinter_challenges
  add column paused          boolean not null default false,  -- pausado: fotos não pontuam
  add column paused_at       timestamptz,
  add column paused_by       text,
  add column reset_step      integer not null default 0,       -- #reiniciar: quantas vezes o admin já confirmou
  add column reset_by        text,                             -- telefone do admin que pediu
  add column reset_asked_at  timestamptz;

-- Cada vez que a pontuação foi zerada. Guarda o ranking de antes, para consulta.
create table splinter_resets (
  id            serial primary key,
  challenge_id  uuid not null references splinter_challenges(id) on delete cascade,
  done_by       text not null,
  done_at       timestamptz not null default now(),
  checkins      integer not null,
  ranking       jsonb not null default '[]'
);

-- Check-ins tirados do desafio pelo #reiniciar (cópia completa, em JSON, para não perder nada).
create table splinter_checkins_arquivo (
  id           bigserial primary key,
  reset_id     integer not null references splinter_resets(id) on delete cascade,
  checkin      jsonb not null,
  photo_sha256 text
);
create index splinter_checkins_arquivo_photo on splinter_checkins_arquivo (photo_sha256);
