export type CheckinStatus = 'valido' | 'aguardando_localizacao' | 'em_revisao' | 'recusado';
export type RuleKind = 'treino' | 'comida' | 'pose' | 'outro';

export interface Challenge {
  id: string;
  bot_id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  status: 'rascunho' | 'ativo' | 'encerrado';
  timezone: string;
  checkin_deadline: string;
  require_location: boolean;
  location_window_min: number;
  location_radius_m: number;
  place_types: string[];
  confirm_valid: boolean;
  max_workouts_week: number;
  team_bonus_points: number;
  ai_photo_check: boolean;
  require_pose: boolean;
  daily_summary: boolean;
  persona_messages: boolean;
  persona_interval_h: number;
  paused: boolean;
  paused_at: Date | null;
  paused_by: string | null;
  reset_step: number;
  reset_by: string | null;
  reset_asked_at: Date | null;
}

export interface Rule {
  id: number;
  category: string;
  hashtag: string;
  kind: RuleKind;
  points: number;
  max_per_day: number;
  active: boolean;
}

export interface Participant {
  id: string;
  phone: string;
  name: string;
  ranking_name: string | null;
  active: boolean;
  team_id: string | null;
}

export interface Checkin {
  id: string;
  participant_id: string;
  category: string;
  kind: RuleKind;
  provider_msg_id: string;
  sent_at: Date;
  day: string;
  status: CheckinStatus;
  reason: string;
  points: number;
}

export function displayName(p: Pick<Participant, 'name' | 'ranking_name'>): string {
  return p.ranking_name || p.name;
}
