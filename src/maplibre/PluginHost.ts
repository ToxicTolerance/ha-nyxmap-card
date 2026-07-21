import type maplibregl from "maplibre-gl";
import type { ControlPosition, IControl } from "maplibre-gl";
import type { MapConfig } from "../configs/MapConfig";
import type { HomeAssistant } from "../types/home-assistant";
import type { NyxmapOverlaySpec, NyxmapPluginContext } from "../types/nyxmap-plugin";
import type { LayerRegistry } from "../services/render/LayerRegistry";
// Source/overlay id prefixes owned by the card's own render services.
// StyleReattach and LayerRegistry are one flat string namespace shared with
// plugins, so a plugin id inside these ranges is rejected — a plain
// `reattach.has(id)` check isn't enough on its own because activate() runs
// *before* those services' first update() in the card's "style.load" handler,
// so a colliding plugin id would win the check and be clobbered moments later.
// Imported from OverlayIds (where the services build their ids) rather than
// re-listed here, so a new overlay type can't add a prefix without it landing
// in this check too.
import { RESERVED_OVERLAY_ID_PREFIXES } from "../services/render/OverlayIds";
import type { StyleReattach } from "./StyleReattach";

export interface PluginHostDeps {
  map: maplibregl.Map;
  /** The bundled maplibregl module, handed to plugins verbatim so global-scope
   * APIs (addProtocol, custom source types) act on the same instance the map
   * was built with — the whole point of exposing it (bundling otherwise
   * isolates it). */
  maplibregl: typeof maplibregl;
  /** The <nyxmap-card> element — the event target and ctx.card. */
  card: HTMLElement;
  layerRegistry: LayerRegistry;
  reattach: StyleReattach;
  getHass: () => HomeAssistant | undefined;
  getConfig: () => MapConfig | undefined;
}

/**
 * The card's JS extension point. Hands third-party MapLibre plugins the live
 * map and the bundled maplibregl, plus helpers for the two first-class plugin
 * categories: custom overlays (source + layers) and IControl controls.
 *
 * Plugins attach two ways, both delivering the same NyxmapPluginContext:
 *   1. window.nyxmapPlugins — a global array of { setup(ctx) } objects (mirrors
 *      HA's window.customCards); applies to every nyxmap-card.
 *   2. a bubbling/composed "nyxmap-map-ready" CustomEvent on the card element,
 *      carrying the ctx in detail — the per-card / element-scoped path.
 *
 * activate() runs the setup pass exactly once (it's called from the card's
 * "style.load" handler, which fires again on every theme swap). Overlays
 * registered through the ctx go through StyleReattach, so they survive those
 * swaps without setup running again — see registerOverlay.
 */
export class PluginHost {
  private _activated = false;
  private readonly _overlayVisible = new Map<string, boolean>();
  private readonly _injectedStyles = new Set<string>();

  constructor(private readonly deps: PluginHostDeps) {}

