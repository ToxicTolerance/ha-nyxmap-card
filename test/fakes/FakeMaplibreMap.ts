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
    // Render services re-apply changed paint (colour/opacity/width) to layers
    // that already exist, rather than only setting it at addLayer() time.
    setPaintProperty: vi.fn(),
    addControl: vi.fn(),
    removeControl: vi.fn(),
    querySourceFeatures: vi.fn((): unknown[] => []),
    easeTo: vi.fn(),
    // Identity projection by default (lng/lat treated directly as screen x/y),
    // so a fixture entity at fixed_x/fixed_y N reads as "N px" without real
    // Mercator math; override per-test via project.mockImplementation(...) for
    // specific pixel-distance scenarios (ClusterRenderService collision tests).
    project: vi.fn((lngLat: [number, number]) => ({ x: lngLat[0], y: lngLat[1] })),
    unproject: vi.fn((point: { x: number; y: number }): [number, number] => [point.x, point.y]),
    getZoom: vi.fn(() => 10),
    getMaxZoom: vi.fn(() => 22),
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
