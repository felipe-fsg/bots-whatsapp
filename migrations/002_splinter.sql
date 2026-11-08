-- Módulo Mestre Splinter: desafio fitness com check-ins por foto.

create table splinter_challenges (
  id                    uuid primary key default gen_random_uuid(),
  bot_id                uuid not null references bots(id) on delete cascade,
  name                  text not null,
  starts_on             date not null,
  ends_on               date not null,
  status                text not null default 'rascunho' check (status in ('rascunho', 'ativo', 'encerrado')),
  timezone              text not null default 'America/Sao_Paulo',
  checkin_deadline      text not null default '23:59',       -- HH:mm, mesmo dia
  require_location      boolean not null default true,        -- #treino pede localização
  location_window_min   integer not null default 10,
  location_radius_m     integer not null default 150,
  place_types           text[] not null default '{gym}',      -- tipos da Google Places API
  confirm_valid         boolean not null default false,       -- avisar no grupo também os check-ins válidos
  max_workouts_week     integer not null default 5,           -- 0 = sem limite; semana começa na segunda
  team_bonus_points     numeric not null default 1,           -- dupla que treina no mesmo dia
  ai_photo_check        boolean not null default true,
  require_pose          boolean not null default true,
  daily_summary         boolean not null default true,        -- resumo às 4h
  persona_messages      boolean not null default true,        -- mensagens ao longo do dia
  persona_interval_h    integer not null default 1,
  created_at            timestamptz not null default now()
);
create unique index splinter_one_active_challenge on splinter_challenges (bot_id) where status = 'ativo';

create table splinter_rules (
  id            serial primary key,
  challenge_id  uuid not null references splinter_challenges(id) on delete cascade,
  category      text not null,                -- nome mostrado: Treino, Alimentação...
  hashtag       text not null,                -- '#treino', sempre minúsculo
  kind          text not null default 'outro' check (kind in ('treino', 'comida', 'pose', 'outro')),
  points        numeric not null default 1,
  max_per_day   integer not null default 1,
  active        boolean not null default true,
  unique (challenge_id, hashtag)
);

create table splinter_teams (
  id            uuid primary key default gen_random_uuid(),
  challenge_id  uuid not null references splinter_challenges(id) on delete cascade,
  name          text not null
);
create unique index splinter_team_name on splinter_teams (challenge_id, lower(name));

create table splinter_participants (
  id            uuid primary key default gen_random_uuid(),
  challenge_id  uuid not null references splinter_challenges(id) on delete cascade,
  phone         text not null,                -- só dígitos, com DDI
  name          text not null,
  ranking_name  text,
  active        boolean not null default true,
  team_id       uuid references splinter_teams(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (challenge_id, phone)
);

create table splinter_checkins (
  id               uuid primary key default gen_random_uuid(),
  challenge_id     uuid not null references splinter_challenges(id) on delete cascade,
  participant_id   uuid not null references splinter_participants(id) on delete cascade,
  rule_id          integer references splinter_rules(id) on delete set null,
  category         text not null,
  kind             text not null,
  provider_msg_id  text not null unique,
  sent_at          timestamptz not null,
  day              date not null,             -- dia no fuso do desafio
  status           text not null check (status in ('valido', 'aguardando_localizacao', 'em_revisao', 'recusado')),
  reason           text not null default '',
  points           numeric not null default 0,
  photo_sha256     text,
  ai_analysis      text,
  place_name       text,                      -- só o resultado; coordenadas do participante não são guardadas (LGPD)
  distance_m       integer,
  reviewed_by      text,
  created_at       timestamptz not null default now()
);
create index splinter_checkins_by_day on splinter_checkins (challenge_id, participant_id, day);
create index splinter_checkins_by_photo on splinter_checkins (challenge_id, photo_sha256);
create index splinter_checkins_by_status on splinter_checkins (challenge_id, status);

-- Locais de treino que não aparecem no Google Maps (casa, condomínio).
-- participant_id nulo = vale para todos.
create table splinter_places (
  id              serial primary key,
  challenge_id    uuid not null references splinter_challenges(id) on delete cascade,
  participant_id  uuid references splinter_participants(id) on delete cascade,
  name            text not null,
  lat             double precision not null,
  lng             double precision not null
);

create table splinter_poses (
  id               serial primary key,
  challenge_id     uuid not null references splinter_challenges(id) on delete cascade,
  day              date not null,
  title            text not null,
  image            bytea,
  image_mime       text,
  posted_by        text,
  provider_msg_id  text,
  created_at       timestamptz not null default now()
);
create index splinter_poses_by_day on splinter_poses (challenge_id, day);

-- Lista oficial dos admins: tem prioridade sobre a IA.
create table splinter_foods (
  id            serial primary key,
  challenge_id  uuid not null references splinter_challenges(id) on delete cascade,
  name          text not null,
  verdict       text not null check (verdict in ('saudavel', 'nao_saudavel'))
);
create unique index splinter_food_name on splinter_foods (challenge_id, lower(name));
