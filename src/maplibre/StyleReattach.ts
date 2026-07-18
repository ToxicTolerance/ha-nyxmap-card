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

  replayAll(map: maplibregl.Map): void {
    for (const factory of this.factories.values()) factory(map);
  }
}
