import { vi } from "vitest";

/**
 * Hand-rolled double for the surface of maplibregl.Map/Marker/LngLatBounds
 * that render services actually call. Real MapLibre needs a live WebGL
 * canvas (no headless-gl — fragile native binding, especially on Windows),
 * so tests assert call intent against this fake instead of pixels.
 */
export function createFakeMaplibreMap() {
  return {
    addSource: vi.fn(),
    addLayer: vi.fn(),
    getSource: vi.fn(),
    removeLayer: vi.fn(),
    removeSource: vi.fn(),
    getStyle: vi.fn(() => ({})),
    setStyle: vi.fn(),
    setMaxZoom: vi.fn(),
    setMinZoom: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
    fitBounds: vi.fn(),
    flyTo: vi.fn(),
    addImage: vi.fn(),
    setLayoutProperty: vi.fn(),
    addControl: vi.fn(),
    querySourceFeatures: vi.fn((): unknown[] => []),
    easeTo: vi.fn(),
  };
}

export type FakeMaplibreMap = ReturnType<typeof createFakeMaplibreMap>;

export class FakeMarker {
  element: HTMLElement;
  private lngLat: [number, number] = [0, 0];
  addTo = vi.fn((_map: unknown) => this);
  remove = vi.fn(() => this);

  constructor(options: { element: HTMLElement }) {
    this.element = options.element;
  }

  setLngLat(lngLat: [number, number]): this {
    this.lngLat = lngLat;
    return this;
  }

  getLngLat(): [number, number] {
    return this.lngLat;
  }
}

export class FakeLngLatBounds {
  private points: Array<[number, number]> = [];

  extend(lngLat: [number, number]): this {
    this.points.push(lngLat);
    return this;
  }

  getExtended(): Array<[number, number]> {
    return this.points;
  }
}

export function createFakeMaplibreGl() {
  return {
    Marker: FakeMarker,
    LngLatBounds: FakeLngLatBounds,
  };
}

export type FakeMaplibreGl = ReturnType<typeof createFakeMaplibreGl>;
