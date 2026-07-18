import { LitElement, html, unsafeCSS, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { MapConfig, type MapConfigRaw } from "../configs/MapConfig";
import { maplibreCss, maplibregl } from "../maplibre/MapLibreLoader";
import { StyleReattach } from "../maplibre/StyleReattach";
import { EntitiesRenderService, type MapLibreGlLike } from "../services/render/EntitiesRenderService";
import type { HomeAssistant } from "../types/home-assistant";
import { resolveStyle } from "../util/HaMapUtilities";
import { nyxmapCardStyles } from "./NyxmapCard.styles";

@customElement("nyxmap-card")
export class NyxmapCard extends LitElement {
  static override styles = [unsafeCSS(maplibreCss), nyxmapCardStyles];

  @property({ attribute: false }) hass?: HomeAssistant;
  @state() private _config?: MapConfig;

  private _map?: maplibregl.Map;
  private _built = false;
  private _ready = false;
  private _entities?: EntitiesRenderService;
  private readonly _reattach = new StyleReattach();

  setConfig(config: MapConfigRaw): void {
    this._config = new MapConfig(config);
    if (this._built && this._map) {
      this._map.setStyle(resolveStyle(this._config, this._prefersDark()));
    }
  }

  getCardSize(): number {
    return this._config?.cardSize ?? 5;
  }

  protected override updated(changed: PropertyValues): void {
    if (!this._built && this._config) {
      this._buildMap();
    }
    if (changed.has("hass") && this._ready && this._config && this.hass) {
      this._entities?.update(this._config.entities, this.hass);
    }
  }

  protected override render() {
    const height = this._config?.mapHeight ?? 250;
    return html`
      <ha-card .header=${this._config?.title}>
        <div class="nyxmap-container" style="height: ${height}px"></div>
      </ha-card>
    `;
  }

  private _prefersDark(): boolean {
    return matchMedia("(prefers-color-scheme: dark)").matches;
  }

  private _buildMap(): void {
    const config = this._config;
    const container = this.renderRoot.querySelector<HTMLDivElement>(".nyxmap-container");
    if (!config || !container) return;
    this._built = true;

    this._map = new maplibregl.Map({
      container,
      style: resolveStyle(config, this._prefersDark()),
      center: [config.x ?? 0, config.y ?? 0],
      zoom: config.zoom,
      attributionControl: { compact: true },
    });
    this._map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right");

    this._entities = new EntitiesRenderService(this._map, maplibregl as unknown as MapLibreGlLike, (entityId) =>
      this._fireMoreInfo(entityId),
    );

    // Fires on first load AND after every subsequent setStyle() (theme swap).
    this._map.on("style.load", () => {
      this._ready = true;
      this._reattach.replayAll(this._map!);
      if (this._config && this.hass) this._entities?.update(this._config.entities, this.hass);
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
