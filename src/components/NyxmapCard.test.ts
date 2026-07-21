// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MapConfig } from "../configs/MapConfig";
import { IconButtonControl } from "../maplibre/IconButtonControl";
import type { EntitiesRenderService } from "../services/render/EntitiesRenderService";
import type { HomeAssistant } from "../types/home-assistant";

// The shared fake in test/fakes/ is the single MapLibre double in the repo;
// this test used to declare a second, richer one inline, and the two drifted.
// The factory must reach it via `await import(...)` — vi.mock is hoisted above
// imports, so a top-level binding referenced here is not yet initialised.
vi.mock("../maplibre/MapLibreLoader", async () => {
  const { createFakeMapLibreLoaderModule } = await import("../../test/fakes/FakeMaplibreMap");
  return createFakeMapLibreLoaderModule();
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
    remove: ReturnType<typeof vi.fn>;
    addSource: ReturnType<typeof vi.fn>;
    getSource: ReturnType<typeof vi.fn>;
    setMaxZoom: ReturnType<typeof vi.fn>;
    setMinZoom: ReturnType<typeof vi.fn>;
    setLayoutProperty: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
    querySourceFeatures: ReturnType<typeof vi.fn>;
    addLayer: ReturnType<typeof vi.fn>;
    addControl: ReturnType<typeof vi.fn>;
    removeControl: ReturnType<typeof vi.fn>;
    jumpTo: ReturnType<typeof vi.fn>;
    fitBounds: ReturnType<typeof vi.fn>;
    project: ReturnType<typeof vi.fn>;
    getZoom: ReturnType<typeof vi.fn>;
    getMaxZoom: ReturnType<typeof vi.fn>;
  };
  _entities?: EntitiesRenderService;
  _cluster?: { getAbsorbed(): ReadonlyMap<string, [number, number]> };
  _clusterToggleControl?: IconButtonControl;
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

    const markers = (el._entities as unknown as { markers: Map<string, { inner: HTMLElement }> })
      .markers;
    markers.get("device_tracker.phone")!.inner.dispatchEvent(new Event("click"));

    expect(moreInfo).toHaveBeenCalledTimes(1);
    expect((moreInfo.mock.calls[0]![0] as CustomEvent).detail).toEqual({
      entityId: "device_tracker.phone",
    });
  });

  it("detaches an entity's marker once ClusterRenderService absorbs it into a bubble", async () => {
    el.setConfig({
      cluster_markers: true,
      entities: [
        { entity: "device_tracker.a", fixed_x: 1, fixed_y: 2 },
        { entity: "device_tracker.b", fixed_x: 5, fixed_y: 6 },
      ],
    });
    await el.updateComplete;
    el._map!.fire("style.load");
    el.hass = hassWith({});
    await el.updateComplete;

    const markers = (
      el._entities as unknown as {
        markers: Map<string, { marker: { remove: ReturnType<typeof vi.fn> }; inner: HTMLElement }>;
      }
    ).markers;
    const b = markers.get("device_tracker.b")!;
    // Default projection spreads a/b far apart → not clustered initially.
    expect(b.marker.remove).not.toHaveBeenCalled();

    // Bring both entities onto the same pixel → their circles overlap → they
    // collapse into a bubble, absorbing b's individual marker.
    el._map!.project.mockReturnValue({ x: 0, y: 0 });
    el._map!.fire("zoomend");
    // Detach is animated: remove() fires when the fade completes.
    b.inner.dispatchEvent(new Event("transitionend"));

    expect(b.marker.remove).toHaveBeenCalledTimes(1);
  });

  it("adds tile_layers/wms raster layers before circle/geojson overlay layers, so they don't render on top of them", async () => {
    // Regression: TileLayersRenderService.addLayer() never passes a
    // beforeId, so whichever overlay creates its layer first ends up on
    // top. Raster tile_layers/wms overlays used to be updated *last* in
    // _buildMap()'s style.load handler, landing above (hiding) circles and
    // GeoJSON shapes whenever both were configured together — confirmed
    // visually via the dev harness. (Cluster bubbles are HTML markers, not GL
    // layers, so they sit above raster layers unconditionally and aren't part
    // of this ordering.)
    el.setConfig({
      tile_layers: { url: "https://example.com/{z}/{x}/{y}.png", options: { name: "base" } },
      entities: [{ entity: "device_tracker.phone", fixed_x: 1, fixed_y: 2, circle: { radius: 25, source: "config" } }],
    });
    await el.updateComplete;
    el._map!.fire("style.load");
    el.hass = hassWith({});
    await el.updateComplete;

    const layerIdAt = (id: string) =>
      el._map!.addLayer.mock.calls.findIndex((c) => (c[0] as { id: string }).id === id);

    const tileLayerIndex = layerIdAt("tile-layer-base");
    expect(tileLayerIndex).toBeGreaterThanOrEqual(0);
    expect(tileLayerIndex).toBeLessThan(layerIdAt("circle-device_tracker.phone-fill"));
  });

  describe("map buttons (ports upstream ha-map-card's Reset focus / Toggle grouping)", () => {
    function findControl(label: string): IconButtonControl {
      const call = el._map!.addControl.mock.calls.find(
        (c) => c[0] instanceof IconButtonControl && (c[0] as IconButtonControl).options.label === label,
      );
      if (!call) throw new Error(`no control with label "${label}" was added`);
      return call[0] as IconButtonControl;
    }

    it("always adds a 'Reset focus' control, regardless of config", async () => {
      el.setConfig({});
      await el.updateComplete;

      expect(() => findControl("Reset focus")).not.toThrow();
    });

    it("clicking 'Reset focus' re-centers on explicit x/y at the configured zoom", async () => {
      el.setConfig({ x: 5, y: 6, zoom: 9 });
      await el.updateComplete;
      el._map!.fire("style.load");
      el.hass = hassWith({});
      await el.updateComplete;

      const control = findControl("Reset focus");
      el._map!.jumpTo.mockClear(); // already called once by the automatic initial-view application
      control.options.onClick();

      expect(el._map!.jumpTo).toHaveBeenCalledWith({ center: [5, 6], zoom: 9 });
    });

    it("clicking 'Reset focus' fits all entities when no explicit x/y/focus_entity is configured", async () => {
      el.setConfig({
        entities: [
          { entity: "device_tracker.phone", fixed_x: 1, fixed_y: 2 },
          { entity: "device_tracker.tablet", fixed_x: 4, fixed_y: 6 },
        ],
      });
      await el.updateComplete;
      el._map!.fire("style.load");
      el.hass = hassWith({});
      await el.updateComplete;

      const control = findControl("Reset focus");
      el._map!.fitBounds.mockClear();
      control.options.onClick();

      expect(el._map!.fitBounds).toHaveBeenCalled();
    });

    it("clicking 'Reset focus' with a single entity centers it at the configured zoom instead of slamming to max zoom", async () => {
      // The stub config (one entity, no x/y/focus_entity) produces a
      // zero-area bounds; fitBounds() on that clamps to the map's maxZoom, so
      // the most common possible card used to open at building level instead
      // of the configured zoom. See InitialViewRenderService._fit().
      el.setConfig({ zoom: 12, entities: [{ entity: "device_tracker.phone", fixed_x: 1, fixed_y: 2 }] });
      await el.updateComplete;
      el._map!.fire("style.load");
      el.hass = hassWith({});
      await el.updateComplete;

      const control = findControl("Reset focus");
      el._map!.fitBounds.mockClear();
      el._map!.jumpTo.mockClear();
      control.options.onClick();

      expect(el._map!.fitBounds).not.toHaveBeenCalled();
      expect(el._map!.jumpTo).toHaveBeenCalledWith({ center: [1, 2], zoom: 12 });
    });

    it("does not add a 'Toggle grouping' control when cluster_markers is disabled", async () => {
      el.setConfig({ cluster_markers: false });
      await el.updateComplete;

      expect(() => findControl("Toggle grouping")).toThrow();
    });

    it("adds a 'Toggle grouping' control by default (clustering on), and clicking it toggles the entity-clusters overlay", async () => {
      el.setConfig({
        entities: [{ entity: "device_tracker.phone", fixed_x: 1, fixed_y: 2 }],
      });
      await el.updateComplete;
      el._map!.fire("style.load");
      el.hass = hassWith({});
      await el.updateComplete;

      const control = findControl("Toggle grouping");
      expect(control.options.isPressed?.()).toBe(true);

      control.options.onClick();
      expect(control.options.isPressed?.()).toBe(false);

      control.options.onClick();
      expect(control.options.isPressed?.()).toBe(true);
    });

    it("adds the 'Toggle grouping' control reactively when cluster_markers is turned on via a later setConfig(), without rebuilding the card", async () => {
      // Regression: cluster_markers used to only be checked once, inside
      // _buildMap() (which only ever runs once) — turning it on later via
      // the dashboard editor (setConfig() on the same already-built card
      // element) never added the button until a full page reload.
      const entities = [{ entity: "device_tracker.phone", fixed_x: 1, fixed_y: 2 }];
      el.setConfig({ cluster_markers: false, entities });
      await el.updateComplete;
      el._map!.fire("style.load");
      el.hass = hassWith({});
      await el.updateComplete;
      expect(() => findControl("Toggle grouping")).toThrow();

      el.setConfig({ cluster_markers: true, entities });
      await el.updateComplete;
      el._map!.fire("style.load"); // setConfig() on an already-built card calls setStyle(), which reloads
      await el.updateComplete;

      expect(() => findControl("Toggle grouping")).not.toThrow();
    });

    it("removes the 'Toggle grouping' control when cluster_markers is turned off via a later setConfig()", async () => {
      const entities = [{ entity: "device_tracker.phone", fixed_x: 1, fixed_y: 2 }];
      el.setConfig({ cluster_markers: true, entities });
      await el.updateComplete;
      el._map!.fire("style.load");
      el.hass = hassWith({});
      await el.updateComplete;
      const control = findControl("Toggle grouping");

      el.setConfig({ cluster_markers: false, entities });
      await el.updateComplete;
      el._map!.fire("style.load");
      await el.updateComplete;

      expect(el._map!.removeControl).toHaveBeenCalledWith(control);
      // findControl() itself can't be reused here — it only ever inspects
      // addControl's cumulative call history, which still contains this
      // control's original addition even after a later removeControl().
      expect(el._clusterToggleControl).toBeUndefined();
    });
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

    it("shows the switcher's Theme toggle only when map_styles is configured", async () => {
      el.setConfig({ layer_switcher: true });
      await el.updateComplete;
      await flushMicrotasks();
      await el.updateComplete;

      let switcher = el.shadowRoot!.querySelector("nyxmap-layer-switcher") as unknown as {
        showThemeToggle: boolean;
      };
      expect(switcher.showThemeToggle).toBe(false);

      el.setConfig({
        layer_switcher: true,
        map_styles: [{ name: "Karte", map_style: "https://example.com/a.json" }],
      });
      await el.updateComplete;
      await flushMicrotasks();
      await el.updateComplete;

      switcher = el.shadowRoot!.querySelector("nyxmap-layer-switcher") as unknown as { showThemeToggle: boolean };
      expect(switcher.showThemeToggle).toBe(true);
    });

    it("selecting a theme mode via the switcher swaps the active style's own light/dark variant", async () => {
      // A named map_styles entry keeps its own light/dark pair even while
      // selected — the Theme control picks between them independently of
      // which entry is active (unlike theme_mode, which is a static config
      // value with no live switcher control once map_styles hides the
      // generic Light/Dark base-style buttons).
      el.setConfig({
        layer_switcher: true,
        theme_mode: "light",
        map_styles: [
          {
            name: "Karte",
            map_style: "https://example.com/light.json",
            map_style_dark: "https://example.com/dark.json",
          },
        ],
      });
      await el.updateComplete;
      await flushMicrotasks();
      await el.updateComplete;

      const switcher = el.shadowRoot!.querySelector("nyxmap-layer-switcher") as unknown as {
        onSelectBaseStyle: (id: string) => void;
        onSelectThemeMode: (mode: "auto" | "light" | "dark") => void;
        themeMode: string;
      };
      switcher.onSelectBaseStyle("custom:Karte");
      expect(el._map!.setStyle).toHaveBeenLastCalledWith("https://example.com/light.json");

      switcher.onSelectThemeMode("dark");
      await el.updateComplete;

      expect(el._map!.setStyle).toHaveBeenLastCalledWith("https://example.com/dark.json");
      const refreshedSwitcher = el.shadowRoot!.querySelector("nyxmap-layer-switcher") as unknown as {
        themeMode: string;
      };
      expect(refreshedSwitcher.themeMode).toBe("dark");
    });

    it("registers a new map_styles entry when it's added via a later setConfig() on an already-built card", async () => {
      // Regression: base styles used to only be registered once, inside
      // _buildMap() — adding/editing map_styles later (e.g. via the
      // dashboard's visual editor, without a full page reload) left the
      // switcher's registry stale, so selecting the newly-added entry
      // silently fell back to the card-level map_style/map_style_dark
      // instead of the entry's own style — indistinguishable from "that
      // style is broken" unless you knew to check for a stale registry.
      el.setConfig({
        layer_switcher: true,
        map_style: "https://example.com/aerial.json",
        map_style_dark: "https://example.com/aerial.json",
      });
      await el.updateComplete;
      await flushMicrotasks();
      await el.updateComplete;

      el.setConfig({
        layer_switcher: true,
        map_style: "https://example.com/aerial.json",
        map_style_dark: "https://example.com/aerial.json",
        map_styles: [
          {
            name: "Karte (hell)",
            map_style: "https://example.com/positron.json",
            map_style_dark: "https://example.com/dark-matter.json",
          },
        ],
      });
      await el.updateComplete;
      await flushMicrotasks();
      await el.updateComplete;

      const switcher = el.shadowRoot!.querySelector("nyxmap-layer-switcher") as unknown as {
        baseStyles: Array<{ id: string; label: string }>;
        onSelectBaseStyle: (id: string) => void;
      };
      expect(switcher.baseStyles.map((s) => s.label)).toContain("Karte (hell)");

      switcher.onSelectBaseStyle("custom:Karte (hell)");
      expect(el._map!.setStyle).toHaveBeenLastCalledWith("https://example.com/positron.json");
    });

    it("unregisters a map_styles entry removed via a later setConfig()", async () => {
      el.setConfig({
        layer_switcher: true,
        map_styles: [{ name: "Karte (hell)", map_style: "https://example.com/positron.json" }],
      });
      await el.updateComplete;
      await flushMicrotasks();
      await el.updateComplete;

      el.setConfig({ layer_switcher: true, map_styles: [] });
      await el.updateComplete;
      await flushMicrotasks();
      await el.updateComplete;

      const switcher = el.shadowRoot!.querySelector("nyxmap-layer-switcher") as unknown as {
        baseStyles: Array<{ id: string; label: string }>;
      };
      expect(switcher.baseStyles.some((s) => s.label === "Karte (hell)")).toBe(false);
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
        // Clustering off so the only overlay registered is the history trail —
        // this test is about toggling a GL-layer overlay via setLayoutProperty,
        // which the (marker-based) cluster overlay doesn't use.
        cluster_markers: false,
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

  describe("lifecycle (teardown / reconnect)", () => {
    it("destroys the map when the element is really removed", async () => {
      // maplibregl.Map.remove() is what releases the WebGL context, the
      // worker pool, MapLibre's own container ResizeObserver and its
      // window/document listeners. Browsers cap simultaneous WebGL contexts,
      // and HA's long-lived frontend builds a fresh card per dashboard view
      // (and per keystroke in the "Edit card" preview), so leaking one Map
      // per teardown eventually blanks previously-working maps.
      el.setConfig({});
      await el.updateComplete;
      const map = el._map!;

      el.remove();
      await flushMicrotasks();

      expect(map.remove).toHaveBeenCalledTimes(1);
      expect(el._map).toBeUndefined();
    });

    it("does not destroy the map on a benign re-parent", async () => {
      // Lit fires disconnectedCallback → connectedCallback on the *same*
      // element when HA's Sections/masonry layout re-parents a card.
      el.setConfig({});
      await el.updateComplete;
      const map = el._map!;

      el.remove();
      document.body.appendChild(el);
      await flushMicrotasks();

      expect(map.remove).not.toHaveBeenCalled();
      expect(el._map).toBe(map);
    });

    it("re-observes the container after a re-parent, so resizes still reach the map", async () => {
      // Regression: the observer is created once inside _buildMap() (guarded
      // by _built) and disconnected on every disconnect, with nothing to
      // re-observe it — after one re-parent the canvas stayed locked at its
      // old pixel size through sidebar toggles and window resizes until a
      // full page reload.
      el.setConfig({});
      await el.updateComplete;
      const observe = vi.spyOn(window.ResizeObserver.prototype, "observe");
      const map = el._map!;
      map.resize.mockClear();

      el.remove();
      document.body.appendChild(el);

      expect(observe).toHaveBeenCalled();
      expect(map.resize).toHaveBeenCalled();
      observe.mockRestore();
    });

    it("rebuilds the map when the element is re-added after a real teardown", async () => {
      el.setConfig({ entities: [{ entity: "device_tracker.phone", fixed_x: 1, fixed_y: 2 }] });
      await el.updateComplete;
      const first = el._map!;

      el.remove();
      await flushMicrotasks();
      expect(el._map).toBeUndefined();

      document.body.appendChild(el);
      await el.updateComplete;

      expect(el._map).toBeDefined();
      expect(el._map).not.toBe(first);

      // And the rebuilt map is fully wired: style.load still drives the
      // render services against the new map instance.
      el._map!.fire("style.load");
      el.hass = hassWith({});
      await el.updateComplete;
      expect(el._entities?.has("device_tracker.phone")).toBe(true);
    });

    it("re-applies a hidden overlay to the services rebuilt after a teardown", async () => {
      // Regression: _teardown() drops every service but keeps
      // _overlayVisibility, and every rebuilt service starts visible again
      // (ClusterRenderService._enabled, HistoryRenderService.visibility, …).
      // An overlay the user had unchecked came back visible after a reconnect
      // while its checkbox still rendered unchecked — and had to be toggled
      // twice to re-hide.
      const clustered = [
        { entity: "device_tracker.a", fixed_x: 1, fixed_y: 2 },
        { entity: "device_tracker.b", fixed_x: 3, fixed_y: 4 },
      ];
      el.setConfig({ cluster_markers: true, entities: clustered });
      await el.updateComplete;
      el._map!.fire("style.load");
      el.hass = hassWith({});
      await el.updateComplete;

      el._map!.project.mockReturnValue({ x: 0, y: 0 });
      el._map!.fire("zoomend");
      expect(el._cluster!.getAbsorbed().size).toBe(2);

      // User switches grouping off, then the card is really torn down and
      // re-added (HA re-parents cards; a slow enough round trip runs teardown).
      el._clusterToggleControl!.options.onClick();
      expect(el._cluster!.getAbsorbed().size).toBe(0);

      el.remove();
      await flushMicrotasks();
      document.body.appendChild(el);
      await el.updateComplete;
      el._map!.fire("style.load");
      el.hass = hassWith({});
      await el.updateComplete;

      el._map!.project.mockReturnValue({ x: 0, y: 0 });
      el._map!.fire("zoomend");

      expect(el._clusterToggleControl!.options.isPressed?.()).toBe(false);
      expect(el._cluster!.getAbsorbed().size).toBe(0);
    });
  });

  describe("theme_mode: auto", () => {
    /** Installs a matchMedia whose "change" listeners can actually be fired —
     * test/setup.ts's shared shim is a no-op stub (it only needs `.matches`),
     * and extending it there would change every jsdom test's environment. */
    function mockColorScheme() {
      const listeners = new Set<EventListener>();
      const state = { dark: false };
      const original = window.matchMedia;
      window.matchMedia = ((query: string) => ({
        get matches() {
          return state.dark;
        },
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: (_type: string, listener: EventListener) => listeners.add(listener),
        removeEventListener: (_type: string, listener: EventListener) => listeners.delete(listener),
        dispatchEvent: () => false,
      })) as unknown as typeof window.matchMedia;
      return {
        listeners,
        flipToDark() {
          state.dark = true;
          for (const l of [...listeners]) l(new Event("change"));
        },
        restore() {
          window.matchMedia = original;
        },
      };
    }

    const STYLES = {
      map_style: "https://example.com/light.json",
      map_style_dark: "https://example.com/dark.json",
    };

    it("swaps the basemap when the OS colour scheme flips", async () => {
      // Regression: _prefersDark() was only ever read from setConfig/_buildMap/
      // the switcher's own controls. On a wall panel, sunset flipped the OS to
      // dark and updated() restyled the *controls* (data-dark) while the
      // basemap stayed light — a permanently half-dark card until reload.
      const media = mockColorScheme();
      try {
        const card = asTestable(document.createElement("nyxmap-card") as InstanceType<typeof NyxmapCard>);
        document.body.appendChild(card);
        card.setConfig(STYLES);
        await card.updateComplete;
        expect(media.listeners.size).toBe(1);

        media.flipToDark();
        await card.updateComplete;

        expect(card._map!.setStyle).toHaveBeenCalledWith("https://example.com/dark.json");
        card.remove();
        await flushMicrotasks();
      } finally {
        media.restore();
      }
    });

    it("leaves an explicit theme_mode alone", async () => {
      const media = mockColorScheme();
      try {
        const card = asTestable(document.createElement("nyxmap-card") as InstanceType<typeof NyxmapCard>);
        document.body.appendChild(card);
        card.setConfig({ ...STYLES, theme_mode: "light" });
        await card.updateComplete;

        media.flipToDark();
        await card.updateComplete;

        expect(card._map!.setStyle).not.toHaveBeenCalledWith("https://example.com/dark.json");
        card.remove();
        await flushMicrotasks();
      } finally {
        media.restore();
      }
    });

    it("registers exactly one listener across a disconnect/reconnect cycle, and none once removed", async () => {
      const media = mockColorScheme();
      try {
        const card = asTestable(document.createElement("nyxmap-card") as InstanceType<typeof NyxmapCard>);
        document.body.appendChild(card);
        card.setConfig(STYLES);
        await card.updateComplete;

        card.remove();
        document.body.appendChild(card); // benign re-parent
        await flushMicrotasks();
        expect(media.listeners.size).toBe(1);

        card.remove();
        await flushMicrotasks();
        expect(media.listeners.size).toBe(0);
      } finally {
        media.restore();
      }
    });
  });

  describe("history refresh", () => {
    const HISTORY_ENTITY = { entity: "device_tracker.phone", fixed_x: 1, fixed_y: 2, history_start: "1 hour ago" };

    function hassFetching(callWS: ReturnType<typeof vi.fn>): HomeAssistant {
      return { states: {}, language: "en", callWS };
    }

    async function bootWithHistory(callWS: ReturnType<typeof vi.fn>, config: Record<string, unknown> = {}) {
      el.setConfig({ cluster_markers: false, entities: [HISTORY_ENTITY], ...config });
      await el.updateComplete;
      el._map!.fire("style.load");
      el.hass = hassFetching(callWS);
      await el.updateComplete;
      await flushMicrotasks();
      await flushMicrotasks();
    }

    it("re-fetches history on an interval instead of only once per style load", async () => {
      // Regression: history was fetched exactly once per style load with no
      // timer and no re-fetch on hass change, so a wall panel left open all day
      // showed a trail frozen at page-load time whose window drifted ever
      // further out of date.
      vi.useFakeTimers();
      try {
        const callWS = vi.fn().mockResolvedValue({ "device_tracker.phone": [{ a: { latitude: 1, longitude: 2 } }, { a: { latitude: 3, longitude: 4 } }] });
        el.setConfig({ cluster_markers: false, entities: [HISTORY_ENTITY] });
        await el.updateComplete;
        el._map!.fire("style.load");
        el.hass = hassFetching(callWS);
        await el.updateComplete;
        await vi.advanceTimersByTimeAsync(0);
        expect(callWS).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(60_000);
        expect(callWS).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(callWS).toHaveBeenCalledTimes(3);
      } finally {
        vi.useRealTimers();
      }
    });

    it("installs no timer when nothing configures history", async () => {
      vi.useFakeTimers();
      try {
        const callWS = vi.fn().mockResolvedValue({});
        el.setConfig({ cluster_markers: false, entities: [{ entity: "device_tracker.phone", fixed_x: 1, fixed_y: 2 }] });
        await el.updateComplete;
        el._map!.fire("style.load");
        el.hass = hassFetching(callWS);
        await el.updateComplete;
        await vi.advanceTimersByTimeAsync(5 * 60_000);

        expect(callWS).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("clears the refresh timer on teardown, so a destroyed map is never touched again", async () => {
      vi.useFakeTimers();
      try {
        const callWS = vi.fn().mockResolvedValue({ "device_tracker.phone": [{ a: { latitude: 1, longitude: 2 } }, { a: { latitude: 3, longitude: 4 } }] });
        el.setConfig({ cluster_markers: false, entities: [HISTORY_ENTITY] });
        await el.updateComplete;
        el._map!.fire("style.load");
        el.hass = hassFetching(callWS);
        await el.updateComplete;
        await vi.advanceTimersByTimeAsync(0);
        const before = callWS.mock.calls.length;

        el.remove();
        await vi.advanceTimersByTimeAsync(5 * 60_000);

        expect(callWS).toHaveBeenCalledTimes(before);
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not stack overlapping fetches", async () => {
      vi.useFakeTimers();
      try {
        // Never resolves — the first request stays in flight across several
        // interval ticks.
        const callWS = vi.fn().mockReturnValue(new Promise(() => {}));
        el.setConfig({ cluster_markers: false, entities: [HISTORY_ENTITY] });
        await el.updateComplete;
        el._map!.fire("style.load");
        el.hass = hassFetching(callWS);
        await el.updateComplete;
        await vi.advanceTimersByTimeAsync(3 * 60_000);

        expect(callWS).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("survives a rejecting history fetch without an unhandled rejection, and retries later", async () => {
      // Regression: _refreshHistory()'s chain had no .catch, and
      // _historyCatchUpDone was latched *before* awaiting, so a failed first
      // fetch was never retried.
      vi.useFakeTimers();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const callWS = vi
          .fn()
          .mockRejectedValueOnce(new Error("entity not found"))
          .mockResolvedValue({ "device_tracker.phone": [{ a: { latitude: 1, longitude: 2 } }, { a: { latitude: 3, longitude: 4 } }] });
        el.setConfig({ cluster_markers: false, entities: [HISTORY_ENTITY] });
        await el.updateComplete;
        el._map!.fire("style.load");
        el.hass = hassFetching(callWS);
        await el.updateComplete;
        await vi.advanceTimersByTimeAsync(0);

        await vi.advanceTimersByTimeAsync(60_000);
        expect(callWS).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(0);
        // The retry's trail did land — the source/layer was created.
        expect(el._map!.addLayer.mock.calls.some((c) => String((c[0] as { id: string }).id).startsWith("history-"))).toBe(
          true,
        );
      } finally {
        warn.mockRestore();
        vi.useRealTimers();
      }
    });

    it("discards a history response that lost the race to a newer request", async () => {
      let resolveFirst: (v: unknown) => void = () => {};
      const first = new Promise((r) => {
        resolveFirst = r;
      });
      const callWS = vi
        .fn()
        .mockReturnValueOnce(first)
        .mockResolvedValue({ "device_tracker.phone": [{ a: { latitude: 9, longitude: 9 } }] });

      await bootWithHistory(callWS);
      // A style swap invalidates the in-flight request (a response applied
      // mid-swap would call addSource() on an unloaded style, which the fake —
      // like MapLibre — throws on).
      el.setConfig({ cluster_markers: false, entities: [HISTORY_ENTITY], map_style: "https://example.com/other.json" });
      await el.updateComplete;

      resolveFirst({ "device_tracker.phone": [{ a: { latitude: 1, longitude: 2 } }] });
      await expect(flushMicrotasks()).resolves.toBeUndefined(); // no throw escapes
    });
  });

  describe("style swaps", () => {
    const entities = [
      { entity: "device_tracker.phone", fixed_x: 1, fixed_y: 2, circle: { radius: 25, source: "config" } },
    ];

    it("does not touch the render services while a style swap is still loading", async () => {
      // MapLibre's Style.addSource() throws "Style is not done loading."
      // between setStyle() and the next style.load. _ready used to latch true
      // on the first style.load and never clear, so a routine hass update
      // landing in that window threw straight out of updated().
      el.setConfig({ map_style: "https://example.com/a.json", entities });
      await el.updateComplete;
      el._map!.fire("style.load");
      el.hass = hassWith({});
      await el.updateComplete;
      const addSourceCalls = el._map!.addSource.mock.calls.length;
      expect(addSourceCalls).toBeGreaterThan(0);

      el.setConfig({ map_style: "https://example.com/b.json", entities });
      await el.updateComplete;
      // A routine state update from anywhere in the instance, mid-swap.
      el.hass = hassWith({});
      await el.updateComplete;

      expect(el._map!.addSource.mock.calls.length).toBe(addSourceCalls);

      // …and everything comes back once the new style has loaded.
      el._map!.fire("style.load");
      await el.updateComplete;
      expect(el._map!.addSource.mock.calls.length).toBeGreaterThan(addSourceCalls);
    });

    it("does not touch the circle sources when a cluster recompute lands mid-style-swap", async () => {
      // Regression: ClusterRenderService's zoomend/moveend listeners are on the
      // Map, not the style, so they fire straight through a setStyle().
      // _onSelectBaseStyle() starts the swap and then calls setMaxZoom(), which
      // MapLibre clamps synchronously — firing zoomend, recomputing clusters,
      // and reaching CircleRenderService.update() → addSource() against a style
      // that is not done loading. That throws uncaught out of a MapLibre event
      // handler (a plain drag during the ~100–500ms style fetch does it too).
      const clustered = [
        { entity: "device_tracker.a", fixed_x: 1, fixed_y: 2, circle: { radius: 25, source: "config" } },
        { entity: "device_tracker.b", fixed_x: 3, fixed_y: 4, circle: { radius: 25, source: "config" } },
      ];
      el.setConfig({
        layer_switcher: true,
        cluster_markers: true,
        entities: clustered,
        map_styles: [
          { name: "Streets", map_style: "https://example.com/streets.json" },
          { name: "Aerial", map_style: "https://example.com/aerial.json", max_zoom: 8 },
        ],
      });
      await el.updateComplete;
      el._map!.fire("style.load");
      el.hass = hassWith({});
      await el.updateComplete;
      await flushMicrotasks();
      await el.updateComplete;
      expect(el._map!.addSource.mock.calls.length).toBeGreaterThan(0);

      // Collapse both entities into one bubble (their circles go with their
      // markers), then pull them apart again — so the recompute forced by the
      // style switch below releases them and has to (re-)create their circle
      // sources, which is the addSource() that lands on the unloaded style.
      el._map!.project.mockReturnValue({ x: 0, y: 0 });
      el._map!.fire("zoomend");
      el._map!.project.mockImplementation((ll: [number, number]) => ({ x: ll[0] * 1e6, y: ll[1] * 1e6 }));
      const before = el._map!.addSource.mock.calls.length;

      const switcher = el.shadowRoot!.querySelector("nyxmap-layer-switcher") as unknown as {
        onSelectBaseStyle: (id: string) => void;
      };
      expect(() => switcher.onSelectBaseStyle("custom:Aerial")).not.toThrow();
      expect(el._map!.addSource.mock.calls.length).toBe(before);

      // …and circles come back once the new style is loaded.
      el._map!.fire("style.load");
      await el.updateComplete;
      expect(el._map!.addSource.mock.calls.length).toBeGreaterThan(before);
    });

    it("defers an overlay toggle clicked mid-style-swap instead of throwing and desyncing the switcher", async () => {
      // Regression: _onToggleOverlay wrote _overlayVisibility first, then let
      // setLayoutProperty's "Style is not done loading." throw escape — which
      // skipped the button refresh and requestUpdate(). The checkbox then
      // rendered checked while the state said hidden, and the style.load replay
      // brought the trail back shown.
      const historyEntity = {
        entity: "device_tracker.phone",
        fixed_x: 1,
        fixed_y: 2,
        history_start: "1 hour ago",
      };
      const baseConfig = { layer_switcher: true, cluster_markers: false, entities: [historyEntity] };
      el.setConfig(baseConfig);
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
        overlays: Array<{ id: string; active: boolean }>;
        onToggleOverlay: (id: string) => void;
      };
      const overlayId = switcher.overlays[0]!.id;

      // Start a style swap — the new style stays unloaded until style.load.
      el.setConfig({ ...baseConfig, map_style: "https://example.com/other.json" });
      await el.updateComplete;
      el._map!.setLayoutProperty.mockClear();

      expect(() => switcher.onToggleOverlay(overlayId)).not.toThrow();
      expect(el._map!.setLayoutProperty).not.toHaveBeenCalled();
      await el.updateComplete;
      const midSwap = el.shadowRoot!.querySelector("nyxmap-layer-switcher") as unknown as {
        overlays: Array<{ id: string; active: boolean }>;
      };
      expect(midSwap.overlays.find((o) => o.id === overlayId)?.active).toBe(false);

      // The click isn't lost: it's applied as soon as the style is loaded.
      el._map!.fire("style.load");
      await el.updateComplete;
      expect(el._map!.setLayoutProperty).toHaveBeenCalledWith(overlayId, "visibility", "none");
    });

    it("re-runs the render services on a config change that leaves the style URL unchanged", async () => {
      // setStyle() doesn't re-fire style.load when the resolved URL is
      // unchanged, so nothing re-ran the render services — an entity added in
      // the YAML/visual editor only appeared once some unrelated hass object
      // arrived, i.e. never in HA's "Edit card" preview pane, which often
      // holds a static hass.
      const phone = { entity: "device_tracker.phone", fixed_x: 1, fixed_y: 2 };
      el.setConfig({ entities: [phone] });
      await el.updateComplete;
      el._map!.fire("style.load");
      el.hass = hassWith({});
      await el.updateComplete;
      expect(el._entities?.has("device_tracker.tablet")).toBe(false);

      // No new hass object after this — only the config changes.
      el.setConfig({ entities: [phone, { entity: "device_tracker.tablet", fixed_x: 3, fixed_y: 4 }] });
      await el.updateComplete;

      expect(el._entities?.has("device_tracker.tablet")).toBe(true);
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

  describe("WebGL context loss", () => {
    // A lost context is routine in a Home Assistant dashboard: browsers cap the
    // number of live WebGL contexts and drop the oldest, so switching dashboard
    // tabs (or having a second map card) can kill this map's context at any
    // moment. maplibre-gl responds by setting `map.style = null`, but the card
    // kept both `_map` and `_ready` set, so the next hass update walked
    // straight into the render services and threw
    // "Cannot read properties of null (reading 'getSource')" out of updated().
    const entities = [{ entity: "device_tracker.phone" }];

    // gps_accuracy is what makes CircleRenderService actually reach
    // map.getSource() — the crash in the wild came through _refreshCircles.
    function trackedHass(): HomeAssistant {
      return hassWith({
        "device_tracker.phone": {
          entity_id: "device_tracker.phone",
          state: "home",
          attributes: { latitude: 2, longitude: 1, gps_accuracy: 50 },
        },
      } as unknown as HomeAssistant["states"]);
    }

    async function buildLoadedCard(): Promise<void> {
      el.setConfig({ entities });
      await el.updateComplete;
      el._map!.fire("style.load");
      el.hass = trackedHass();
      await el.updateComplete;
    }

    it("stops driving the render services once the WebGL context is lost", async () => {
      await buildLoadedCard();
      expect(el._map!.getSource).toHaveBeenCalled(); // guards the fixture itself
      el._map!.getSource.mockClear();

      el._map!.fire("webglcontextlost");
      el.hass = trackedHass();

      await expect(el.updateComplete).resolves.toBeDefined();
      expect(el._map!.getSource).not.toHaveBeenCalled();
    });

    it("resumes rendering after the context is restored and maplibre reloads the style", async () => {
      // maplibre's own _contextRestored re-runs setStyle(), which fires
      // "style.load" again — the card's existing handler is what re-arms it,
      // so recovery must not need any extra plumbing.
      await buildLoadedCard();
      el._map!.fire("webglcontextlost");
      el.hass = trackedHass();
      await el.updateComplete;
      el._map!.getSource.mockClear();

      el._map!.fire("style.load");
      await el.updateComplete;

      expect(el._map!.getSource).toHaveBeenCalled();
    });
  });
});
