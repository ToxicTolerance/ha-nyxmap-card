export interface HassEntityAttributes {
  friendly_name?: string;
  latitude?: number;
  longitude?: number;
  gps_accuracy?: number;
  icon?: string;
  entity_picture?: string;
  [key: string]: unknown;
}

export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: HassEntityAttributes;
  last_changed: string;
  last_updated: string;
}

export interface HomeAssistant {
  states: Record<string, HassEntity>;
  callWS<T>(msg: Record<string, unknown>): Promise<T>;
  language: string;
}

export interface LovelaceCardConfig {
  type: string;
  [key: string]: unknown;
}

/** One row of a `history/history_during_period` (minimal_response) result. */
export interface HistoryDuringPeriodRow {
  a?: { latitude?: number; longitude?: number; [key: string]: unknown };
  s?: string;
  lu?: number;
}

export type HistoryDuringPeriodResult = Record<string, HistoryDuringPeriodRow[]>;
