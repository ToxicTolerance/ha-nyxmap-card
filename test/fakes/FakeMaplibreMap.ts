import { vi } from "vitest";

/**
 * Hand-rolled double for the surface of maplibregl.Map/Marker/LngLatBounds
 * that the card and its render services actually call. Real MapLibre needs a
 * live WebGL canvas (no headless-gl — fragile native binding, especially on
 * Windows), so tests assert call intent against this fake instead of pixels.
 *
 * This is deliberately the *only* MapLibre double in the repo. NyxmapCard's
 * test used to declare a second, richer one inside its `vi.mock` factory, and
 * the two drifted: fidelity fixes landed in one and not the other. That is not
 * hypothetical — `focus_follow: "contains"` shipped broken because a fake
 * described `getBounds()` as a plain box, so the suite confirmed the bug. One
 * double, with the sharp behaviours opt-in per call site.
 */
export interface FakeMapOptions {
  /**
   * Model MapLibre's `Style._loaded`: `setStyle()` to a *different* URL leaves
   * the map with a fresh, unloaded style until "style.load" fires, and
   * `Style.addSource()`/`setLayoutProperty()` throw "Style is not done
   * loading." until then. Only the card drives real style swaps, so only its
   * test opts in; render-service tests hand the service a map that is already
   * loaded and never fire lifecycle events.
   */
  strictStyleLoading?: boolean;
  /**
   * Multiplier applied to lng/lat in `project()`. The default of 1 is an
   * identity projection, so a fixture entity at fixed_x/fixed_y N reads as
   * "N px" without real Mercator math. The card's test uses 1e6 to spread
   * points far apart, so distinct entities never accidentally cluster now that
   * `cluster_markers` defaults on. Either way, override per-test via
   * `project.mockImplementation(...)` for specific pixel-distance scenarios.
   */
  projectScale?: number;
}

export class FakeMaplibreMap {
  handlers = new Map<string, Array<() => void>>();
  styleLoaded: boolean;
  currentStyle?: string;
  /**
   * Models maplibre-gl's `_contextLost` handler, which is the *only* place in
   * the library that assigns `map.style = null` (every other teardown path
   * deletes the property instead). `Map.getSource`/`addSource`/etc. are thin
   * `this.style.<x>()` forwarders, so once the WebGL context is lost they
   * throw a TypeError against null rather than failing gracefully.
   */
  styleNulled = false;
  zoom = 10;

  private readonly strictStyleLoading: boolean;
  private readonly projectScale: number;

  constructor(
    public options: { style?: string } = {},
    fakeOptions: FakeMapOptions = {},
  ) {
    this.strictStyleLoading = fakeOptions.strictStyleLoading ?? false;
    this.projectScale = fakeOptions.projectScale ?? 1;
    this.styleLoaded = !this.strictStyleLoading;
    this.currentStyle = options.style;
    this.project = vi.fn((lngLat: [number, number]) => ({
      x: lngLat[0] * this.projectScale,
      y: lngLat[1] * this.projectScale,
    }));
  }

  /**
   * Reproduces the exact shape of the lost-context failure: a property access
   * on a null `map.style`, not a thrown library error.
   */
  private assertStyle(method: string): void {
    if (this.styleNulled) {
      throw new TypeError(`Cannot read properties of null (reading '${method}')`);
    }
  }

  private assertStyleLoaded(): void {
    if (!this.styleLoaded) throw new Error("Style is not done loading.");
  }

  getSource = vi.fn((..._args: unknown[]): unknown => {
    this.assertStyle("getSource");
    return undefined;
  });
  addSource = vi.fn((..._args: unknown[]) => {
    this.assertStyle("addSource");
    this.assertStyleLoaded();
  });
  addLayer = vi.fn();
  removeLayer = vi.fn();
  removeSource = vi.fn();
  // Style.setLayoutProperty is _checkLoaded()-guarded just like addSource, so
  // toggling an overlay mid-swap throws in production too.
  setLayoutProperty = vi.fn((..._args: unknown[]) => {
    this.assertStyleLoaded();
  });
  // Render services re-apply changed paint (colour/opacity/width) to layers
  // that already exist, rather than only setting it at addLayer() time.
  setPaintProperty = vi.fn();
  getStyle = vi.fn((): unknown => ({}));
  setStyle = vi.fn((url: string) => {
    if (url === this.currentStyle) return;
    this.currentStyle = url;
    if (this.strictStyleLoading) this.styleLoaded = false;
  });
  setProjection = vi.fn();
  // maplibre-gl 5.x clamps the current zoom synchronously inside setMaxZoom()
  // and fires the whole zoomstart/zoom/zoomend/movestart/move/moveend burst
  // right there (Map.setMaxZoom). ClusterRenderService listens for
  // zoomend/moveend on the *Map*, so those keep firing straight through a
  // setStyle() — which is what made a style switch recompute clusters against
  // a style that isn't done loading.
  setMaxZoom = vi.fn((maxZoom?: number | null) => {
    if (typeof maxZoom !== "number" || maxZoom >= this.zoom) return;
    this.zoom = maxZoom;
    this.fire("zoomend");
    this.fire("moveend");
  });
  setMinZoom = vi.fn();
  addControl = vi.fn();
  removeControl = vi.fn();
  remove = vi.fn();
  resize = vi.fn();
  jumpTo = vi.fn();
  fitBounds = vi.fn();
  flyTo = vi.fn();
  easeTo = vi.fn();
  addImage = vi.fn();
  querySourceFeatures = vi.fn((): unknown[] => []);
  // Models the real maplibregl.LngLatBounds: _ne/_sw plus accessor methods,
  // and deliberately NO west/east/south/north properties — the fake used to
  // return a plain box, which let focus_follow: "contains" ship broken.
  getBounds = vi.fn(() => ({
    _sw: { lng: -180, lat: -85 },
    _ne: { lng: 180, lat: 85 },
    getWest: () => -180,
    getEast: () => 180,
    getSouth: () => -85,
    getNorth: () => 85,
  }));
  // Assigned in the constructor so it can close over projectScale.
  project: ReturnType<typeof vi.fn>;
  unproject = vi.fn((point: { x: number; y: number }): [number, number] => [point.x, point.y]);
  getZoom = vi.fn(() => this.zoom);
  getMaxZoom = vi.fn(() => 22);

