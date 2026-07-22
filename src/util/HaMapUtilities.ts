import type { ThemeMode } from "../configs/MapConfig";

/** Resolves `theme_mode` ("auto"|"light"|"dark") against the system preference. */
export function resolveThemeMode(themeMode: ThemeMode, prefersDark: boolean): "light" | "dark" {
  if (themeMode === "auto") return prefersDark ? "dark" : "light";
  return themeMode;
}

/** Picks a style URL from a light/dark pair for the current theme. Used both
 * for the card's own map_style/map_style_dark (a MapConfig satisfies the pair
 * shape structurally) and by the layer switcher, which resolves the same way
 * for whichever base-style entry is selected (see LayerRegistry.BaseStyleEntry). */
export function resolveStylePair(
  pair: { styleLight: string; styleDark: string },
  themeMode: ThemeMode,
  prefersDark: boolean,
): string {
  return resolveThemeMode(themeMode, prefersDark) === "dark" ? pair.styleDark : pair.styleLight;
}

/**
 * True when a CSS color reads as "dark" (perceived luminance below mid), used
 * to decide whether the map controls sit on a dark background and therefore
 * need their light-on-dark treatment. Parses hex (#rgb/#rrggbb) and
 * rgb()/rgba() — the forms HA's --card-background-color takes — and treats
 * anything unrecognised (or unset) as light, so controls keep their default
 * light look unless we can positively tell the background is dark.
 */
export function isColorDark(color: string | undefined | null): boolean {
  const c = (color ?? "").trim();
  let r: number;
  let g: number;
  let b: number;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(c);
  if (hex) {
    const h = hex[1]!.length === 3 ? hex[1]!.replace(/./g, "$&$&") : hex[1]!;
    const n = parseInt(h, 16);
    r = (n >> 16) & 255;
    g = (n >> 8) & 255;
    b = n & 255;
  } else if (rgb) {
    r = Number(rgb[1]);
    g = Number(rgb[2]);
    b = Number(rgb[3]);
  } else {
    return false;
  }
  // Perceived luminance (ITU-R BT.601); < 128 → dark.
  return 0.299 * r + 0.587 * g + 0.114 * b < 128;
}

const RELATIVE_TIME_RE = /^(\d+)\s+(minute|hour|day|week)s?\s+ago$/i;
const ENTITY_ID_RE = /^[a-z_]+\.[a-z0-9_]+$/;
const UNIT_MS: Record<string, number> = { minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5 };

/**
 * Resolves a `history_start`/`history_end`-style value ("5 hours ago", an
 * absolute ISO date, etc.) into a Date. Entity-value refs (e.g.
 * "input_number.example", interpreted as a number of hours by upstream)
 * need a hass state lookup and aren't resolved here — see CLAUDE.md's
 * "Porting backlog".
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
