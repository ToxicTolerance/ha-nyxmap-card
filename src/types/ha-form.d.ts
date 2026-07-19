/** Duck-typed surface of Home Assistant's globally-registered `<ha-form>`
 * element and its selector schema. Never imported at runtime — `ha-form` and
 * `ha-selector` are provided by the surrounding HA frontend, not a project
 * dependency (same rationale as ./home-assistant.d.ts: this file only models
 * the slice of their public contract this repo actually binds to). */

export type HaFormSelector =
  | { text?: { type?: "url" | "text" } }
  | { number?: { min?: number; max?: number; step?: number; mode?: "box" | "slider" } }
  | { boolean?: Record<string, never> }
  | { entity?: { domain?: string | string[] } }
  | { icon?: Record<string, never> }
  | { select?: { mode?: "dropdown" | "list"; options: Array<string | { value: string; label: string }> } };

export interface HaFormSelectorSchema {
  name: string;
  // Absent in practice; declared (always undefined) only so `.type` can be
  // narrowed on the HaFormSchema union without an `"type" in x` guard.
  type?: undefined;
  selector: HaFormSelector;
  required?: boolean;
  default?: unknown;
}

/** Lays out its child schema entries side by side in a responsive grid. */
export interface HaFormGridSchema {
  name: "";
  type: "grid";
  schema: HaFormSchema[];
}

/** A collapsible section. `flatten: true` is required whenever the grouped
 * fields belong at the top level of the data object (e.g. our MapConfigRaw
 * fields) — without it ha-form nests the group's values under a synthetic
 * `{ [name]: {...} }` key instead of merging them into the flat data shape
 * our config classes expect. */
export interface HaFormExpandableSchema {
  name: string;
  type: "expandable";
  title: string;
  flatten?: boolean;
  schema: HaFormSchema[];
}

export type HaFormSchema = HaFormSelectorSchema | HaFormGridSchema | HaFormExpandableSchema;

/** The shape of a `querySelector("ha-form")` result we bind properties to and
 * listen on — never instantiated directly. */
export interface HaFormElement extends HTMLElement {
  hass?: unknown;
  schema: HaFormSchema[];
  data: Record<string, unknown>;
  computeLabel?: (schema: HaFormSchema) => string;
}

export interface HaFormValueChangedEvent extends CustomEvent {
  detail: { value: Record<string, unknown> };
}
