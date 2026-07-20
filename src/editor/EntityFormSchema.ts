import type { EntityConfigRaw } from "../configs/EntityConfig";
import type { HaFormSchema } from "../types/ha-form";

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
    { name: "color", selector: { text: {} } },
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
    { name: "history_line_color", selector: { text: {} } },
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
    if (key in data) (next as Record<string, unknown>)[key] = data[key];
  }
  return next;
}
