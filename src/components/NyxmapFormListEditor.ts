import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant } from "../types/home-assistant";
import type { HaFormSchema, HaFormValueChangedEvent } from "../types/ha-form";
import { nyxmapFormListEditorStyles } from "./NyxmapFormListEditor.styles";

/**
 * Generic, schema-driven array editor: one expandable `<ha-form>` row per
 * item, with add/remove/reorder controls. Reused for both `entities` and
 * `map_styles` in NyxmapCardEditor rather than writing a bespoke list UI for
 * each. Owns only its own expanded-row UI state (mirrors LayerSwitcherControl's
 * "dumb component" convention) but — unlike that component — reports intent
 * via a bubbling `items-changed` CustomEvent rather than a callback prop,
 * since its output must cross into NyxmapCardEditor and ultimately HA's own
 * card-editor dialog.
 */
@customElement("nyxmap-form-list-editor")
export class NyxmapFormListEditor<
  T extends Record<string, unknown> = Record<string, unknown>,
> extends LitElement {
  static override styles = nyxmapFormListEditorStyles;

  @property({ attribute: false }) hass?: HomeAssistant;
  @property({ attribute: false }) schema: HaFormSchema[] = [];
  @property({ attribute: false }) items: T[] = [];
  @property({ attribute: false }) computeRowSummary?: (item: T) => string;
  @property({ attribute: false }) computeLabel?: (schema: HaFormSchema) => string;
  @property({ attribute: false }) newItemDefaults?: () => Partial<T>;
  @property() addLabel = "Add item";

  @state() private _expandedIndex = -1;

  protected override render() {
    return html`
      ${this.items.map((item, i) => this._renderRow(item, i))}
      <button class="add" @click=${this._add}>+ ${this.addLabel}</button>
    `;
  }

  private _renderRow(item: T, i: number) {
    const expanded = this._expandedIndex === i;
    return html`
      <div class="row">
        <div class="row-header">
          <button
            class="expand"
            aria-expanded=${expanded}
            aria-label=${expanded ? "Collapse" : "Expand"}
            @click=${() => this._toggle(i)}
          >
            ${expanded ? "▾" : "▸"}
          </button>
          <span class="summary">${this.computeRowSummary?.(item) ?? `Item ${i + 1}`}</span>
          <button ?disabled=${i === 0} aria-label="Move up" @click=${() => this._move(i, -1)}>↑</button>
          <button
            ?disabled=${i === this.items.length - 1}
            aria-label="Move down"
            @click=${() => this._move(i, 1)}
          >
            ↓
          </button>
          <button aria-label="Remove" @click=${() => this._remove(i)}>🗑</button>
        </div>
        ${expanded
          ? html`<ha-form
              .hass=${this.hass}
              .schema=${this.schema}
              .data=${item}
              .computeLabel=${this.computeLabel}
              @value-changed=${(e: HaFormValueChangedEvent) => this._rowChanged(i, e)}
            ></ha-form>`
          : nothing}
      </div>
    `;
  }

  private _toggle(i: number): void {
    this._expandedIndex = this._expandedIndex === i ? -1 : i;
  }

  private _rowChanged(i: number, ev: HaFormValueChangedEvent): void {
    const next = [...this.items];
    next[i] = ev.detail.value as T;
    this._emit(next);
  }

  private _move(i: number, delta: number): void {
    const j = i + delta;
    if (j < 0 || j >= this.items.length) return;
    const next = [...this.items];
    [next[i], next[j]] = [next[j]!, next[i]!];
    if (this._expandedIndex === i) this._expandedIndex = j;
    else if (this._expandedIndex === j) this._expandedIndex = i;
    this._emit(next);
  }

  private _remove(i: number): void {
    const next = this.items.filter((_, idx) => idx !== i);
    if (this._expandedIndex === i) this._expandedIndex = -1;
    else if (this._expandedIndex > i) this._expandedIndex -= 1;
    this._emit(next);
  }

  private _add(): void {
    const next = [...this.items, (this.newItemDefaults?.() ?? {}) as T];
    this._expandedIndex = next.length - 1;
    this._emit(next);
  }

  private _emit(next: T[]): void {
    this.items = next;
    this.dispatchEvent(new CustomEvent("items-changed", { detail: { items: next }, bubbles: true, composed: true }));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "nyxmap-form-list-editor": NyxmapFormListEditor;
  }
}
