export interface LayerConfigRaw {
  url: string;
  options?: Record<string, unknown>;
  attribution?: string;
}

/** Base config for a card-level `tile_layers:`/`wms:` entry — a raster
 * overlay layered on top of the vector base style. `url` may contain
 * `{{ states('entity_id') }}` templating (resolved by HaUrlResolveService)
 * and, for tile layers, the usual `{z}/{x}/{y}` XYZ tokens.
 *
 * Mirrors upstream ha-map-card's LayerConfig, minus the `history` (WMS
 * TIME-parameter) sub-config — that's tightly coupled to the energy-
 * dashboard date-range linking this fork hasn't built yet (see CLAUDE.md's
 * "Porting backlog"), so it's deferred alongside it rather than half-wired. */
export class LayerConfig {
  readonly url: string;
  readonly options: Record<string, unknown>;

  constructor(raw: LayerConfigRaw) {
    if (!raw?.url) throw new Error("Layer config is missing required `url` key");
    this.url = raw.url;
    this.options = { ...(raw.attribution ? { attribution: raw.attribution } : {}), ...(raw.options ?? {}) };
  }
}

/**
 * `tile_layers:`/`wms:` accept either a single layer object or a list.
 *
 * Entries without a usable `url` are dropped rather than thrown on, matching
 * how MapConfig already treats half-typed `entities` and `map_styles`. The
 * reason is the same: setConfig() re-parses the whole config on every
 * keystroke in HA's YAML editor, so the intermediate text `tile_layers:\n  -`
 * parses to `[null]`. Throwing there propagated out of the MapConfig
 * constructor, out of setConfig(), and HA replaced the whole card with an
 * error card mid-edit.
 */
export function parseLayerConfigList<T extends LayerConfig>(
  raw: unknown,
  ctor: new (raw: LayerConfigRaw) => T,
): T[] {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  const parsed: T[] = [];
  for (const entry of list) {
    const candidate = entry as LayerConfigRaw | null | undefined;
    if (!candidate?.url || typeof candidate.url !== "string") continue;
    parsed.push(new ctor(candidate));
  }
  return parsed;
}