  activate(): void {
    if (this._activated) return;
    this._activated = true;

    const ctx = this._buildContext();

    for (const plugin of window.nyxmapPlugins ?? []) {
      try {
        plugin.setup(ctx);
      } catch (err) {
        // A misbehaving plugin must never take the card down with it.
        console.error("[nyxmap-card] plugin setup() failed:", err);
      }
    }

    // Per-card path: a listener may be attached anywhere up the tree (the event
    // is composed + bubbling, so it reaches window). Its own handler errors are
    // the listener's responsibility, same as any DOM event.
    this.deps.card.dispatchEvent(
      new CustomEvent<NyxmapPluginContext>("nyxmap-map-ready", {
        detail: ctx,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _buildContext(): NyxmapPluginContext {
    return {
      map: this.deps.map,
      maplibregl: this.deps.maplibregl,
      card: this.deps.card,
      getHass: () => this.deps.getHass(),
      getConfig: () => this.deps.getConfig(),
      reattach: this.deps.reattach,
      registerOverlay: (id, overlay) => this._registerOverlay(id, overlay),
      registerControl: (control, position) => this._registerControl(control, position),
      injectStyle: (cssOrUrl) => this._injectStyle(cssOrUrl),
    };
  }

  /**
   * map.addControl() synchronously calls the control's onAdd(), which is
   * third-party code — same trust level as setup(), so it gets the same
   * isolation. Without this a control throwing from onAdd escapes into
   * MapLibre and (via the event path, where setup() itself isn't wrapped)
   * can take the "style.load" handler down with it.
   */
  private _registerControl(control: IControl, position?: ControlPosition): void {
    try {
      this.deps.map.addControl(control, position);
    } catch (err) {
      console.error("[nyxmap-card] plugin registerControl() failed:", err);
    }
  }

  /**
   * Inject a plugin's CSS into the card's shadow root — the ONLY place it can
   * reach the map DOM (the card renders in a shadow root, which walls off
   * stylesheets loaded globally into document.head). Without this, a visual
   * plugin like a compass/minimap attaches but renders at 0×0 (unstyled),
   * i.e. invisible. Accepts a URL (added as a <link>, which works inside a
   * shadow root and needs no CORS fetch) or a raw CSS string (added as a
   * <style>). Deduped so repeated calls with the same value are a no-op.
   */
  private _injectStyle(cssOrUrl: string): void {
    const root = this.deps.card.shadowRoot;
    if (!root) {
      console.warn("[nyxmap-card] injectStyle: card has no shadow root to inject into.");
      return;
    }
    if (this._injectedStyles.has(cssOrUrl)) return;
    this._injectedStyles.add(cssOrUrl);

    const looksLikeUrl =
      /^https?:\/\//i.test(cssOrUrl) || cssOrUrl.startsWith("/") || /\.css(\?|#|$)/i.test(cssOrUrl.trim());
    if (looksLikeUrl && !cssOrUrl.includes("{")) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = cssOrUrl;
      root.appendChild(link);
    } else {
      const style = document.createElement("style");
      style.textContent = cssOrUrl;
      root.appendChild(style);
    }
  }

  /**
   * Registering an overlay is all-or-nothing: on an id collision we reject
   * outright rather than partially register. Registering anyway would leave
   * the card in an unrecoverable split state — _addOverlay bails on the
   * existing source while reattach/layerRegistry (plain Map.set) overwrite the
   * internal service's entries, so after the next theme swap the internal
   * overlay is never re-added and the switcher toggles layer ids that don't
   * exist. See code-review finding 10.
   */
  private _registerOverlay(id: string, overlay: NyxmapOverlaySpec): void {
    const reserved = RESERVED_OVERLAY_ID_PREFIXES.find((prefix) => id.startsWith(prefix));
    if (reserved) {
      console.warn(
        `[nyxmap-card] plugin overlay id "${id}" uses the reserved "${reserved}" prefix (owned by the card's own overlays) — rejected. Namespace it, e.g. "plugin:${id}".`,
      );
      return;
    }
    if (this.deps.reattach.has(id) || this.deps.layerRegistry.getOverlays().has(id)) {
      console.warn(
        `[nyxmap-card] plugin overlay id "${id}" collides with an existing overlay — rejected. Namespace it, e.g. "plugin:${id}".`,
      );
      return;
    }
    this._overlayVisible.set(id, overlay.visible ?? true);

    // Same three registrations GeoJsonRenderService makes for its overlays:
    // add now, replay after every theme swap (setStyle wipes sources/layers),
    // and list as a toggleable layer-switcher entry.
    this._addOverlay(id, overlay, this.deps.map);
    this.deps.reattach.register(id, (map) => this._addOverlay(id, overlay, map));
    this.deps.layerRegistry.registerOverlay(id, {
      label: overlay.label,
      group: overlay.group,
      setVisible: (map, visible) => {
        this._overlayVisible.set(id, visible);
        const layout = visible ? "visible" : "none";
        const m = map as maplibregl.Map;
        for (const layer of overlay.layers) m.setLayoutProperty(layer.id, "visibility", layout);
      },
    });
  }

  /** Idempotent add of an overlay's source + layers, honouring its current
   * visibility. Guards on getSource so a replay (or a double call) is a no-op,
   * mirroring GeoJsonRenderService._upsert's reattach factory. */
  private _addOverlay(id: string, overlay: NyxmapOverlaySpec, map: maplibregl.Map): void {
    if (map.getSource(id)) return;
    map.addSource(id, overlay.source);
    const visibility = (this._overlayVisible.get(id) ?? true) ? "visible" : "none";
    for (const layer of overlay.layers) {
      map.addLayer({
        ...layer,
        layout: { ...(layer.layout as Record<string, unknown> | undefined), visibility },
      } as maplibregl.LayerSpecification);
    }
  }
}
