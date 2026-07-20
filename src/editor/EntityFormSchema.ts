import type { EntityConfigRaw } from "../configs/EntityConfig";
import type { HaFormSchema } from "../types/ha-form";

/** Color fields edited via HA's color-wheel picker (color_rgb selector), whose
 * value is an [r, g, b] array — converted to/from the `#rrggbb` string the
 * card stores. A non-hex stored value (e.g. "red", "rgb(...)") can't seed the
 * wheel, so it's left out of the form and preserved untouched on save. */
const COLOR_KEYS = new Set(["color", "history_line_color"]);

function hexToRgb(value: unknown): [number, number, number] | undefined {
  if (typeof value !== "string") return undefined;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return undefined;
  const hex = m[1]!.length === 3 ? m[1]!.replace(/./g, "$&$&") : m[1]!;
  const n = parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length < 3) return undefined;
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${h(value[0])}${h(value[1])}${h(value[2])}`;
}

const ENTITY_SCHEMA_KEYS = [
  "entity",
  "display",
  "picture",
  "icon",
  "label",
  "color",
  "size",
  "fixed_x",
  "fixed_y",
  "z_index_offset",
  "focus_on_fit",
  "history_start",
  "history_end",
  "history_line_color",
  "circle",
] as const;

export function buildEntitySchema(): HaFormSchema[] {
  return [
    { name: "entity", required: true, selector: { entity: {} } },
    { name: "display", selector: { select: { mode: "dropdown", options: ["marker", "icon", "state"] } } },
    { name: "picture", selector: { text: { type: "url" } } },
    { name: "icon", selector: { icon: {} } },
    { name: "label", selector: { text: {} } },
    { name: "color", selector: { color_rgb: {} } },
    { name: "size", selector: { number: { min: 1 } } },
    {
      name: "",
      type: "grid",
      schema: [
        { name: "fixed_x", selector: { number: {} } },
        { name: "fixed_y", selector: { number: {} } },
      ],
    },
    { name: "z_index_offset", selector: { number: {} } },
    { name: "focus_on_fit", selector: { boolean: {} } },
    { name: "history_start", selector: { text: {} } },
    { name: "history_end", selector: { text: {} } },
    { name: "history_line_color", selector: { color_rgb: {} } },
    { name: "circle", default: true, selector: { boolean: {} } },
  ];
}

/** Normalizes the bare-entity-id shorthand (`"person.alice"`) to the object
 * shape ha-form needs to display. Fields outside ENTITY_SCHEMA_KEYS (`geojson`)
 * are simply absent from the returned form data — they're never read back out
 * of it, see formDataToEntityRaw. `circle` is special-cased: the underlying
 * config is `"auto" | CircleConfigRaw | false | undefined`, collapsed here to
 * a single on/off checkbox (only an explicit `false` reads as off) since the
 * card now draws accuracy circles by default — see
 * MapConfig.showAccuracyCircles. Advanced per-entity circle objects configured
 * via YAML are preserved as long as the checkbox stays on (see
 * formDataToEntityRaw). */
export function entityRawToFormData(e: string | EntityConfigRaw): Record<string, unknown> {
  const raw: EntityConfigRaw = typeof e === "string" ? { entity: e } : e;
  const data: Record<string, unknown> = {};
  for (const key of ENTITY_SCHEMA_KEYS) {
    if (key === "circle") {
      if (raw.circle !== undefined) data.circle = raw.circle !== false;
      continue;
    }
    if (COLOR_KEYS.has(key)) {
      const rgb = hexToRgb(raw[key]);
      if (rgb) data[key] = rgb;
      continue;
    }
    if (raw[key] !== undefined) data[key] = raw[key];
  }
  return data;
}

/** Spreads the normalized `previous` shape first so out-of-scope keys
 * (`geojson`, any unknown pass-through key) survive an edit to an unrelated
 * field. Once an entity has been touched here it's always serialized back as
 * a full object, never re-collapsed to the bare-string shorthand — an
 * intentional, accepted trade-off. `circle`'s boolean is mapped back to
 * `false` when unchecked; when checked, any previously configured `"auto"`/
 * object value is left untouched, and a previous `false` reverts to unset
 * (falling back to the card-level default) rather than being invented from
 * scratch. */
export function formDataToEntityRaw(data: Record<string, unknown>, previous: string | EntityConfigRaw): EntityConfigRaw {
  const prevRaw: EntityConfigRaw = typeof previous === "string" ? { entity: previous } : previous;
  const next: EntityConfigRaw = { ...prevRaw };
  for (const key of ENTITY_SCHEMA_KEYS) {
    if (key === "circle") {
      if (!("circle" in data)) continue;
      next.circle = data.circle === false ? false : prevRaw.circle === false ? undefined : prevRaw.circle;
      continue;
    }
    if (COLOR_KEYS.has(key)) {
      if (!(key in data)) continue;
      const v = data[key];
      // Picker value ([r,g,b]) → #rrggbb; an already-string color passes
      // through untouched; a cleared field (undefined) unsets it.
      (next as Record<string, unknown>)[key] = Array.isArray(v) ? rgbToHex(v) : v;
      continue;
    }
    if (key in data) (next as Record<string, unknown>)[key] = data[key];
  }
  return next;
}
