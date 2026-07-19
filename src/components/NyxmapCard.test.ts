// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EntitiesRenderService } from "../services/render/EntitiesRenderService";
import type { HomeAssistant } from "../types/home-assistant";

vi.mock("../maplibre/MapLibreLoader", () => {
  class FakeMap {
    handlers = new Map<string, Array<() => void>>();
    addControl = vi.fn();
    setStyle = vi.fn();
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
    addTo(): this {
      return this;
    }
    remove(): this {
      return this;
    }
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

// Imported after the mock so NyxmapCard picks up the fake maplibregl. The
// binding is only referenced via `typeof` below (for InstanceType<>), which
// no-unused-vars doesn't count as a use even though it needs the real import
// for its custom-element-registration side effect.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
    setStyle: ReturnType<typeof vi.fn>;
    setLayoutProperty: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
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

  describe("layer switcher", () => {
    it("does not render the switcher when layer_switcher is unset (default false)", async () => {
      el.setConfig({});
      await el.updateComplete;

      expect(el.shadowRoot!.querySelector("nyxmap-layer-switcher")).toBeNull();
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
});
