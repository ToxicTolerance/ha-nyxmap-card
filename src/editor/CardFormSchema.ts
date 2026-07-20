import type { MapConfigRaw } from "../configs/MapConfig";
import type { HomeAssistant } from "../types/home-assistant";
import type { HaFormSchema } from "../types/ha-form";

const CARD_SCHEMA_KEYS = [
  "title",
  "x",
  "y",
  "zoom",
  "max_zoom",
  "min_zoom",
  "theme_mode",
  "map_style",
  "map_style_dark",
  "projection",
  "focus_entity",
  "focus_follow",
  "layer_switcher",
  "history_start",
  "history_end",
  "history_show_lines",
  "history_show_dots",
  "cluster_markers",
  "height",
  "card_size",
] as const;

export function buildCardSchema(): HaFormSchema[] {
  return [
    { name: "title", selector: { text: {} } },
    {
      name: "",
      type: "grid",
      schema: [
        { name: "x", selector: { number: {} } },
        { name: "y", selector: { number: {} } },
        { name: "zoom", selector: { number: { min: 0, max: 22 } } },
        { name: "max_zoom", selector: { number: { min: 0, max: 22 } } },
        { name: "min_zoom", selector: { number: { min: 0, max: 22 } } },
      ],
    },
    {
      name: "appearance",
      type: "expandable",
      title: "Appearance",
      flatten: true,
      schema: [
        { name: "theme_mode", selector: { select: { mode: "dropdown", options: ["auto", "light", "dark"] } } },
        { name: "map_style", selector: { text: { type: "url" } } },
        { name: "map_style_dark", selector: { text: { type: "url" } } },
        { name: "projection", selector: { select: { mode: "dropdown", options: ["mercator", "globe"] } } },
      ],
    },
    {
      name: "behavior",
      type: "expandable",
      title: "Behavior",
      flatten: true,
      schema: [
        { name: "focus_entity", selector: { entity: {} } },
        {
          name: "focus_follow",
          selector: { select: { mode: "dropdown", options: ["none", "refocus", "contains"] } },
        },
        { name: "layer_switcher", selector: { boolean: {} } },
        { name: "history_start", selector: { text: {} } },
        { name: "history_end", selector: { text: {} } },
        { name: "history_show_lines", selector: { boolean: {} } },
        { name: "history_show_dots", selector: { boolean: {} } },
        { name: "cluster_markers", selector: { boolean: {} } },
        // Text, not number: height is number|string (px or a CSS length like
        // "50vh"/"100%") — see parseHeight() below for the round-trip.
        { name: "height", selector: { text: {} } },
        { name: "card_size", selector: { number: { min: 1 } } },
      ],
    },
  ];
}

export function cardConfigToFormData(config: MapConfigRaw): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const key of CARD_SCHEMA_KEYS) {
    if (key === "height") {
      if (config.height !== undefined) data.height = String(config.height);
      continue;
    }
    if (config[key] !== undefined) data[key] = config[key];
  }
  return data;
}

export function formDataToCardConfig(data: Record<string, unknown>, previous: MapConfigRaw): MapConfigRaw {
  const next: MapConfigRaw = { ...previous };
  for (const key of CARD_SCHEMA_KEYS) {
    if (!(key in data)) continue;
    if (key === "height") {
      next.height = parseHeight(data.height);
      continue;
    }
    (next as Record<string, unknown>)[key] = data[key];
  }
  return next;
}

/** ha-form's text selector always returns a string; re-derive the
 * number|string union `MapConfigRaw.height` expects so a plain pixel value
 * (e.g. "350") keeps behaving like the numeric height it originally was,
 * while a CSS length (e.g. "50vh") passes through untouched. An empty string
 * clears the override back to the card_size-derived default. */
function parseHeight(value: unknown): number | string | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  return /^\d+$/.test(value) ? Number(value) : value;
}

export function buildStubConfig(hass?: HomeAssistant): MapConfigRaw {
  const entity = hass ? findDefaultEntity(hass) : undefined;
  return { entities: entity ? [entity] : [] };
}

function findDefaultEntity(hass: HomeAssistant): string | undefined {
  return Object.keys(hass.states).find((id) => id.startsWith("device_tracker.") || id.startsWith("person."));
}
