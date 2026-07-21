import type maplibregl from "maplibre-gl";

/**
 * map.setStyle() (used for light/dark theme swaps) wipes all GeoJSON
 * sources/layers but leaves HTML Markers untouched. Anything registered here
 * gets replayed on every "style.load" event — first load AND every
 * subsequent setStyle() — so it survives theme swaps. See CLAUDE.md.
 */
export type ReattachFactory = (map: maplibregl.Map) => void;

export class StyleReattach {
  private readonly factories = new Map<string, ReattachFactory>();

  register(id: string, factory: ReattachFactory): void {
    this.factories.set(id, factory);
  }

  unregister(id: string): void {
    this.factories.delete(id);
  }

  has(id: string): boolean {
    return this.factories.has(id);
  }

  clear(): void {
    this.factories.clear();
  }

  /**
   * Replays every registered factory. Two deliberate protections, because the
   * card's "style.load" handler does the rest of its work *after* this call
   * (plugin activation, tile layers, entities/clusters, geojson, history,
   * initial view) and a factory can be arbitrary third-party code:
   *
   *  - The registry is snapshotted before iterating, so a factory that
   *    register()s a fresh id mid-replay isn't visited in the same pass (a
   *    self-registering factory would otherwise loop forever), and one that
   *    unregister()s is still safe to iterate over.
   *  - Each factory runs in its own try/catch, so one throwing overlay (a
   *    plugin's invalid layer spec, a duplicate layer id) can't abort the
   *    remaining factories or the handler downstream of them. This is what
   *    makes PluginHost's "a misbehaving plugin can't take the card down"
   *    guarantee hold past the first style load.
   */
  replayAll(map: maplibregl.Map): void {
    for (const [id, factory] of [...this.factories]) {
      try {
        factory(map);
      } catch (err) {
        console.error(`[nyxmap-card] style reattach failed for "${id}":`, err);
      }
    }
  }
}