  // `on`/`off` stay spies (ClusterRenderService's test reads
  // `map.on.mock.calls` to fish out the zoomend handler) while also recording
  // handlers so `fire()` works for the card's lifecycle tests.
  //
  // Both of MapLibre's overloads are accepted: `(type, listener)` for map-wide
  // events and `(type, layerId, listener)` for the layer-scoped click handlers
  // GeoJsonRenderService wires. Only the map-wide form is recorded for
  // `fire()` — a layer-scoped click is not a map event and firing "click"
  // must not invoke it.
  on = vi.fn((event: string, layerIdOrHandler: unknown, maybeHandler?: unknown) => {
    if (typeof layerIdOrHandler !== "function") return;
    void maybeHandler;
    const arr = this.handlers.get(event) ?? [];
    arr.push(layerIdOrHandler as () => void);
    this.handlers.set(event, arr);
  });
  off = vi.fn((event: string, layerIdOrHandler?: unknown, _maybeHandler?: unknown) => {
    if (typeof layerIdOrHandler !== "function") return;
    const arr = (this.handlers.get(event) ?? []).filter((h) => h !== layerIdOrHandler);
    this.handlers.set(event, arr);
  });
  once = vi.fn((event: string, handler: () => void) => {
    const wrapped = () => {
      this.handlers.set(event, (this.handlers.get(event) ?? []).filter((h) => h !== wrapped));
      handler();
    };
    this.on(event, wrapped);
  });

  fire(event: string): void {
    if (event === "style.load") {
      this.styleLoaded = true;
      this.styleNulled = false;
    }
    if (event === "webglcontextlost") this.styleNulled = true;
    for (const h of [...(this.handlers.get(event) ?? [])]) h();
  }
}

export function createFakeMaplibreMap(options: FakeMapOptions = {}): FakeMaplibreMap {
  return new FakeMaplibreMap({}, options);
}

export class FakeMarker {
  element: HTMLElement;
  private lngLat: [number, number] = [0, 0];
  addTo = vi.fn((_map?: unknown) => this);
  remove = vi.fn(() => this);

  constructor(options: { element: HTMLElement }) {
    this.element = options.element;
  }

  setLngLat(lngLat: [number, number] = [0, 0]): this {
    this.lngLat = lngLat;
    return this;
  }

  getLngLat(): [number, number] {
    return this.lngLat;
  }
}

export class FakeLngLatBounds {
  private points: Array<[number, number]> = [];

  extend(lngLat?: [number, number]): this {
    if (lngLat) this.points.push(lngLat);
    return this;
  }

  getExtended(): Array<[number, number]> {
    return this.points;
  }
}

export class FakeNavigationControl {}

export function createFakeMaplibreGl() {
  return {
    Marker: FakeMarker,
    LngLatBounds: FakeLngLatBounds,
  };
}

export type FakeMaplibreGl = ReturnType<typeof createFakeMaplibreGl>;

/**
 * Drop-in replacement for the whole `MapLibreLoader` module, for
 * `vi.mock("../maplibre/MapLibreLoader", ...)`. The card constructs its map as
 * `new maplibregl.Map(options)`, so the strict/scaled fake options are bound
 * here rather than passed at the call site.
 *
 * Must be reached via `await import(...)` inside an async `vi.mock` factory:
 * the factory is hoisted above imports, so referencing a top-level import
 * binding from inside it throws "Cannot access before initialization".
 */
export function createFakeMapLibreLoaderModule() {
  class BoundFakeMap extends FakeMaplibreMap {
    constructor(options: { style?: string }) {
      super(options, { strictStyleLoading: true, projectScale: 1e6 });
    }
  }
  return {
    maplibregl: {
      Map: BoundFakeMap,
      Marker: FakeMarker,
      LngLatBounds: FakeLngLatBounds,
      NavigationControl: FakeNavigationControl,
    },
    maplibreCss: "",
  };
}
