/**
 * Entry point / Lovelace registration for the nyxmap-card custom element.
 * Phase 0 scaffold stub — real config parsing and MapLibre rendering land in Phase 1.
 */
export {};

class NyxmapCard extends HTMLElement {
  private _config?: Record<string, unknown>;

  setConfig(config: Record<string, unknown>): void {
    if (!config) throw new Error("Missing configuration");
    this._config = config;
    this._render();
  }

  set hass(_hass: unknown) {
    // Phase 1: drives entity marker/history updates.
  }

  getCardSize(): number {
    return (this._config?.card_size as number) ?? 5;
  }

  private _render(): void {
    this.innerHTML = `<ha-card header="${this._config?.title ?? "NyxMap"}">
      <div style="padding: 16px;">nyxmap-card scaffold — MapLibre rendering lands in Phase 1.</div>
    </ha-card>`;
  }
}

customElements.define("nyxmap-card", NyxmapCard);

declare global {
  interface Window {
    customCards?: Array<Record<string, unknown>>;
  }
}

window.customCards = window.customCards ?? [];
window.customCards.push({
  type: "nyxmap-card",
  name: "NyxMap Card",
  description: "MapLibre GL vector-tile map card for Home Assistant",
});
