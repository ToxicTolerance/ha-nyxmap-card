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
 * Phase 9 backlog), so it's deferred alongside it rather than half-wired. */
export class LayerConfig {
  readonly url: string;
  readonly options: Record<string, unknown>;

  constructor(raw: LayerConfigRaw) {
    if (!raw?.url) throw new Error("Layer config is missing required `url` key");
    this.url = raw.url;
    this.options = { ...(raw.attribution ? { attribution: raw.attribution } : {}), ...(raw.options ?? {}) };
  }
}

/** `tile_layers:`/`wms:` accept either a single layer object or a list. */
export function parseLayerConfigList<T extends LayerConfig>(
  raw: unknown,
  ctor: new (raw: LayerConfigRaw) => T,
): T[] {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((r) => new ctor(r as LayerConfigRaw));
}
