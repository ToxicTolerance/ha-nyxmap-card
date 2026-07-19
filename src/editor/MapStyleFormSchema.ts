import type { HaFormSchema } from "../types/ha-form";

/** map_styles entries are already the flat `{name, map_style, map_style_dark?}`
 * shape ha-form needs, so — unlike entities — no toFormData/fromFormData
 * conversion helpers are needed alongside this schema. */
export function buildMapStyleSchema(): HaFormSchema[] {
  return [
    { name: "name", required: true, selector: { text: {} } },
    { name: "map_style", required: true, selector: { text: { type: "url" } } },
    { name: "map_style_dark", selector: { text: { type: "url" } } },
  ];
}
