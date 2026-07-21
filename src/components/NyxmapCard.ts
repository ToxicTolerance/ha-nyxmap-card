import { LitElement, html, unsafeCSS, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { MapConfig, type MapConfigRaw, type ThemeMode } from "../configs/MapConfig";
import { buildStubConfig } from "../editor/CardFormSchema";
import { EntityHistoryManager } from "../models/EntityHistoryManager";
import { IconButtonControl } from "../maplibre/IconButtonControl";
import { maplibreCss, maplibregl } from "../maplibre/MapLibreLoader";
import { PluginHost } from "../maplibre/PluginHost";
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
import { isColorDark, resolveStylePair, resolveThemeMode } from "../util/HaMapUtilities";
import "./LayerSwitcherControl";
import type { SwitcherBaseStyleItem, SwitcherOverlayItem } from "./LayerSwitcherControl";
import { nyxmapCardStyles } from "./NyxmapCard.styles";

// SVG path data for the two map buttons, rendered inline by IconButtonControl
// (not via ha-icon) so they show in every context — see IconButtonControl.
// mdi:image-filter-center-focus and mdi:group respectively.
const ICON_RESET_FOCUS =
  "M12,9A3,3 0 0,0 9,12A3,3 0 0,0 12,15A3,3 0 0,0 15,12A3,3 0 0,0 12,9M19,19H15V21H19A2,2 0 0,0 21,19V15H19M19,3H15V5H19V9H21V5A2,2 0 0,0 19,3M5,5H9V3H5A2,2 0 0,0 3,5V9H5M5,15H3V19A2,2 0 0,0 5,21H9V19H5V15Z";
const ICON_TOGGLE_GROUPING =
  "M1,1V5H2V19H1V23H5V22H19V23H23V19H22V5H23V1H19V2H5V1M5,4H19V5H20V19H19V20H5V19H4V5H5M6,6V14H9V18H18V9H14V6M8,8H12V12H8M14,11H16V16H11V14H14";

/** How often a card with history configured re-fetches its trails. History
 * used to be fetched exactly once per style load, so a long-lived dashboard
 * (`history_start: "5 hours ago"` on a wall panel) showed a trail frozen at
 * page-load time whose window drifted further out of date all day. A minute
 * is well under the resolution of any usable trail while staying far cheaper
 * than re-fetching per `hass` update — HA replaces the whole `hass` object on
 * every state change anywhere in the instance, which would mean many history
 * WebSocket round-trips per second. Not a config key: adding one means
 * touching MapConfig, which this change deliberately doesn't own. */
const HISTORY_REFRESH_MS = 60_000;

@customElement("nyxmap-card")
export class NyxmapCard extends LitElement {
  static override styles = [unsafeCSS(maplibreCss), nyxmapCardStyles];

  @property({ attribute: false }) hass?: HomeAssistant;
  @state() private _config?: MapConfig;
  /** Layer switcher's base-style radio selection; undefined means "no
   * manual override, follow theme_mode" — the default behavior. */
  @state() private _manualStyleId?: string;
  /** Layer switcher's own Auto/Light/Dark override (shown only alongside
   * map_styles — see showThemeToggle); undefined means "no manual override,
   * follow the configured theme_mode". Independent of _manualStyleId: which
   * named style is active and which of its own light/dark variants to show
   * are two different questions. */
  @state() private _manualThemeMode?: ThemeMode;

  private _map?: maplibregl.Map;
  private _built = false;
  private _ready = false;
  private _entities?: EntitiesRenderService;
  private _history?: HistoryRenderService;
  private _circles?: CircleRenderService;
  private _geojson?: GeoJsonRenderService;
  private _cluster?: ClusterRenderService;
  private _tileLayers?: TileLayersRenderService;
  private _pluginHost?: PluginHost;
  private _clusterToggleControl?: IconButtonControl;
  private _initialViewApplied = false;
  private _historyCatchUpDone = false;
  /** Repeating history re-fetch — see HISTORY_REFRESH_MS and
   * _syncHistoryTimer(). Cleared in _teardown(). */
  private _historyTimer?: ReturnType<typeof setInterval>;
  /** Monotonic token identifying the newest in-flight history request. A
   * response whose token no longer matches is discarded: it either raced a
   * newer request or landed after teardown/a style swap, and applying it would
   * call addSource() on a style that has since been replaced. */
  private _historyGeneration = 0;
  private _historyInFlight = false;
  private _resizeObserver?: ResizeObserver;
  private _resizeRaf?: number;
  /** Pending deferred teardown — see disconnectedCallback(). */
  private _teardownTimer?: ReturnType<typeof setTimeout>;
  /** The style URL currently handed to the map. Compared against a freshly
   * resolved one so setConfig() can tell a real style swap (which will re-fire
   * "style.load", replaying everything) from a config edit that leaves the
   * style alone (which won't — see setConfig). */
  private _activeStyleUrl?: string;
  private readonly _reattach = new StyleReattach();
  private readonly _historyManager = new EntityHistoryManager();
  private readonly _initialView = new InitialViewRenderService();
  private readonly _layerRegistry = new LayerRegistry();
  private readonly _overlayVisibility = new Map<string, boolean>();

  setConfig(config: MapConfigRaw): void {
    this._config = new MapConfig(config);
    if (this._built && this._map) {
      // Before resolving the active style: _resolveActiveStyleUrl() looks up
      // _manualStyleId in the base-style registry, so a map_styles entry
      // added/edited in this same config update needs to already be synced
      // before that lookup runs, or a currently-selected entry falls back
      // silently to the card-level map_style/map_style_dark instead.
      this._syncBaseStyles();
      const url = this._resolveActiveStyleUrl();
      const styleChanged = url !== this._activeStyleUrl;
      this._applyStyle(url);
      // Called directly here too, not just from the style.load cycle:
      // MapLibre's setStyle() doesn't reliably re-fire "style.load" when the
      // resolved URL is unchanged from the currently active style (e.g.
      // toggling cluster_markers without also touching map_style), which
      // would otherwise leave the "Toggle grouping" button's presence stuck
      // until something else happened to trigger a reload.
      this._syncClusterToggleControl();
      // Same reasoning, for everything else the style.load cycle drives: with
      // no reload there is nothing to re-run the render services, so an edit
      // that doesn't touch the style (adding an entity, recolouring one,
      // editing tile_layers.url) wouldn't show up until the next unrelated
      // hass object arrived — never, in HA's "Edit card" preview pane, which
      // often holds a static hass. History is re-fetched too, since
      // history_start/entities may well be what changed.
      if (!styleChanged && this._ready && this.hass) {
        this._refreshOverlays();
        this._historyCatchUpDone = false;
        this._refreshHistory();
      }
    }
  }

  /** Single funnel for map.setStyle(). Clears _ready for the duration of a
   * real swap: setStyle() replaces the map's Style with a fresh, *unloaded*
   * one until the new JSON is fetched and parsed, and MapLibre's
   * Style.addSource() throws "Style is not done loading." while that's true.
   * Without this, a hass update landing mid-swap runs the render services
   * against the unloaded style and throws out of updated(). _ready is
   * restored by the "style.load" handler. */
  private _applyStyle(url: string): void {
    if (!this._map) return;
    if (url !== this._activeStyleUrl) this._ready = false;
    this._activeStyleUrl = url;
    this._map.setStyle(url);
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

  override connectedCallback(): void {
    super.connectedCallback();
    // Cancel a teardown scheduled by a *benign* disconnect (see below) — the
    // element came back, so the map it still owns stays valid.
    if (this._teardownTimer !== undefined) {
      clearTimeout(this._teardownTimer);
      this._teardownTimer = undefined;
    }
    if (this._built && this._map) {
      // disconnectedCallback() disconnects the observer; nothing else ever
      // re-observes, and _buildMap() (which created it) is guarded by _built
      // and never runs twice. Without this, a re-parent — HA's Sections/
      // masonry layouts do exactly that when a view is edited or reflowed —
      // permanently kills the card's resize handling: the canvas then stays
      // locked at its old pixel size through sidebar toggles and window
      // resizes until a full page reload.
      this._observeContainer();
      this._map.resize();
    } else if (this._config) {
      // Torn down while away — rebuild from updated().
      this.requestUpdate();
    }
  }

  /** Lit elements are disconnected on benign re-parenting too, so teardown is
   * deferred by a macrotask and cancelled from connectedCallback() if the
   * element comes back. On a real removal the map must be destroyed:
   * maplibregl.Map.remove() is what releases the WebGL context, terminates
   * the worker pool, drops MapLibre's own container ResizeObserver and
   * detaches its window/document listeners. Browsers cap simultaneous WebGL
   * contexts (~8–16), and HA's frontend is a long-lived tab that constructs a
   * fresh card per dashboard view — and per keystroke in the "Edit card"
   * preview — so leaking one Map per teardown blanks previously-working maps
   * once the cap is hit. */
  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._resizeObserver?.disconnect();
    if (this._resizeRaf !== undefined) {
      cancelAnimationFrame(this._resizeRaf);
      this._resizeRaf = undefined;
    }
    if (this._teardownTimer === undefined) {
      this._teardownTimer = setTimeout(() => this._teardown(), 0);
    }
  }

  private _teardown(): void {
    this._teardownTimer = undefined;
    if (this.isConnected) return;
    // Stop the history poll and invalidate anything already in flight before
    // the map goes away — a late response would otherwise call addSource() on
    // a destroyed map.
    if (this._historyTimer !== undefined) {
      clearInterval(this._historyTimer);
      this._historyTimer = undefined;
    }
    this._historyGeneration++;
    this._historyInFlight = false;
    this._map?.remove();
    this._map = undefined;
    this._resizeObserver = undefined;
    // Everything below is bound to the destroyed map, so it must not be
    // reused by a later rebuild: the render services hold it directly, the
    // reattach factories close over it, the registered overlays' setVisible()
    // targets its layer ids, and the control instances are already attached
    // to it. _buildMap() recreates all of them.
    this._entities = undefined;
    this._history = undefined;
    this._circles = undefined;
    this._geojson = undefined;
    this._cluster = undefined;
    this._tileLayers = undefined;
    this._pluginHost = undefined;
    this._clusterToggleControl = undefined;
    this._reattach.clear();
    for (const id of [...this._layerRegistry.getOverlays().keys()]) {
      this._layerRegistry.unregister(id);
    }
    this._built = false;
    this._ready = false;
    this._activeStyleUrl = undefined;
    this._initialViewApplied = false;
    this._historyCatchUpDone = false;
  }

  /** Idempotent: ResizeObserver.observe() on an already-observed element is a
   * no-op, so this is safe to call from both _buildMap() and every reconnect. */
  private _observeContainer(): void {
    const container = this.renderRoot?.querySelector<HTMLDivElement>(".nyxmap-container");
    if (!container) return;
    this._resizeObserver ??= new ResizeObserver(() => this._scheduleResize());
    this._resizeObserver.observe(container);
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
    // Flag a dark control background so the map controls (MapLibre's own
    // NavigationControl in particular, whose baked icons are dark) get their
    // light-on-dark treatment — see NyxmapCard.styles.ts. Keyed off the actual
    // resolved --card-background-color (HA's theme) rather than the map's
    // light/dark style, so the controls always match the surface they sit on.
    this.toggleAttribute(
      "data-dark",
      isColorDark(getComputedStyle(this).getPropertyValue("--card-background-color")),
    );

    const usesCssLengthHeight = typeof this._config?.height === "string";
    this.style.height = usesCssLengthHeight ? "100%" : "";
    // A percentage/CSS-length height only resolves against an ancestor that
    // itself has a real resolved height — fine in a Panel view, but HA's own
    // "Edit card" dialog gives its preview pane no explicit height (it sizes
    // to its content instead), so height:100% collapses the whole chain
    // (:host → ha-card → .nyxmap-viewport) down to 0 and the map area
    // renders with zero size: no error, just a blank card. This floor keeps
    // the preview visible without capping a real Panel view, which already
    // provides a taller real height that this minimum sits well under.
    this.style.minHeight = usesCssLengthHeight ? "200px" : "";

    if (!this._built && this._config) {
      this._buildMap();
    }
    if (changed.has("hass") && this._ready && this._config && this.hass) {
      this._refreshOverlays();
      this._applyInitialViewIfNeeded();
      this._initialView.updateFit(
        this._map as unknown as MapViewLike,
        this._config.entities,
        this.hass,
        this._config.focusFollow,
        this._config.zoom,
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
                  .showThemeToggle=${(this._config.mapStyles.length ?? 0) > 0}
                  .themeMode=${this._effectiveThemeMode()}
                  .onSelectThemeMode=${(mode: ThemeMode) => this._onSelectThemeMode(mode)}
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

  /** The layer switcher's own Theme control (Auto/Light/Dark, shown
   * alongside map_styles) overrides the static config value at runtime,
   * the same way _manualStyleId overrides which base style is active —
   * neither mutates the underlying config. */
  private _effectiveThemeMode(): ThemeMode {
    return this._manualThemeMode ?? this._config?.themeMode ?? "auto";
  }

  /** Manual switcher selection (if any) takes precedence over the automatic
   * theme_mode resolution — see LayerRegistry.BaseStyleEntry: each entry is
   * still a light/dark pair, so a genuinely dual-variant custom style keeps
   * responding to the effective theme mode even while "selected". */
  private _resolveActiveStyleUrl(): string {
    const themeMode = this._effectiveThemeMode();
    if (this._manualStyleId && this._config) {
      const entry = this._layerRegistry.getBaseStyles().get(this._manualStyleId);
      if (entry) return resolveStylePair(entry, themeMode, this._prefersDark());
    }
    return resolveStylePair(this._config!, themeMode, this._prefersDark());
  }

  private _defaultBaseStyleId(): "light" | "dark" {
    if (!this._config) return "light";
    return resolveThemeMode(this._effectiveThemeMode(), this._prefersDark()) === "dark" ? "dark" : "light";
  }

  /** Handles the layer switcher's own Theme (Auto/Light/Dark) control —
   * independent of _onSelectBaseStyle: which named style is active and
   * which of its own light/dark variants to show are different questions. */
  private _onSelectThemeMode(mode: ThemeMode): void {
    this._manualThemeMode = mode;
    if (!this._map || !this._config) return;
    this._applyStyle(this._resolveActiveStyleUrl());
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
    this._applyStyle(this._resolveActiveStyleUrl());
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

  /** Registers/updates the layer switcher's base-style radio options from
   * the current config, and unregisters any previously-registered entry no
   * longer present — called from both _buildMap() (initial seeding) and
   * setConfig() (so editing map_styles later, e.g. via the dashboard's
   * visual editor, without a full page reload actually takes effect).
   * Previously this only ran once at build time: selecting a map_styles
   * entry added or edited afterward silently fell back to the resolved
   * card-level map_style/map_style_dark instead of the entry's own style —
   * indistinguishable from "that style is just broken" unless you knew to
   * check for a stale registry. registerBaseStyle()/unregister() are
   * idempotent Map operations, so re-running this on every config change is
   * safe even when nothing actually changed. */
  private _syncBaseStyles(): void {
    if (!this._config) return;
    const config = this._config;
    const seen = new Set<string>();

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
      seen.add("light");
      seen.add("dark");
    }
    for (const s of config.mapStyles) {
      const id = `custom:${s.name}`;
      this._layerRegistry.registerBaseStyle(id, {
        label: s.name,
        styleLight: s.styleLight,
        styleDark: s.styleDark,
        maxZoom: s.maxZoom,
        minZoom: s.minZoom,
      });
      seen.add(id);
    }

    for (const id of [...this._layerRegistry.getBaseStyles().keys()]) {
      if (!seen.has(id)) this._layerRegistry.unregister(id);
    }
  }

  private _buildMap(): void {
    const config = this._config;
    const container = this.renderRoot.querySelector<HTMLDivElement>(".nyxmap-container");
    if (!config || !container) return;
    this._built = true;

    this._syncBaseStyles();

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
    this._activeStyleUrl = this._resolveActiveStyleUrl();
    this._map = new maplibregl.Map({
      container,
      style: this._activeStyleUrl,
      center: initialCenter,
      zoom: config.zoom,
      maxZoom: initialEntry?.maxZoom ?? config.maxZoom,
      minZoom: initialEntry?.minZoom ?? config.minZoom,
      attributionControl: { compact: true },
    });
    this._map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right");

    // Ports upstream ha-map-card's "Reset focus" map button — always
    // present, re-runs the same initial-view resolution _applyInitialView()
    // already uses (explicit x/y > focus_entity > fit all entities). Added to
    // top-right *after* NavigationControl so it stacks directly beneath the
    // zoom/compass buttons; the layer switcher's toggle stacks beneath this
    // column (it measures against it), and attribution sits bottom-right.
    this._map.addControl(
      new IconButtonControl({
        iconPath: ICON_RESET_FOCUS,
        label: "Reset focus",
        onClick: () => this._applyInitialView(),
      }),
      "top-right",
    );
    // "Toggle grouping" itself is added/removed by _syncClusterToggleControl()
    // (called from _updateEntitiesAndClusters(), i.e. every style.load and
    // hass update) rather than fixed here — cluster_markers can change on a
    // later setConfig() without this element ever getting rebuilt (_buildMap
    // only runs once), so its presence has to be able to react too, not just
    // reflect whatever the very first build saw.

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
    this._observeContainer();
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
      maplibregl as unknown as MapLibreGlLike,
      this._layerRegistry,
      () => this._resyncEntityMarkers(),
    );
    this._tileLayers = new TileLayersRenderService(
      this._map as unknown as TileLayersMapLike,
      this._reattach,
      this._layerRegistry,
    );

    // JS plugin hook — hands third-party MapLibre plugins the live map + the
    // bundled maplibregl. Only its setup pass runs (once, from the first
    // style.load below); any overlays it registers go through _reattach and
    // _layerRegistry like every internal one, so they survive theme swaps and
    // appear in the switcher. Gated by the `plugins` kill-switch.
    if (config.plugins) {
      this._pluginHost = new PluginHost({
        map: this._map,
        maplibregl,
        card: this,
        layerRegistry: this._layerRegistry,
        reattach: this._reattach,
        getHass: () => this.hass,
        getConfig: () => this._config,
      });
    }

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
      // Collapse now (best effort) and again once the map settles: MapLibre
      // re-expands the compact attribution when this style's attribution text
      // populates, which happens asynchronously *after* style.load (on
      // sourcedata), so a single collapse here would be undone. once("idle")
      // fires after tiles + attribution have settled, when the collapse sticks;
      // it's re-registered on every style.load so theme swaps stay collapsed too.
      this._collapseAttribution();
      this._map!.once("idle", () => this._collapseAttribution());
      this._reattach.replayAll(this._map!);
      // Run the plugin setup pass once, now that the style is loaded (so a
      // plugin's registerOverlay can addSource/addLayer immediately). Its own
      // overlays register with _reattach above, so later theme swaps replay
      // them without setup running again (activate() is idempotent).
      this._pluginHost?.activate();
      if (this._config && this.hass) {
        this._refreshOverlays();
        this._refreshHistory();
        this._applyInitialViewIfNeeded();
      }
    });
  }

  /** Re-runs every source/layer-backed render service against the current
   * config + hass. Called from all three paths that can invalidate them: the
   * "style.load" handler (first load and every theme/style swap, where this
   * is also the very first addLayer() and so seeds StyleReattach's replay
   * order), updated()'s hass branch, and setConfig() when the style URL
   * didn't change.
   *
   * tile_layers/wms go first: MapLibre stacks layers in add order (later
   * added = drawn on top), and raster overlays are documented as sitting "on
   * top of the vector base style" — but not on top of our own entity
   * overlays. Adding them before circles/geojson/clusters means those
   * overlays' first-ever addLayer() call (which is what actually fixes
   * z-order; setData()/setTiles() on an already-created layer doesn't move
   * it) lands after the raster layer, keeping markers/shapes visible above it
   * instead of hidden underneath. */
  private _refreshOverlays(): void {
    if (!this._config || !this.hass) return;
    this._tileLayers?.update(this._config.tileLayers, this._config.wms, this.hass);
    // _updateEntitiesAndClusters() → _resyncEntityMarkers() refreshes circles
    // too (with the current absorbed set), so no separate circle update here.
    this._updateEntitiesAndClusters();
    this._geojson?.update(this._config.entities, this.hass);
  }

  /** Starts the compact attribution control collapsed (just the ⓘ button)
   * instead of expanded. MapLibre's own _updateCompact() adds both
   * `maplibregl-compact` and `maplibregl-compact-show` on init, so it renders
   * open until the first map drag minimizes it; dropping `-show` here collapses
   * it up front. Safe against resize (that only re-adds `-show` when the
   * `-compact` class is absent, which it never is once set) and re-applied on
   * every style.load so a theme swap doesn't re-expand it. */
  private _collapseAttribution(): void {
    const attrib = this.renderRoot.querySelector(".maplibregl-ctrl-attrib");
    attrib?.classList.remove("maplibregl-compact-show");
    attrib?.removeAttribute("open");
  }

  /** Feeds ClusterRenderService (or tears it down when cluster_markers is
   * off, so no empty source/overlay lingers) and then resyncs entity markers
   * against whatever it now considers clustered. Called from both updated()'s
   * hass branch and the "style.load" handler, same as every other service. */
  private _updateEntitiesAndClusters(): void {
    if (!this._config || !this.hass) return;
    this._syncClusterToggleControl();
    if (this._config.clusterMarkers) {
      this._cluster?.update(this._config.entities, this.hass, {
        maxZoom: this._config.clusterMaxZoom,
      });
    } else {
      this._cluster?.removeAll();
    }
    this._resyncEntityMarkers();
  }

  /** Adds/removes the "Toggle grouping" map button to match the current
   * cluster_markers config — cluster_markers can flip on a later
   * setConfig() without the card element itself ever getting rebuilt
   * (_buildMap() only runs once), so the button's presence has to be able
   * to react on every update rather than being decided once at build time. */
  private _syncClusterToggleControl(): void {
    if (!this._config || !this._map) return;
    if (this._config.clusterMarkers && !this._clusterToggleControl) {
      this._clusterToggleControl = new IconButtonControl({
        iconPath: ICON_TOGGLE_GROUPING,
        label: "Toggle grouping",
        onClick: () => this._onToggleOverlay("entity-clusters"),
        isPressed: () => this._overlayVisibility.get("entity-clusters") ?? true,
      });
      // top-right so it stacks under NavigationControl + the Reset focus
      // button (see _buildMap()).
      this._map.addControl(this._clusterToggleControl, "top-right");
    } else if (!this._config.clusterMarkers && this._clusterToggleControl) {
      this._map.removeControl(this._clusterToggleControl);
      this._clusterToggleControl = undefined;
    }
  }

  /** Re-applies entity markers AND accuracy circles against the current
   * cluster state, without recomputing the cluster source itself — this is
   * the callback ClusterRenderService invokes on its own zoomend/moveend/
   * overlay-toggle events, so it must not loop back into updating the
   * cluster source again. Circles are refreshed here too so an entity absorbed
   * into a bubble on zoom loses its circle at the same moment its marker hides
   * (absorption changes on camera settle, not on a hass update). */
  private _resyncEntityMarkers(): void {
    if (!this._config || !this.hass) return;
    this._entities?.update(this._config.entities, this.hass, this._cluster?.getAbsorbed());
    this._refreshCircles();
  }

  /** Draws accuracy circles for every entity except those currently absorbed
   * into a cluster bubble (whose markers — and thus circles — are hidden). */
  private _refreshCircles(): void {
    if (!this._config || !this.hass) return;
    this._circles?.update(
      this._config.entities,
      this.hass,
      this._config.showAccuracyCircles,
      this._cluster?.getAbsorbed(),
    );
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
      this._initialView.fitAllEntities(
        this._map as unknown as MapViewLike,
        this._config.entities,
        this.hass,
        this._config.zoom,
      );
    }
  }

  /** Called from style.load (every reload, e.g. a theme swap), from setConfig()
   * when the style URL didn't change, once as a startup catch-up from
   * updated()'s hass branch if hass wasn't set yet when the first style.load
   * fired (see _historyCatchUpDone), and from the HISTORY_REFRESH_MS poll it
   * installs here.
   *
   * Two guards, both of which the audit's fix for the "fetched once, never
   * refreshed" defect depends on:
   * - `_historyInFlight` stops the poll (or a burst of catch-up calls) from
   *   stacking overlapping WebSocket round-trips;
   * - `_historyGeneration` discards a response that is no longer the newest,
   *   which also covers the two ordering hazards this promise chain has always
   *   had: a response landing mid-`setStyle()` (its `_history.update()` would
   *   call addSource() on an unloaded style, which MapLibre throws on) and one
   *   landing after teardown.
   * The chain now also terminates in a `.catch` — it previously had none, so
   * any rejection surfaced only as an unhandled-rejection warning. */
  private _refreshHistory(): void {
    if (!this._config || !this.hass || !this._history) return;
    this._syncHistoryTimer();
    if (this._historyInFlight) return;
    this._historyInFlight = true;
    const generation = ++this._historyGeneration;
    const historyService = new HaHistoryService(this.hass);
    void this._historyManager
      .refresh(this._config.entities, this._config, (entityId, start, end) =>
        historyService.fetchPath(entityId, start, end),
      )
      .then((histories) => {
        if (generation !== this._historyGeneration || !this._ready) return;
        this._history?.update(histories);
        // History overlays are registered as a side effect of update() —
        // re-render so the switcher (if enabled) picks up any new/removed
        // per-entity checkboxes.
        this.requestUpdate();
      })
      .catch((err: unknown) => {
        console.warn("[nyxmap] history refresh failed", err);
      })
      .finally(() => {
        if (generation !== this._historyGeneration) return;
        this._historyInFlight = false;
        // Latched on *settle*, not before awaiting: latching it up front meant
        // a first fetch that failed could never be retried by the catch-up
        // path. (The poll below is the real retry mechanism; this just stops
        // the catch-up from re-firing on every subsequent hass object.)
        this._historyCatchUpDone = true;
      });
  }

  /** Starts/stops the periodic re-fetch to match the current config, so a card
   * with no `history_start` anywhere never installs a timer at all. */
  private _syncHistoryTimer(): void {
    const wanted = this._hasHistoryConfigured();
    if (wanted && this._historyTimer === undefined) {
      this._historyTimer = setInterval(() => this._refreshHistory(), HISTORY_REFRESH_MS);
    } else if (!wanted && this._historyTimer !== undefined) {
      clearInterval(this._historyTimer);
      this._historyTimer = undefined;
    }
  }

  /** Mirrors EntityHistoryManager's own opt-in rule: an entity has history
   * only if it (or the card) supplies a history_start. */
  private _hasHistoryConfigured(): boolean {
    if (!this._config) return false;
    if (this._config.historyStart) return this._config.entities.length > 0;
    return this._config.entities.some((e) => e.historyStart);
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
