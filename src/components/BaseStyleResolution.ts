import type { ThemeMode } from "../configs/MapConfig";
import type { BaseStyleEntry } from "../services/render/LayerRegistry";
import { resolveStylePair, resolveThemeMode } from "../util/HaMapUtilities";

/**
 * The base-style / theme decision logic behind the layer switcher, as pure
 * functions of the card's config and the switcher's two runtime overrides
 * (`_manualStyleId`, `_manualThemeMode`). Kept out of the `NyxmapCard` element
 * — the same reason `LayerSwitcherLayout` and `EntityListReconcile` are: jsdom
 * implements no layout and the element is otherwise reachable only through the
 * heavy jsdom test file, so this branch-heavy logic (manual-vs-auto precedence,
 * the zoom-range fallback chain) is tested here under `node` instead.
 */

/** A light/dark style-url pair — the shape both the card-level config and each
 * named `map_styles` entry share, and all `resolveStylePair` needs. */
export interface StylePair {
  styleLight: string;
  styleDark: string;
}

/** The effective theme mode: the switcher's own Auto/Light/Dark override when
 * set, else the configured `theme_mode`, else `auto`. */
export function effectiveThemeMode(
  manualThemeMode: ThemeMode | undefined,
  configThemeMode: ThemeMode | undefined,
): ThemeMode {
  return manualThemeMode ?? configThemeMode ?? "auto";
}

/**
 * The active MapLibre style-JSON url. A manual base-style pick (`manualStyleId`)
 * wins over the config's own `map_style`/`map_style_dark`, but either way the
 * chosen entry is still a light/dark pair resolved against the effective theme
 * mode — so a genuinely dual-variant custom style keeps following the theme
 * even while "selected". A `manualStyleId` that names no registered entry (e.g.
 * a `map_styles` entry deleted after it was picked) falls through to the config.
 */
export function resolveActiveStyleUrl(
  config: StylePair,
  manualStyleId: string | undefined,
  themeMode: ThemeMode,
  prefersDark: boolean,
  baseStyles: ReadonlyMap<string, BaseStyleEntry>,
): string {
  if (manualStyleId) {
    const entry = baseStyles.get(manualStyleId);
    if (entry) return resolveStylePair(entry, themeMode, prefersDark);
  }
  return resolveStylePair(config, themeMode, prefersDark);
}

/**
 * The base-style id the switcher should treat as selected by default for a
 * config: the named `map_styles` entry whose light/dark pair matches the
 * card-level `map_style`/`map_style_dark` (so the initially auto-resolved style
 * shows as "selected"), or `undefined` when none matches — in which case the
 * generic Light/Dark defaults apply. Used both at initial build and to re-derive
 * a valid selection after a manually-selected entry is deleted from config, so
 * the two states agree.
 */
export function initialManualStyleId(config: {
  styleLight: string;
  styleDark: string;
  mapStyles: ReadonlyArray<{ name: string; styleLight: string; styleDark: string }>;
}): string | undefined {
  const entry = config.mapStyles.find(
    (s) => s.styleLight === config.styleLight && s.styleDark === config.styleDark,
  );
  return entry ? `custom:${entry.name}` : undefined;
}

/** Which generic base-style radio ("light"/"dark") is highlighted when no named
 * `map_styles` entry is manually selected — the one matching the resolved
 * theme. */
export function defaultBaseStyleId(themeMode: ThemeMode, prefersDark: boolean): "light" | "dark" {
  return resolveThemeMode(themeMode, prefersDark) === "dark" ? "dark" : "light";
}

/**
 * The camera zoom range to apply when a base style becomes active: the style's
 * own coverage limit when it declares one, else the card-level limit, else
 * MapLibre's own defaults (max 22 / min 0). Without re-applying this on every
 * switch a style with no limits of its own stays capped at whatever the
 * previous style set, or a capped style isn't capped at all — letting the
 * camera zoom past real tile coverage into blank tiles.
 */
export function baseStyleZoomRange(
  entry: Pick<BaseStyleEntry, "maxZoom" | "minZoom"> | undefined,
  config: { maxZoom?: number; minZoom?: number },
): { maxZoom: number; minZoom: number } {
  return {
    maxZoom: entry?.maxZoom ?? config.maxZoom ?? 22,
    minZoom: entry?.minZoom ?? config.minZoom ?? 0,
  };
}
