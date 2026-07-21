/** Public plugin-author contract for nyxmap-card's JS extension hook. This is
 * the surface third-party MapLibre plugins bind to — kept deliberately small
 * and stable, mirroring the duck-typed precedent of ./ha-form.d.ts and
 * ./home-assistant.d.ts. See PluginHost.ts for the implementation and README's
 * "Plugins" section for usage. */
import type {
  ControlPosition,
  IControl,
  LayerSpecification,
  Map as MapLibreMap,
  SourceSpecification,
} from "maplibre-gl";
import type maplibregl from "maplibre-gl";
import type { MapConfig } from "../configs/MapConfig";
import type { StyleReattach } from "../maplibre/StyleReattach";
import type { HomeAssistant } from "./home-assistant";

/** A custom overlay (one source + its layers) added via
 * NyxmapPluginContext.registerOverlay. The source is referenced by the `id`
 * passed alongside this object; every layer's `source` must equal that id. */
export interface NyxmapOverlaySpec {
  /** Human label shown in the layer switcher's overlay list. */
  label: string;
  /** Optional grouping key (see LayerRegistry.OverlayEntry.group). */
  group?: string;
  source: SourceSpecification;
  /** Layer ids are the author's own; each layer's `source` must match the
   * overlay id. */
  layers: LayerSpecification[];
  /** Initial visibility — defaults to true. */
  visible?: boolean;
}

/** Handed to every plugin's setup(). Exposes the live map and the exact
 * bundled maplibregl module, plus helpers for the two first-class plugin
 * categories (overlays and controls). */
export interface NyxmapPluginContext {
  /** The live MapLibre map instance. */
  map: MapLibreMap;
  /** The exact bundled maplibregl module — escape hatch for anything not yet
   * first-class here (e.g. maplibregl.addProtocol / custom source types). */
  maplibregl: typeof maplibregl;
  /** The <nyxmap-card> custom element the map belongs to. */
  card: HTMLElement;
  /** Current Home Assistant object. A getter, not a snapshot — states change
   * over the card's lifetime. */
  getHass(): HomeAssistant | undefined;
  /** The parsed card configuration. */
  getConfig(): MapConfig | undefined;
  /** Advanced escape hatch: register a factory replayed after every theme
   * swap (map.setStyle wipes sources/layers). registerOverlay already does
   * this for you — reach for this only when hand-rolling sources/layers.
   * Ids here share one flat namespace with the card's own overlays, and this
   * hatch does NOT check for collisions the way registerOverlay does — prefix
   * your ids (see registerOverlay). A factory that throws is logged and
   * skipped; the remaining overlays still replay. */
  reattach: StyleReattach;
  /** Add a custom overlay: its source + layers are added now, replayed on
   * every theme swap, and listed as a toggleable entry in the layer switcher.
   *
   * `id` MUST be namespaced (the `plugin:` prefix is the convention) — it is
   * the key for the map source, the theme-swap replay registry and the layer
   * switcher, all of which the card's own overlays share. A registration is
   * **rejected** (warning on the console, nothing registered) when `id`
   * already exists or starts with a reserved built-in prefix: `history-`,
   * `circle-`, `geojson-`, `tile-layer-`, `wms-layer-`. */
  registerOverlay(id: string, overlay: NyxmapOverlaySpec): void;
  /** Add a MapLibre IControl to the map (e.g. a draw/minimap/geocoder
   * plugin). Controls live outside the style, so they survive theme swaps on
   * their own. Thin wrapper over map.addControl; a throw from the control's
   * onAdd is caught and logged rather than propagated into the card. */
  registerControl(control: IControl, position?: ControlPosition): void;
  /** Inject a plugin's stylesheet into the card's shadow root — required for
   * any plugin that ships its own CSS (compass, minimap, geocoder, …), since
   * the card renders in a shadow root that global stylesheets can't reach
   * (without this such a control attaches but renders invisibly at 0×0).
   * Pass a URL (added as a <link>) or a raw CSS string (added as a <style>). */
  injectStyle(cssOrUrl: string): void;
}

/** A nyxmap plugin: an object with a setup() run once per card when the map is
 * first ready. Register via window.nyxmapPlugins or the nyxmap-map-ready
 * event. */
export interface NyxmapPlugin {
  setup(ctx: NyxmapPluginContext): void;
}

declare global {
  interface Window {
    /** Global plugin registry — push NyxmapPlugin objects here (mirrors HA's
     * own window.customCards convention). Every registered plugin's setup()
     * runs once per nyxmap-card instance. */
    nyxmapPlugins?: NyxmapPlugin[];
  }

  interface WindowEventMap {
    /** Dispatched (bubbling, composed) on each nyxmap-card element when its
     * map is first ready, carrying the NyxmapPluginContext in `detail`. */
    "nyxmap-map-ready": CustomEvent<NyxmapPluginContext>;
  }
}
