import type { MapConfig, ThemeMode } from "../configs/MapConfig";

/** Resolves `theme_mode` ("auto"|"light"|"dark") against the system preference. */
export function resolveThemeMode(themeMode: ThemeMode, prefersDark: boolean): "light" | "dark" {
  if (themeMode === "auto") return prefersDark ? "dark" : "light";
  return themeMode;
}

/** Picks the MapLibre style URL for the current theme. */
export function resolveStyle(config: MapConfig, prefersDark: boolean): string {
  return resolveThemeMode(config.themeMode, prefersDark) === "dark"
    ? config.styleDark
    : config.styleLight;
}
