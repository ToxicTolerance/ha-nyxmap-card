// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MapConfig } from "../configs/MapConfig";
import type { EntitiesRenderService } from "../services/render/EntitiesRenderService";
import type { HomeAssistant } from "../types/home-assistant";

vi.mock("../maplibre/MapLibreLoader", () => {
  class FakeMap {
    handlers = new Map<string, Array<() => void>>();
    addControl = vi.fn();
    setStyle = vi.fn();
    setMaxZoom = vi.fn();
    setMinZoom = vi.fn();
    setProjection = vi.fn();
    getSource = vi.fn();
    addSource = vi.fn();
    addLayer = vi.fn();
    removeLayer = vi.fn();
    removeSource = vi.fn();
    setLayoutProperty = vi.fn();
    resize = vi.fn();
    jumpTo = vi.fn();
    fitBounds = vi.fn();
    easeTo = vi.fn();
    querySourceFeatures = vi.fn(() => []);
    getBounds = vi.fn(() => ({ west: -180, east: 180, south: -85, north: 85 }));
    constructor(public options: unknown) {}
    on(event: string, handler: () => void): void {
      const arr = this.handlers.get(event) ?? [];
      arr.push(handler);
      this.handlers.set(event, arr);
    }
    fire(event: string): void {
      for (const h of this.handlers.get(event) ?? []) h();
    }
  }
  class FakeMarker {
    element: HTMLElement;
    constructor(opts: { element: HTMLElement }) {
      this.element = opts.element;
    }
    setLngLat(): this {
      return this;
    }
    addTo = vi.fn((): this => this);
    remove = vi.fn((): this => this);
  }
  class FakeLngLatBounds {
    extend(): this {
      return this;
    }
  }
  class FakeNavigationControl {}

  return {
    maplibregl: {
      Map: FakeMap,
      Marker: FakeMarker,
      LngLatBounds: FakeLngLatBounds,
      NavigationControl: FakeNavigationControl,
    },
    maplibreCss: "",
  };
});

// Imported after the mock so NyxmapCard picks up the fake maplibregl.
const { NyxmapCard } = await import("./NyxmapCard");

// A structural (non-intersected) view of the internals this test pokes at —
// intersecting with InstanceType<typeof NyxmapCard> directly collapses to
// `never` because TS treats same-named private class fields as unmergeable.
interface TestableNyxmapCard extends HTMLElement {
  getCardSize(): number;
  setConfig(config: unknown): void;
  readonly updateComplete: Promise<boolean>;
  hass?: HomeAssistant;
  _map?: {
    fire(event: string): void;
    options: { maxZoom?: number; minZoom?: number };
    setStyle: ReturnType<typeof vi.fn>;
    setMaxZoom: ReturnType<typeof vi.fn>;
    setMinZoom: ReturnType<typeof vi.fn>;
    setLayoutProperty: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
    querySourceFeatures: ReturnType<typeof vi.fn>;
    addLayer: ReturnType<typeof vi.fn>;
  };
  _entities?: EntitiesRenderService;
}

function asTestable(el: InstanceType<typeof NyxmapCard>): TestableNyxmapCard {
  return el as unknown as TestableNyxmapCard;
}

function hassWith(states: HomeAssistant["states"]): HomeAssistant {
  return { states, callWS: vi.fn(), language: "en" };
}

