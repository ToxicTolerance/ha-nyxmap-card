import { LitElement, html, unsafeCSS, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { MapConfig, type MapConfigRaw } from "../configs/MapConfig";
import { buildStubConfig } from "../editor/CardFormSchema";
import { EntityHistoryManager } from "../models/EntityHistoryManager";
import { IconButtonControl } from "../maplibre/IconButtonControl";
import { maplibreCss, maplibregl } from "../maplibre/MapLibreLoader";
import { StyleReattach } from "../maplibre/StyleReattach";
import "./NyxmapCardEditor";
import { HaHistoryService } from "../services/HaHistoryService";
import { CircleRenderService } from "../services/render/CircleRenderService";
import { ClusterRenderService, type ClusterMapLike } from "../services/render/ClusterRenderService";
import { EntitiesRenderService, type MapLibreGlLike } from "../services/render/EntitiesRenderService";
import { GeoJsonRenderService, type GeoJsonMapLike } from "../services/render/GeoJsonRenderService";
import { HistoryRenderService, type MapSourceLike } from "../services/render/HistoryRenderService";
import { InitialViewRenderService, type MapViewLike } from "../services/render/InitialViewRenderService";
import { LayerRegistry } from "../services/render/LayerRegistry";
import { TileLayersRenderService, type TileLayersMapLike } from "../services/render/TileLayersRenderService";
import type { HomeAssistant } from "../types/home-assistant";
import { resolveStyle, resolveStylePair, resolveThemeMode } from "../util/HaMapUtilities";
import "./LayerSwitcherControl";
import type { SwitcherBaseStyleItem, SwitcherOverlayItem } from "./LayerSwitcherControl";
import { nyxmapCardStyles } from "./NyxmapCard.styles";

@customElement("nyxmap-card")
export class NyxmapCard extends LitElement {
  static override styles = [unsafeCSS(maplibreCss), nyxmapCardStyles];

  @property({ attribute: false }) hass?: HomeAssistant;
  @state() private _config?: MapConfig;
  /** Layer switcher's base-style radio selection; undefined means "no
   * manual override, follow theme_mode" (the original Phase 1 behavior). */
  @state() private _manualStyleId?: string;

  private _map?: maplibregl.Map;
  private _built = false;
  private _ready = false;
  private _entities?: EntitiesRenderService;
  private _history?: HistoryRenderService;
  private _circles?: CircleRenderService;
  private _geojson?: GeoJsonRenderService;
  private _cluster?: ClusterRenderService;
  private _tileLayers?: TileLayersRenderService;
  private _clusterToggleControl?: IconButtonControl;
  private _initialViewApplied = false;
  private _historyCatchUpDone = false;
  private _resizeObserver?: ResizeObserver;
  private _resizeRaf?: number;
  private readonly _reattach = new StyleReattach();
  private readonly _historyManager = new EntityHistoryManager();
  private readonly _initialView = new InitialViewRenderService();
  private readonly _layerRegistry = new LayerRegistry();
  private readonly _overlayVisibility = new Map<string, boolean>();

  setConfig(config: MapConfigRaw): void {
    this._config = new MapConfig(config);
    if (this._built && this._map) {
      this._map.setStyle(this._resolveActiveStyleUrl());
    }
  }

  static getConfigElement(): HTMLElement {
    return document.createElement("nyxmap-card-editor");
  }

  static getStubConfig(hass?: HomeAssistant): MapConfigRaw {
    return buildStubConfig(hass);
  }

  /** HA's masonry/grid layout uses this (in ~50px units) to pre-allocate
   * space for the card before it renders. Deriving it from mapHeight rather
   * than returning the raw card_size config keeps it in sync when an
   * explicit `height:` is set without a matching `card_size` — otherwise
   * masonry underestimates the card's real height, throwing off the whole
   * dashboard's layout (surfacing as an unexpected page-level scrollbar). */
  getCardSize(): number {
    return Math.max(1, Math.ceil((this._config?.mapHeight ?? 250) / 50));
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._resizeObserver?.disconnect();
    if (this._resizeRaf !== undefined) cancelAnimationFrame(this._resizeRaf);
  }

  protected override updated(changed: PropertyValues): void {
    // Opt the host into height:100% only when the user configured a
    // percentage/CSS-length height (e.g. "100%" for a Home Assistant Panel
    // view). This used to be an unconditional CSS rule, but that collided
    // with dashboard layouts that stretch card hosts to their own row
    // height via CSS Grid (e.g. HA's Sections view): ha-card would then
    // shrink to that external height instead of sizing to its content,
    // clipping the bottom of the map (and whatever control lived there)
    // even though nothing was actually configured to fill 100% of anything.
    this.style.height = typeof this._config?.height === "string" ? "100%" : "";

    if (!this._built && this._config) {
      this._buildMap();
    }
    if (changed.has("hass") && this._ready && this._config && this.hass) {
      // tile_layers/wms first: MapLibre stacks layers in add order (later
      // added = drawn on top), and raster overlays are documented as sitting
      // "on top of the vector base style" — but not on top of our own entity
      // overlays. Adding them before circles/geojson/clusters means those
      // overlays' first-ever addLayer() call (which is what actually fixes
      // z-order; setData()/setTiles() on an already-created layer doesn't
      // move it) lands after the raster layer, keeping markers/shapes visible
      // above it instead of hidden underneath.
      this._tileLayers?.update(this._config.tileLayers, this._config.wms, this.hass);
      this._updateEntitiesAndClusters();
      this._circles?.update(this._config.entities, this.hass);
      this._geojson?.update(this._config.entities, this.hass);
      this._applyInitialViewIfNeeded();
      this._initialView.updateFit(
        this._map as unknown as MapViewLike,
        this._config.entities,
        this.hass,
        this._config.focusFollow,
      );
      // Catch-up for the (uncommon but possible) case where hass wasn't set
      // yet when "style.load" first fired, so the refresh below never ran.
      // Guarded so it only ever fires once — see _refreshHistory().
      if (!this._historyCatchUpDone) this._refreshHistory();
    }
  }

  protected override render() {
    const height = this._config?.cssHeight ?? "250px";
    return html`
      <ha-card>
        <div class="nyxmap-viewport" style="height: ${height}">
          ${this._config?.title ? html`<div class="nyxmap-title">${this._config.title}</div>` : null}
          <div class="nyxmap-map-area">
            <div class="nyxmap-container"></div>
            ${this._config?.layerSwitcher
              ? html`<nyxmap-layer-switcher
                  .baseStyles=${this._baseStyleItems()}
                  .overlays=${this._overlayItems()}
                  .onSelectBaseStyle=${(id: string) => this._onSelectBaseStyle(id)}
                  .onToggleOverlay=${(id: string) => this._onToggleOverlay(id)}
                ></nyxmap-layer-switcher>`
              : null}
          </div>
        </div>
      </ha-card>
    `;
  }

  private _scheduleResize(): void {
    if (this._resizeRaf !== undefined) cancelAnimationFrame(this._resizeRaf);
    this._resizeRaf = requestAnimationFrame(() => {
      this._resizeRaf = undefined;
      this._map?.resize();
    });
  }

  private _prefersDark(): boolean {
    return matchMedia("(prefers-color-scheme: dark)").matches;
  }

  /** Manual switcher selection (if any) takes precedence over the automatic
   * theme_mode resolution — see LayerRegistry.BaseStyleEntry: each entry is
   * still a light/dark pair, so a genuinely dual-variant custom style keeps
   * responding to the system theme even while "selected". */
  private _resolveActiveStyleUrl(): string {
    if (this._manualStyleId && this._config) {
      const entry = this._layerRegistry.getBaseStyles().get(this._manualStyleId);
      if (entry) return resolveStylePair(entry, this._config.themeMode, this._prefersDark());
    }
    return resolveStyle(this._config!, this._prefersDark());
  }

  private _defaultBaseStyleId(): "light" | "dark" {
    if (!this._config) return "light";
    return resolveThemeMode(this._config.themeMode, this._prefersDark()) === "dark" ? "dark" : "light";
  }

  private _baseStyleItems(): SwitcherBaseStyleItem[] {
    const activeId = this._manualStyleId ?? this._defaultBaseStyleId();
    return [...this._layerRegistry.getBaseStyles().entries()].map(([id, entry]) => ({
      id,
      label: entry.label,
      active: id === activeId,
    }));
  }

  private _overlayItems(): SwitcherOverlayItem[] {
    return [...this._layerRegistry.getOverlays().entries()].map(([id, entry]) => ({
      id,
      label: entry.label,
      group: entry.group,
      active: this._overlayVisibility.get(id) ?? true,
    }));
  }

  private _onSelectBaseStyle(id: string): void {
    this._manualStyleId = id;
    if (!this._map || !this._config) return;
    this._map.setStyle(this._resolveActiveStyleUrl());
    // Each base style can have its own real coverage limit (see
    // MapConfig.NamedMapStyle.maxZoom/minZoom) — e.g. a regional aerial
    // overlay topping out at z19 while a general vector style goes to z22.
    // Without re-applying the camera's zoom range on every switch, a style
    // with no limits of its own would stay stuck at whatever the *previous*
    // style capped it to, or a capped style wouldn't be capped at all,
    // letting the camera zoom past real tile coverage into 400s/blank tiles.
    const entry = this._layerRegistry.getBaseStyles().get(id);
    this._map.setMaxZoom(entry?.maxZoom ?? this._config.maxZoom ?? 22);
    this._map.setMinZoom(entry?.minZoom ?? this._config.minZoom ?? 0);
  }

  private _onToggleOverlay(id: string): void {
    const next = !(this._overlayVisibility.get(id) ?? true);
    this._overlayVisibility.set(id, next);
    const entry = this._layerRegistry.getOverlays().get(id);
    if (entry && this._map) entry.setVisible(this._map, next);
    // Keeps the dedicated "Toggle grouping" map button's pressed state in
    // sync when clusters are toggled via the layer switcher's own checkbox
    // instead (both drive the same "entity-clusters" overlay id).
    this._clusterToggleControl?.refresh();
    this.requestUpdate();
  }

  private _buildMap(): void {
    const config = this._config;
    const container = this.renderRoot.querySelector<HTMLDivElement>(".nyxmap-container");
    if (!config || !container) return;
    this._built = true;

    // Seeds the layer switcher's base-style radio group. Registered once at
    // build time — changing map_styles on a later setConfig() won't add new
    // options until the card is reloaded, an accepted MVP simplification.
    //
    // The generic Light/Dark entries only make sense when they're the only
    // base styles on offer — once the user provides their own map_styles,
    // Light/Dark just duplicate (or conflict with) whatever's in that list
    // under a generic name, which is confusing rather than useful. With
    // map_styles present, the switcher shows only those named entries;
    // map_style/map_style_dark still drive the initial auto theme-follow
    // (see _resolveActiveStyleUrl), just without a separate button for it.
    if (config.mapStyles.length === 0) {
      this._layerRegistry.registerBaseStyle("light", {
        label: "Light",
        styleLight: config.styleLight,
        styleDark: config.styleLight,
      });
      this._layerRegistry.registerBaseStyle("dark", {
        label: "Dark",
        styleLight: config.styleDark,
        styleDark: config.styleDark,
      });
    }
    for (const s of config.mapStyles) {
      this._layerRegistry.registerBaseStyle(`custom:${s.name}`, {
        label: s.name,
        styleLight: s.styleLight,
        styleDark: s.styleDark,
        maxZoom: s.maxZoom,
        minZoom: s.minZoom,
      });
    }

    // The initially active style (via map_style/map_style_dark) may itself
    // be one of the named map_styles entries above — if so, its own
    // maxZoom/minZoom must cap the camera from the very first frame, the
    // same way _onSelectBaseStyle caps it on a manual switch. Otherwise a
    // raster style narrower than the card-level cap (e.g. a WMTS aerial
    // layer capped tighter than the general max_zoom) keeps the wider
    // card-level bound until the user happens to reselect it via the
    // switcher, overshooting into blank tiles/400s on initial load.
    const initialEntry = config.mapStyles.find(
      (s) => s.styleLight === config.styleLight && s.styleDark === config.styleDark,
    );

    const initialCenter = this._initialView.getInitialCenter(config, this.hass) ?? [config.x ?? 0, config.y ?? 0];
    this._map = new maplibregl.Map({
      container,
      style: this._resolveActiveStyleUrl(),
      center: initialCenter,
      zoom: config.zoom,
      maxZoom: initialEntry?.maxZoom ?? config.maxZoom,
      minZoom: initialEntry?.minZoom ?? config.minZoom,
      attributionControl: { compact: true },
    });
    this._map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right");

    // Ports upstream ha-map-card's "Reset focus" map button — always
    // present, re-runs the same initial-view resolution _applyInitialView()
    // already uses (explicit x/y > focus_entity > fit all entities).
    // Placed bottom-left (otherwise unused: NavigationControl already owns
    // top-right, the layer switcher top-left, attribution bottom-right) —
    // stacking these under NavigationControl's 3 buttons instead visually
    // collided with the bottom-right attribution control on shorter map
    // heights, confirmed via the dev harness at its default ~205px height.
    this._map.addControl(
      new IconButtonControl({
        icon: "mdi:image-filter-center-focus",
        label: "Reset focus",
        onClick: () => this._applyInitialView(),
      }),
      "bottom-left",
    );
    // Ports upstream's "Toggle grouping" button — only present when
    // cluster_markers is on, matching upstream. Reuses the exact same
    // overlay-visibility plumbing the layer switcher's own "Clusters"
    // checkbox uses, so the two controls always agree with each other.
    if (config.clusterMarkers) {
      this._clusterToggleControl = new IconButtonControl({
        icon: "mdi:group",
        label: "Toggle grouping",
        onClick: () => this._onToggleOverlay("entity-clusters"),
        isPressed: () => this._overlayVisibility.get("entity-clusters") ?? true,
      });
      this._map.addControl(this._clusterToggleControl, "bottom-left");
    }

    // MapLibre installs its own ResizeObserver on the container, but its
    // very first notification after `.observe()` is deliberately ignored
    // (it assumes the container is already correctly sized at construction
    // time). Home Assistant's masonry/grid layout computes each card's real
    // column width asynchronously, shortly after the card mounts — if that
    // resize lands within the same first notification batch, MapLibre
    // silently drops it and the canvas stays locked at whatever (possibly
    // too-small) size it read at construction, until something else forces
    // a fresh layout pass (e.g. switching dashboard tabs and back). Our own
    // observer has no such skip, so it catches that corrective resize (and
    // any later one — sidebar toggle, window resize, editing the dashboard).
    this._resizeObserver = new ResizeObserver(() => this._scheduleResize());
    this._resizeObserver.observe(container);
    // Also nudge once after layout has settled post-construction, for
    // engines/timings where even a second ResizeObserver tick doesn't land
    // before first paint.
    requestAnimationFrame(() => requestAnimationFrame(() => this._map?.resize()));

    this._entities = new EntitiesRenderService(this._map, maplibregl as unknown as MapLibreGlLike, (entityId) =>
      this._fireMoreInfo(entityId),
    );
    this._history = new HistoryRenderService(
      this._map as unknown as MapSourceLike,
      this._reattach,
      this._layerRegistry,
    );
    this._circles = new CircleRenderService(
      this._map as unknown as MapSourceLike,
      this._reattach,
      this._layerRegistry,
    );
    this._geojson = new GeoJsonRenderService(
      this._map as unknown as GeoJsonMapLike,
      this._reattach,
      this._layerRegistry,
      (entityId) => this._fireMoreInfo(entityId),
    );
    this._cluster = new ClusterRenderService(
      this._map as unknown as ClusterMapLike,
      this._reattach,
      this._layerRegistry,
      () => this._resyncEntityMarkers(),
    );
    this._tileLayers = new TileLayersRenderService(
      this._map as unknown as TileLayersMapLike,
      this._reattach,
      this._layerRegistry,
    );

    // Base styles are now registered — re-render so the switcher (if
    // enabled) reflects them instead of showing an empty radio group, and
    // (if the initial style matched a named entry above) highlight it as
    // the active switcher selection instead of leaving nothing selected.
    // Deferred to a microtask: _buildMap() runs synchronously inside
    // updated(), and requesting another update from there (or assigning a
    // @state property, which schedules one implicitly) triggers Lit's
    // "scheduled an update after an update completed" dev-mode warning.
    queueMicrotask(() => {
      if (initialEntry) this._manualStyleId = `custom:${initialEntry.name}`;
      this.requestUpdate();
    });

    // Fires on first load AND after every subsequent setStyle() (theme
    // swap). Sources/layers (history trails) get wiped by setStyle() and are
    // replayed here via _reattach; markers are unaffected and just get their
    // positions refreshed. Each style's own JSON may carry a "projection" of
    // its own (defaulting to mercator when unset), so re-apply ours here too
    // rather than only at construction.
    this._map.on("style.load", () => {
      this._ready = true;
      if (this._config) this._map!.setProjection({ type: this._config.projection });
      this._reattach.replayAll(this._map!);
      if (this._config && this.hass) {
        // tile_layers/wms first — see the matching comment in updated()'s
        // hass branch: this is what actually fixes the z-order, since this is
        // the very first time (pre-_ready) any of these sources/layers get
        // created via addLayer(), which is also what seeds StyleReattach's
        // replay order for every later theme swap.
        this._tileLayers?.update(this._config.tileLayers, this._config.wms, this.hass);
        this._updateEntitiesAndClusters();
        this._circles?.update(this._config.entities, this.hass);
        this._geojson?.update(this._config.entities, this.hass);
        this._refreshHistory();
        this._applyInitialViewIfNeeded();
      }
    });
  }

  /** Feeds ClusterRenderService (or tears it down when cluster_markers is
   * off, so no empty source/overlay lingers) and then resyncs entity markers
   * against whatever it now considers clustered. Called from both updated()'s
   * hass branch and the "style.load" handler, same as every other service. */
  private _updateEntitiesAndClusters(): void {
    if (!this._config || !this.hass) return;
    if (this._config.clusterMarkers) {
      this._cluster?.update(this._config.entities, this.hass);
    } else {
      this._cluster?.removeAll();
    }
    this._resyncEntityMarkers();
  }

  /** Re-applies entity marker positions/visibility against the current
   * cluster state, without recomputing the cluster source itself — this is
   * the callback ClusterRenderService invokes on its own zoomend/moveend/
   * overlay-toggle events, so it must not loop back into updating the
   * cluster source again. */
  private _resyncEntityMarkers(): void {
    if (!this._config || !this.hass) return;
    this._entities?.update(this._config.entities, this.hass, this._cluster?.getHiddenEntityIds());
  }

  /** Runs once, the first time hass+config are both available after the map
   * is ready. Corrects the map to the right explicit/focus_entity center —
   * or fits all entities — even if hass wasn't available yet when _buildMap()
   * picked the constructor's initial (possibly [0,0]-fallback) center. */
  private _applyInitialViewIfNeeded(): void {
    if (this._initialViewApplied || !this._config || !this.hass || !this._map) return;
    this._initialViewApplied = true;
    this._applyInitialView();
  }

  /** Explicit x/y > focus_entity > fit all entities — the same resolution
   * _applyInitialViewIfNeeded() runs once automatically, exposed
   * unconditionally for the "Reset focus" map button (ports upstream
   * ha-map-card's mdi:image-filter-center-focus control). */
  private _applyInitialView(): void {
    if (!this._config || !this.hass || !this._map) return;
    const center = this._initialView.getInitialCenter(this._config, this.hass);
    if (center) {
      this._map.jumpTo({ center, zoom: this._config.zoom });
    } else {
      this._initialView.fitAllEntities(this._map as unknown as MapViewLike, this._config.entities, this.hass);
    }
  }

  /** Called from style.load (every reload, e.g. a theme swap) and, once, as
   * a startup catch-up from updated()'s hass branch if hass wasn't set yet
   * when the first style.load fired — see _historyCatchUpDone above. */
  private _refreshHistory(): void {
    if (!this._config || !this.hass || !this._history) return;
    this._historyCatchUpDone = true;
    const historyService = new HaHistoryService(this.hass);
    void this._historyManager
      .refresh(this._config.entities, this._config, (entityId, start, end) =>
        historyService.fetchPath(entityId, start, end),
      )
      .then((histories) => {
        this._history?.update(histories);
        // History overlays are registered as a side effect of update() —
        // re-render so the switcher (if enabled) picks up any new/removed
        // per-entity checkboxes.
        this.requestUpdate();
      });
  }

  private _fireMoreInfo(entityId: string): void {
    this.dispatchEvent(
      new CustomEvent("hass-more-info", {
        bubbles: true,
        composed: true,
        detail: { entityId },
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "nyxmap-card": NyxmapCard;
  }
}
