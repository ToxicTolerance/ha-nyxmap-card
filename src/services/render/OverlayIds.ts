/**
 * The single source of truth for overlay source ids.
 *
 * Every overlay the card and its plugins add — sources, layers, StyleReattach
 * factories, LayerRegistry entries — shares one flat string namespace. Two
 * things depend on knowing the whole set of built-in prefixes:
 *
 *  - each render service, to key its own sources; and
 *  - `PluginHost`, to *reject* a plugin overlay id that would collide with a
 *    built-in one before that built-in has registered anything (`activate()`
 *    runs before the render services' first `update()`, so a purely dynamic
 *    "is this id taken?" check passes and the id is clobbered moments later).
 *
 * Those used to be separate: each service kept a module-private `sourceId()`
 * and `PluginHost` kept a hand-maintained array of prefix literals shadowing
 * them. Adding a sixth overlay type compiled, linted and tested green while
 * silently opening a collision hole. Keeping both here means a new prefix
 * cannot be added without landing in the reserved list.
 */
export const OVERLAY_ID_PREFIXES = {
  history: "history-",
  circle: "circle-",
  geojson: "geojson-",
  tileLayer: "tile-layer-",
  wmsLayer: "wms-layer-",
} as const;

/**
 * Prefixes a plugin overlay id may not start with. Derived from the map above
 * rather than written out again, so the two cannot drift.
 */
export const RESERVED_OVERLAY_ID_PREFIXES: readonly string[] = Object.values(OVERLAY_ID_PREFIXES);

/**
 * The cluster overlay's fixed id. Unlike the per-entity overlays above it
 * registers a single, non-prefixed id, so it can't be expressed as a prefix —
 * hence its own constant here, imported by `ClusterRenderService` (which owns
 * it) and `NyxmapCard` (whose "Toggle grouping" button drives it) instead of
 * being repeated as a literal in each.
 */
export const CLUSTER_OVERLAY_ID = "entity-clusters";

/**
 * Full (non-prefixed) overlay ids a plugin may not claim. The prefix list above
 * can't cover `entity-clusters`, and the dynamic "is this id already taken?"
 * check in `PluginHost` can't either: `activate()` runs *before*
 * `ClusterRenderService`'s first `update()`, so at plugin-registration time the
 * cluster overlay isn't in any registry yet — a colliding plugin id would pass
 * the dynamic check and be clobbered moments later. Listing the id here, beside
 * the prefixes, is what lets the guard reject it up front.
 */
export const RESERVED_OVERLAY_IDS: readonly string[] = [CLUSTER_OVERLAY_ID];

export function historySourceId(entityId: string): string {
  return `${OVERLAY_ID_PREFIXES.history}${entityId}`;
}

export function circleSourceId(entityId: string): string {
  return `${OVERLAY_ID_PREFIXES.circle}${entityId}`;
}

export function geoJsonSourceId(entityId: string): string {
  return `${OVERLAY_ID_PREFIXES.geojson}${entityId}`;
}

export function rasterSourceId(kind: "tile" | "wms", token: string): string {
  return `${kind === "tile" ? OVERLAY_ID_PREFIXES.tileLayer : OVERLAY_ID_PREFIXES.wmsLayer}${token}`;
}