// Flushes pending microtasks *and* any promise chains queued behind a
// setTimeout/real async boundary (queueMicrotask alone isn't enough once a
// chain spans multiple ticks, e.g. an awaited fetch followed by a .then()).
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("NyxmapCard", () => {
  let el: TestableNyxmapCard;

  beforeEach(() => {
    el = asTestable(document.createElement("nyxmap-card") as InstanceType<typeof NyxmapCard>);
    document.body.appendChild(el);
  });

  it("getCardSize reflects card_size from config, defaulting to 5", async () => {
    expect(el.getCardSize()).toBe(5);
    el.setConfig({ card_size: 8 });
    await el.updateComplete;
    expect(el.getCardSize()).toBe(8);
  });

  it("getCardSize reflects an explicit height even when card_size is left at its default (masonry layout consistency)", async () => {
    // A mismatch here previously left HA's masonry layout under-allocating
    // space for the card, surfacing as an unexpected dashboard scrollbar.
    el.setConfig({ height: 600 });
    await el.updateComplete;

    expect(el.getCardSize()).toBe(12); // 600 / 50
  });

  it("renders the title as its own flex item rather than ha-card's built-in header", async () => {
    // ha-card's own header adds its own height *on top of* .nyxmap-viewport's
    // already-explicit height rather than sharing it, which could make the
    // combined content taller than ha-card's box and get clipped by its
    // overflow:hidden — taking whatever sat at the bottom (e.g. the
    // attribution control) with it. Rendering our own title inside the flex
    // column avoids that entirely.
    el.setConfig({ title: "My Map" });
    await el.updateComplete;

    const title = el.shadowRoot!.querySelector(".nyxmap-title");
    expect(title?.textContent).toBe("My Map");
    expect(el.shadowRoot!.querySelector("ha-card")!.hasAttribute("header")).toBe(false);
  });

  it("renders no title element when title is unset", async () => {
    el.setConfig({});
    await el.updateComplete;

    expect(el.shadowRoot!.querySelector(".nyxmap-title")).toBeNull();
  });

  it("only opts the host into height:100% when a percentage/CSS-length height is configured", async () => {
    el.setConfig({});
    await el.updateComplete;
    expect(el.style.height).toBe("");

    el.setConfig({ height: 600 });
    await el.updateComplete;
    expect(el.style.height).toBe(""); // numeric height: content sizes itself, host must not be externally constrained

    el.setConfig({ height: "100%" });
    await el.updateComplete;
    expect(el.style.height).toBe("100%");
  });

  it("throws from setConfig on a missing config", () => {
    expect(() => el.setConfig(undefined)).toThrow();
  });

  it("builds the map once on first render and does not rebuild on subsequent setConfig calls", async () => {
    el.setConfig({ x: 1, y: 2 });
    await el.updateComplete;
    const firstMap = el._map;
    expect(firstMap).toBeDefined();

    el.setConfig({ x: 3, y: 4 });
    await el.updateComplete;

    expect(el._map).toBe(firstMap);
  });

  it("nudges map.resize() once layout has settled after building (tab-switch/masonry sizing workaround)", async () => {
    el.setConfig({});
    await el.updateComplete;
    // The nudge is a double requestAnimationFrame (stubbed as chained
    // setTimeout(0) in jsdom) — flush twice to let both frames land.
    await flushMicrotasks();
    await flushMicrotasks();

    expect(el._map!.resize).toHaveBeenCalled();
  });

  it("calls map.setStyle when config changes after the map is built (theme/style swap path)", async () => {
    el.setConfig({ map_style: "https://example.com/a.json" });
    await el.updateComplete;

    el.setConfig({ map_style: "https://example.com/b.json" });
    await el.updateComplete;

    expect(el._map!.setStyle).toHaveBeenCalledWith("https://example.com/b.json");
  });

  it("renders entity markers once style.load has fired and hass is set", async () => {
    el.setConfig({
      entities: [{ entity: "device_tracker.phone", fixed_x: 1, fixed_y: 2 }],
    });
    await el.updateComplete;

    el._map!.fire("style.load");
    el.hass = hassWith({});
    await el.updateComplete;

    expect(el._entities?.has("device_tracker.phone")).toBe(true);
  });

  it("does not render entities before style.load has fired", async () => {
    el.setConfig({
      entities: [{ entity: "device_tracker.phone", fixed_x: 1, fixed_y: 2 }],
    });
    await el.updateComplete;

    el.hass = hassWith({});
    await el.updateComplete;

    expect(el._entities?.has("device_tracker.phone")).toBe(false);
  });

  it("dispatches hass-more-info with the entity id on marker tap", async () => {
    el.setConfig({
      entities: [{ entity: "device_tracker.phone", fixed_x: 1, fixed_y: 2 }],
    });
    await el.updateComplete;
    el._map!.fire("style.load");
    el.hass = hassWith({});
    await el.updateComplete;

    const moreInfo = vi.fn();
    el.addEventListener("hass-more-info", moreInfo as EventListener);

    const markers = (el._entities as unknown as { markers: Map<string, { element: HTMLElement }> })
      .markers;
    markers.get("device_tracker.phone")!.element.dispatchEvent(new Event("click"));

    expect(moreInfo).toHaveBeenCalledTimes(1);
    expect((moreInfo.mock.calls[0]![0] as CustomEvent).detail).toEqual({
      entityId: "device_tracker.phone",
    });
  });

  it("detaches an entity's marker once ClusterRenderService considers it absorbed into a bubble", async () => {
    el.setConfig({
      cluster_markers: true,
      entities: [
        { entity: "device_tracker.a", fixed_x: 1, fixed_y: 2 },
        { entity: "device_tracker.b", fixed_x: 1.0001, fixed_y: 2.0001 },
      ],
    });
    await el.updateComplete;
    el._map!.fire("style.load");
    el.hass = hassWith({});
    await el.updateComplete;

    const markers = (el._entities as unknown as { markers: Map<string, { remove: ReturnType<typeof vi.fn> }> })
      .markers;
    const markerB = markers.get("device_tracker.b")!;
    expect(markerB.remove).not.toHaveBeenCalled();

    // Simulate MapLibre now reporting only "a" as unclustered — "b" got
    // absorbed into a bubble.
    el._map!.querySourceFeatures.mockReturnValue([{ properties: { entityId: "device_tracker.a" } }]);
    el._map!.fire("zoomend");

    expect(markerB.remove).toHaveBeenCalledTimes(1);
  });

  it("adds tile_layers/wms raster layers before circle/geojson/cluster overlay layers, so they don't render on top of them", async () => {
    // Regression: TileLayersRenderService.addLayer() never passes a
    // beforeId, so whichever overlay creates its layer first ends up on
    // top. Raster tile_layers/wms overlays used to be updated *last* in
    // _buildMap()'s style.load handler, landing above (hiding) circles,
    // GeoJSON shapes, and cluster bubbles entirely whenever both were
    // configured together — confirmed visually via the dev harness.
    el.setConfig({
      tile_layers: { url: "https://example.com/{z}/{x}/{y}.png" },
      cluster_markers: true,
      entities: [{ entity: "device_tracker.phone", fixed_x: 1, fixed_y: 2, circle: { radius: 25, source: "config" } }],
    });
    await el.updateComplete;
    el._map!.fire("style.load");
    el.hass = hassWith({});
    await el.updateComplete;

    const layerIdAt = (id: string) =>
      el._map!.addLayer.mock.calls.findIndex((c) => (c[0] as { id: string }).id === id);

    const tileLayerIndex = layerIdAt("tile-layer-0");
    expect(tileLayerIndex).toBeGreaterThanOrEqual(0);
    expect(tileLayerIndex).toBeLessThan(layerIdAt("entity-clusters-circle"));
    expect(tileLayerIndex).toBeLessThan(layerIdAt("circle-device_tracker.phone-fill"));
  });

  describe("layer switcher", () => {
    it("does not render the switcher when layer_switcher is unset (default false)", async () => {
      el.setConfig({});
      await el.updateComplete;

      expect(el.shadowRoot!.querySelector("nyxmap-layer-switcher")).toBeNull();
    });

    it("nests the switcher under .nyxmap-map-area, not the title, so it never overlaps a configured title", async () => {
      // nyxmap-layer-switcher is position:absolute, top:8px/left:8px — if it
      // were a sibling of .nyxmap-title instead of scoped to the map area,
      // that offset would land on top of the title bar instead of the
      // map's own top-left corner.
      el.setConfig({ layer_switcher: true, title: "My Map" });
      await el.updateComplete;
      await flushMicrotasks();
      await el.updateComplete;

      expect(el.shadowRoot!.querySelector(".nyxmap-map-area > nyxmap-layer-switcher")).not.toBeNull();
    });

    it("renders the switcher with Light/Dark base-style options when layer_switcher is true", async () => {
      el.setConfig({ layer_switcher: true });
      await el.updateComplete;
      await flushMicrotasks();
      await el.updateComplete;

      const switcher = el.shadowRoot!.querySelector("nyxmap-layer-switcher") as unknown as {
        baseStyles: Array<{ id: string; label: string; active: boolean }>;
      };
      expect(switcher).not.toBeNull();
      expect(switcher.baseStyles.map((s) => s.id).sort()).toEqual(["dark", "light"]);
    });

    it("omits the generic Light/Dark options once map_styles is configured, showing only the named ones", async () => {
      // Light/Dark alongside a user's own named styles is confusing rather
      // than useful — e.g. a custom entry that's itself a light-mode style
      // (say "Karte (hell)") duplicates the generic "Light" button under a
      // different name, with no clear relationship between the two.
      el.setConfig({
        layer_switcher: true,
        map_styles: [
          { name: "Satellit", map_style: "https://example.com/satellite.json" },
          { name: "Karte (hell)", map_style: "https://example.com/karte-hell.json" },
        ],
      });
      await el.updateComplete;
      await flushMicrotasks();
      await el.updateComplete;

      const switcher = el.shadowRoot!.querySelector("nyxmap-layer-switcher") as unknown as {
        baseStyles: Array<{ id: string; label: string; active: boolean }>;
      };
      expect(switcher.baseStyles.map((s) => s.label).sort()).toEqual(["Karte (hell)", "Satellit"]);
      expect(switcher.baseStyles.some((s) => s.id === "light" || s.id === "dark")).toBe(false);
    });

    it("selecting a base style pins map.setStyle to that style's URL", async () => {
      el.setConfig({
        layer_switcher: true,
        map_style: "https://example.com/light.json",
        map_style_dark: "https://example.com/dark.json",
      });
      await el.updateComplete;
      await flushMicrotasks();
      await el.updateComplete;

      const switcher = el.shadowRoot!.querySelector("nyxmap-layer-switcher") as unknown as {
        onSelectBaseStyle: (id: string) => void;
      };
      switcher.onSelectBaseStyle("dark");
      await el.updateComplete;

      expect(el._map!.setStyle).toHaveBeenCalledWith("https://example.com/dark.json");
    });

    it("applies a map_styles entry's own max_zoom/min_zoom when it becomes active", async () => {
      // Bayern DOP20-style regression: a named base style whose real tile
      // coverage stops well short of the card's other styles must cap the
      // camera to its own limit when selected, not whatever was active
      // before (or MapLibre's 0-22 default) — otherwise the camera can
      // zoom past real coverage into blank/400 tiles.
      el.setConfig({
        layer_switcher: true,
        map_styles: [
          { name: "Aerial", map_style: "https://example.com/aerial.json", max_zoom: 19, min_zoom: 3 },
          { name: "Streets", map_style: "https://example.com/streets.json" },
        ],
      });
      await el.updateComplete;
      await flushMicrotasks();
      await el.updateComplete;

      const switcher = el.shadowRoot!.querySelector("nyxmap-layer-switcher") as unknown as {
        onSelectBaseStyle: (id: string) => void;
      };

      switcher.onSelectBaseStyle("custom:Aerial");
      expect(el._map!.setMaxZoom).toHaveBeenLastCalledWith(19);
      expect(el._map!.setMinZoom).toHaveBeenLastCalledWith(3);

      switcher.onSelectBaseStyle("custom:Streets");
      expect(el._map!.setMaxZoom).toHaveBeenLastCalledWith(22);
      expect(el._map!.setMinZoom).toHaveBeenLastCalledWith(0);
    });

    it("falls back to the card-level max_zoom/min_zoom for a style with no zoom of its own", async () => {
      el.setConfig({
        layer_switcher: true,
        max_zoom: 17,
        min_zoom: 2,
        map_style: "https://example.com/light.json",
        map_style_dark: "https://example.com/dark.json",
      });
      await el.updateComplete;
      await flushMicrotasks();
      await el.updateComplete;

      const switcher = el.shadowRoot!.querySelector("nyxmap-layer-switcher") as unknown as {
        onSelectBaseStyle: (id: string) => void;
      };
      switcher.onSelectBaseStyle("dark");

      expect(el._map!.setMaxZoom).toHaveBeenLastCalledWith(17);
      expect(el._map!.setMinZoom).toHaveBeenLastCalledWith(2);
    });

    it("applies a map_styles entry's own max_zoom/min_zoom at initial construction when it's the active style", async () => {
      // Bayern DOP20 regression: map_style/map_style_dark (the initially
      // active style, before any switcher click) can match one of the named
      // map_styles entries by URL. That entry's own zoom cap must be used
      // right from the Map constructor, not just once the user later
      // reselects it via the switcher — otherwise the wider card-level cap
      // stays in effect on load and the camera overshoots into blank/400s.
      el.setConfig({
        map_style: "https://example.com/aerial.json",
        map_style_dark: "https://example.com/aerial.json",
        max_zoom: 19,
        min_zoom: 10,
        map_styles: [
          {
            name: "Aerial",
            map_style: "https://example.com/aerial.json",
            map_style_dark: "https://example.com/aerial.json",
            max_zoom: 18,
          },
          { name: "Streets", map_style: "https://example.com/streets.json" },
        ],
      });
      await el.updateComplete;

      expect(el._map!.options.maxZoom).toBe(18);
      expect(el._map!.options.minZoom).toBe(10);
    });

    it("highlights the matching map_styles entry as active in the switcher on initial load", async () => {
      el.setConfig({
        layer_switcher: true,
        map_style: "https://example.com/aerial.json",
        map_style_dark: "https://example.com/aerial.json",
        map_styles: [
          { name: "Aerial", map_style: "https://example.com/aerial.json" },
          { name: "Streets", map_style: "https://example.com/streets.json" },
        ],
      });
      await el.updateComplete;
      await flushMicrotasks();
      await el.updateComplete;

      const switcher = el.shadowRoot!.querySelector("nyxmap-layer-switcher") as unknown as {
        baseStyles: Array<{ id: string; active: boolean }>;
      };
      expect(switcher.baseStyles.find((s) => s.id === "custom:Aerial")?.active).toBe(true);
    });

    it("toggling a history overlay calls setLayoutProperty via LayerRegistry", async () => {
      el.setConfig({
        layer_switcher: true,
        entities: [{ entity: "device_tracker.phone", fixed_x: 1, fixed_y: 2, history_start: "1 hour ago" }],
      });
      await el.updateComplete;
      el._map!.fire("style.load");
      el.hass = {
        states: {},
        language: "en",
        callWS: vi.fn().mockResolvedValue({
          "device_tracker.phone": [{ a: { latitude: 1, longitude: 2 } }, { a: { latitude: 3, longitude: 4 } }],
        }),
      };
      await el.updateComplete;
      await flushMicrotasks();
      await flushMicrotasks();
      await el.updateComplete;

      const switcher = el.shadowRoot!.querySelector("nyxmap-layer-switcher") as unknown as {
        overlays: Array<{ id: string }>;
        onToggleOverlay: (id: string) => void;
      };
      expect(switcher.overlays).toHaveLength(1);
      const overlayId = switcher.overlays[0]!.id;

      switcher.onToggleOverlay(overlayId);

      expect(el._map!.setLayoutProperty).toHaveBeenCalledWith(overlayId, "visibility", "none");
    });
  });

  describe("visual config editor", () => {
    it("getConfigElement returns a nyxmap-card-editor element", () => {
      expect(NyxmapCard.getConfigElement().tagName).toBe("NYXMAP-CARD-EDITOR");
    });

    it("getStubConfig returns a config that MapConfig can parse without throwing", () => {
      expect(() => new MapConfig(NyxmapCard.getStubConfig())).not.toThrow();
    });
  });
});
