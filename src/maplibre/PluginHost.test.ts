// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeMaplibreMap } from "../../test/fakes/FakeMaplibreMap";
import { LayerRegistry } from "../services/render/LayerRegistry";
import type { NyxmapPlugin, NyxmapPluginContext } from "../types/nyxmap-plugin";
import { PluginHost, type PluginHostDeps } from "./PluginHost";
import { StyleReattach } from "./StyleReattach";

function makeHost(overrides: Partial<PluginHostDeps> = {}) {
  const map = createFakeMaplibreMap();
  const card = document.createElement("div");
  // A shadow root so injectStyle has somewhere to inject (the real card is a
  // LitElement with an open shadow root).
  const shadow = card.attachShadow({ mode: "open" });
  // Attach so a bubbling/composed "nyxmap-map-ready" event actually reaches
  // window (a detached node's events never propagate up the document tree).
  document.body.appendChild(card);
  const reattach = new StyleReattach();
  const layerRegistry = new LayerRegistry();
  const deps: PluginHostDeps = {
    map: map as never,
    maplibregl: { sentinel: true } as never,
    card,
    reattach,
    layerRegistry,
    getHass: () => undefined,
    getConfig: () => undefined,
    ...overrides,
  };
  return { host: new PluginHost(deps), map, card, shadow, reattach, layerRegistry };
}

beforeEach(() => {
  window.nyxmapPlugins = [];
});
afterEach(() => {
  delete window.nyxmapPlugins;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("PluginHost", () => {
  it("runs every window.nyxmapPlugins setup once with a context", () => {
    const setup = vi.fn();
    window.nyxmapPlugins = [{ setup }];
    const { host, map, card } = makeHost();

    host.activate();

    expect(setup).toHaveBeenCalledTimes(1);
    const ctx = setup.mock.calls[0]![0] as NyxmapPluginContext;
    expect(ctx.map).toBe(map);
    expect(ctx.card).toBe(card);
    expect((ctx.maplibregl as unknown as { sentinel: boolean }).sentinel).toBe(true);
  });

  it("dispatches a bubbling/composed nyxmap-map-ready event carrying the context", () => {
    const { host, card } = makeHost();
    const onReady = vi.fn();
    window.addEventListener("nyxmap-map-ready", onReady as EventListener);

    host.activate();

    expect(onReady).toHaveBeenCalledTimes(1);
    const evt = onReady.mock.calls[0]![0] as CustomEvent<NyxmapPluginContext>;
    expect(evt.bubbles).toBe(true);
    expect(evt.composed).toBe(true);
    expect(evt.detail.card).toBe(card);
    window.removeEventListener("nyxmap-map-ready", onReady as EventListener);
  });

  it("runs the setup pass only once across repeated activate() calls (theme swaps)", () => {
    const setup = vi.fn();
    window.nyxmapPlugins = [{ setup }];
    const { host } = makeHost();

    host.activate();
    host.activate();
    host.activate();

    expect(setup).toHaveBeenCalledTimes(1);
  });

  it("registerOverlay adds the source + layers, registers reattach + a switcher overlay", () => {
    const overlaySource = { type: "geojson", data: { type: "FeatureCollection", features: [] } };
    const plugin: NyxmapPlugin = {
      setup(ctx) {
        ctx.registerOverlay("plugin:quakes", {
          label: "Earthquakes",
          group: "plugins",
          source: overlaySource as never,
          layers: [{ id: "plugin:quakes-dots", type: "circle", source: "plugin:quakes" } as never],
        });
      },
    };
    window.nyxmapPlugins = [plugin];
    const { host, map, reattach, layerRegistry } = makeHost();

    host.activate();

    expect(map.addSource).toHaveBeenCalledWith("plugin:quakes", overlaySource);
    expect(map.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: "plugin:quakes-dots", layout: expect.objectContaining({ visibility: "visible" }) }),
    );
    expect(reattach.has("plugin:quakes")).toBe(true);
    expect(layerRegistry.getOverlays().get("plugin:quakes")?.label).toBe("Earthquakes");
  });

  it("replays a plugin overlay on style reattach (survives theme swaps)", () => {
    window.nyxmapPlugins = [
      {
        setup(ctx) {
          ctx.registerOverlay("plugin:quakes", {
            label: "Earthquakes",
            source: { type: "geojson", data: {} } as never,
            layers: [{ id: "plugin:quakes-dots", type: "circle", source: "plugin:quakes" } as never],
          });
        },
      },
    ];
    const { host, map, reattach } = makeHost();

    host.activate();
    map.addSource.mockClear();
    reattach.replayAll(map as never);

    expect(map.addSource).toHaveBeenCalledWith("plugin:quakes", expect.anything());
  });

  it("overlay setVisible toggles layer visibility through the layer registry", () => {
    window.nyxmapPlugins = [
      {
        setup(ctx) {
          ctx.registerOverlay("plugin:quakes", {
            label: "Earthquakes",
            source: { type: "geojson", data: {} } as never,
            layers: [{ id: "plugin:quakes-dots", type: "circle", source: "plugin:quakes" } as never],
          });
        },
      },
    ];
    const { host, map, layerRegistry } = makeHost();
    host.activate();

    layerRegistry.getOverlays().get("plugin:quakes")!.setVisible(map, false);

    expect(map.setLayoutProperty).toHaveBeenCalledWith("plugin:quakes-dots", "visibility", "none");
  });

  it("injectStyle adds a <link> for a URL and a <style> for raw CSS into the card's shadow root", () => {
    window.nyxmapPlugins = [
      {
        setup(ctx) {
          ctx.injectStyle("https://esm.sh/maplibre-compass-pro/dist/style.css");
          ctx.injectStyle(".compass-pro { width: 80px }");
        },
      },
    ];
    const { host, shadow } = makeHost();

    host.activate();

    const link = shadow.querySelector("link[rel=stylesheet]") as HTMLLinkElement | null;
    expect(link?.href).toContain("maplibre-compass-pro/dist/style.css");
    const style = shadow.querySelector("style");
    expect(style?.textContent).toContain(".compass-pro");
  });

  it("injectStyle dedupes repeated identical injections", () => {
    window.nyxmapPlugins = [
      {
        setup(ctx) {
          ctx.injectStyle("https://example.com/a.css");
          ctx.injectStyle("https://example.com/a.css");
        },
      },
    ];
    const { host, shadow } = makeHost();

    host.activate();

    expect(shadow.querySelectorAll("link[rel=stylesheet]")).toHaveLength(1);
  });

  it("registerControl forwards to map.addControl", () => {
    const control = { onAdd: vi.fn(), onRemove: vi.fn() };
    window.nyxmapPlugins = [{ setup: (ctx) => ctx.registerControl(control as never, "top-left") }];
    const { host, map } = makeHost();

    host.activate();

    expect(map.addControl).toHaveBeenCalledWith(control, "top-left");
  });

  it("isolates a throwing plugin so the card and other plugins are unaffected", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const good = vi.fn();
    window.nyxmapPlugins = [
      { setup: () => { throw new Error("boom"); } },
      { setup: good },
    ];
    const { host } = makeHost();

    expect(() => host.activate()).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
  });

  it("does not throw when no plugins are registered but still fires the event", () => {
    delete window.nyxmapPlugins;
    const { host } = makeHost();
    const onReady = vi.fn();
    window.addEventListener("nyxmap-map-ready", onReady as EventListener);

    expect(() => host.activate()).not.toThrow();
    expect(onReady).toHaveBeenCalledTimes(1);
    window.removeEventListener("nyxmap-map-ready", onReady as EventListener);
  });
});
