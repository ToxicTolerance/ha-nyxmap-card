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
