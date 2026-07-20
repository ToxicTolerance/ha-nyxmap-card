import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { EntityConfigRaw } from "../configs/EntityConfig";
import type { MapConfigRaw, MapStyleRaw } from "../configs/MapConfig";
import { buildCardSchema, cardConfigToFormData, formDataToCardConfig } from "../editor/CardFormSchema";
import { buildEntitySchema, entityRawToFormData, formDataToEntityRaw } from "../editor/EntityFormSchema";
import { buildMapStyleSchema } from "../editor/MapStyleFormSchema";
import type { HaFormSchema, HaFormValueChangedEvent } from "../types/ha-form";
import type { HomeAssistant } from "../types/home-assistant";
import "./NyxmapFormListEditor";
import { nyxmapCardEditorStyles } from "./NyxmapCardEditor.styles";

/** There's no `hass.localize()` entry for any of our custom config keys, so
 * labels are just a local lookup table; falls back to the raw key name for
 * anything not listed here. */
const LABELS: Record<string, string> = {
  title: "Title",
  x: "Longitude",
  y: "Latitude",
  zoom: "Zoom",
  max_zoom: "Max zoom",
  min_zoom: "Min zoom",
  theme_mode: "Theme mode",
  map_style: "Map style (light)",
  map_style_dark: "Map style (dark)",
  projection: "Projection",
  focus_entity: "Focus entity",
  focus_follow: "Focus behavior",
  layer_switcher: "Show layer switcher",
  history_start: "History start",
  history_end: "History end",
  history_show_lines: "Show history lines",
  history_show_dots: "Show history dots",
  cluster_markers: "Cluster markers",
  cluster_max_zoom: "Cluster max zoom",
  show_accuracy_circles: "Show accuracy circles",
  height: "Height",
  card_size: "Card size",
  entity: "Entity",
  display: "Display",
  picture: "Picture",
  icon: "Icon",
  label: "Label",
  color: "Color",
  size: "Size",
  fixed_x: "Fixed longitude",
  fixed_y: "Fixed latitude",
  z_index_offset: "Z-index offset",
  focus_on_fit: "Include when fitting map",
  history_line_color: "History line color",
  circle: "Show accuracy circle",
  name: "Name",
};

interface ItemsChangedEvent extends CustomEvent {
  detail: { items: Array<Record<string, unknown>> };
}

/**
 * `getConfigElement()` target for NyxmapCard. Covers all card-level MapConfig
 * fields plus a full entities-list editor; `circle`/`geojson`/`tile_layers`/
 * `wms` are intentionally left YAML-only (HA's own "Edit in YAML" toggle
 * covers them) — see CLAUDE.md for the rationale.
 */
@customElement("nyxmap-card-editor")
export class NyxmapCardEditor extends LitElement {
  static override styles = nyxmapCardEditorStyles;

  @property({ attribute: false }) hass?: HomeAssistant;
  @state() private _config?: MapConfigRaw;

  setConfig(config: MapConfigRaw): void {
    // Stored verbatim so `type` and any out-of-scope keys (circle, geojson,
    // tile_layers, wms) round-trip untouched through every edit.
    this._config = config;
  }

  protected override render() {
    if (!this._config) return nothing;
    return html`
      <ha-form
        .hass=${this.hass}
        .schema=${buildCardSchema()}
        .data=${cardConfigToFormData(this._config)}
        .computeLabel=${this._computeLabel}
        @value-changed=${this._cardFormChanged}
      ></ha-form>

      <h3>Entities</h3>
      <nyxmap-form-list-editor
        .hass=${this.hass}
        .schema=${buildEntitySchema()}
        .items=${(this._config.entities ?? []).map(entityRawToFormData)}
        .computeRowSummary=${(e: Record<string, unknown>) =>
          (e.label as string) || (e.entity as string) || "New entity"}
        .computeLabel=${this._computeLabel}
        .newItemDefaults=${() => ({ entity: "" })}
        addLabel="Add entity"
        @items-changed=${this._entitiesChanged}
      ></nyxmap-form-list-editor>

      <h3>Extra base map styles</h3>
      <nyxmap-form-list-editor
        .hass=${this.hass}
        .schema=${buildMapStyleSchema()}
        .items=${this._config.map_styles ?? []}
        .computeRowSummary=${(s: Record<string, unknown>) => (s.name as string) || "New style"}
        .computeLabel=${this._computeLabel}
        .newItemDefaults=${() => ({ name: "" })}
        addLabel="Add style"
        @items-changed=${this._mapStylesChanged}
      ></nyxmap-form-list-editor>
    `;
  }

  private _cardFormChanged = (ev: HaFormValueChangedEvent): void => {
    this._configChanged(formDataToCardConfig(ev.detail.value, this._config!));
  };

  /** Matches each edited row back to its previous raw entity by entity id
   * (not array position) so reordering rows in the list editor doesn't
   * cross-wire one entity's circle/geojson onto another entity that moved
   * into its old slot. */
  private _entitiesChanged = (ev: ItemsChangedEvent): void => {
    const previousByEntityId = new Map<string, string | EntityConfigRaw>();
    for (const raw of this._config!.entities ?? []) {
      const id = typeof raw === "string" ? raw : raw.entity;
      if (id) previousByEntityId.set(id, raw);
    }
    const entities = ev.detail.items.map((item) => {
      const id = item.entity as string | undefined;
      const previous = (id && previousByEntityId.get(id)) || { entity: id ?? "" };
      return formDataToEntityRaw(item, previous);
    });
    this._configChanged({ ...this._config!, entities });
  };

  private _mapStylesChanged = (ev: ItemsChangedEvent): void => {
    this._configChanged({ ...this._config!, map_styles: ev.detail.items as unknown as MapStyleRaw[] });
  };

  private _configChanged(config: MapConfigRaw): void {
    this._config = config;
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
  }

  private _computeLabel = (schema: HaFormSchema): string => LABELS[schema.name] ?? schema.name;
}

declare global {
  interface HTMLElementTagNameMap {
    "nyxmap-card-editor": NyxmapCardEditor;
  }
}
