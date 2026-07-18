import type { MapConfig, ThemeMode } from "../configs/MapConfig";

/** Resolves `theme_mode` ("auto"|"light"|"dark") against the system preference. */
export function resolveThemeMode(themeMode: ThemeMode, prefersDark: boolean): "light" | "dark" {
  if (themeMode === "auto") return prefersDark ? "dark" : "light";
  return themeMode;
}

/** Picks a style URL from a light/dark pair for the current theme — shared by
 * resolveStyle() (the card's primary map_style/map_style_dark) and the layer
 * switcher, which resolves the same way for whichever base-style entry is
 * currently selected (see LayerRegistry.BaseStyleEntry). */
export function resolveStylePair(
  pair: { styleLight: string; styleDark: string },
  themeMode: ThemeMode,
  prefersDark: boolean,
): string {
  return resolveThemeMode(themeMode, prefersDark) === "dark" ? pair.styleDark : pair.styleLight;
}

/** Picks the MapLibre style URL for the current theme. */
export function resolveStyle(config: MapConfig, prefersDark: boolean): string {
  return resolveStylePair(config, config.themeMode, prefersDark);
}

const RELATIVE_TIME_RE = /^(\d+)\s+(minute|hour|day|week)s?\s+ago$/i;
const ENTITY_ID_RE = /^[a-z_]+\.[a-z0-9_]+$/;
const UNIT_MS: Record<string, number> = { minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5 };

/**
 * Resolves a `history_start`/`history_end`-style value ("5 hours ago", an
 * absolute ISO date, etc.) into a Date. Entity-value refs (e.g.
 * "input_number.example", interpreted as a number of hours by upstream)
 * need a hass state lookup and aren't resolved here — see CLAUDE.md Phase 9.
 * Returns null for anything unresolvable so callers can skip that entity's
 * history rather than render against an Invalid Date.
 */
export function resolveTime(value: string, now: Date = new Date()): Date | null {
  const trimmed = value.trim();

  const relative = RELATIVE_TIME_RE.exec(trimmed);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2]!.toLowerCase();
    return new Date(now.getTime() - amount * UNIT_MS[unit]!);
  }

  if (ENTITY_ID_RE.test(trimmed)) return null;

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
