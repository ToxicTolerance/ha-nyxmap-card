import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ThemeMode } from "../configs/MapConfig";
import { layerSwitcherStyles } from "./LayerSwitcherControl.styles";

export interface SwitcherBaseStyleItem {
  id: string;
  label: string;
  active: boolean;
}

export interface SwitcherOverlayItem {
  id: string;
  label: string;
  group?: string;
  active: boolean;
}

const THEME_MODE_OPTIONS: Array<{ mode: ThemeMode; label: string }> = [
  { mode: "auto", label: "Auto" },
  { mode: "light", label: "Light" },
  { mode: "dark", label: "Dark" },
];

/**
 * Dumb/presentational: reflects whatever NyxmapCard passes in and reports
 * user intent back via the callback properties. All actual base-style
 * switching / overlay visibility / theme-mode state lives in NyxmapCard +
 * LayerRegistry — this component owns nothing but its own open/closed state.
 */
@customElement("nyxmap-layer-switcher")
export class LayerSwitcherControl extends LitElement {
  static override styles = layerSwitcherStyles;

  @property({ attribute: false }) baseStyles: SwitcherBaseStyleItem[] = [];
  @property({ attribute: false }) overlays: SwitcherOverlayItem[] = [];
  @property({ attribute: false }) onSelectBaseStyle?: (id: string) => void;
  @property({ attribute: false }) onToggleOverlay?: (id: string) => void;
  /** Shown only when map_styles is configured — without it, the generic
   * "Light"/"Dark" entries in baseStyles already cover this same choice, so
   * a separate control here would just duplicate them. See NyxmapCard's own
   * showThemeToggle wiring. */
  @property({ attribute: false }) showThemeToggle = false;
  @property({ attribute: false }) themeMode?: ThemeMode;
  @property({ attribute: false }) onSelectThemeMode?: (mode: ThemeMode) => void;

  @state() private _open = false;

  protected override render() {
    return html`
      <button
        class="toggle"
        aria-label="Map layers"
        aria-expanded=${this._open}
        @click=${() => (this._open = !this._open)}
      >
        🗂
      </button>
      ${this._open ? this._renderPanel() : null}
    `;
  }

  private _renderPanel() {
    return html`
      <div class="panel">
        ${this.baseStyles.length
          ? html`
              <div class="group">
                <div class="group-label">Base map</div>
                ${this.baseStyles.map(
                  (s) => html`
                    <label>
                      <input
                        type="radio"
                        name="nyxmap-base-style"
                        .checked=${s.active}
                        @change=${() => this.onSelectBaseStyle?.(s.id)}
                      />
                      ${s.label}
                    </label>
                  `,
                )}
              </div>
            `
          : null}
        ${this.showThemeToggle
          ? html`
              <div class="group">
                <div class="group-label">Theme</div>
                ${THEME_MODE_OPTIONS.map(
                  (o) => html`
                    <label>
                      <input
                        type="radio"
                        name="nyxmap-theme-mode"
                        .checked=${this.themeMode === o.mode}
                        @change=${() => this.onSelectThemeMode?.(o.mode)}
                      />
                      ${o.label}
                    </label>
                  `,
                )}
              </div>
            `
          : null}
        ${this.overlays.length
          ? html`
              <div class="group">
                <div class="group-label">Overlays</div>
                ${this.overlays.map(
                  (o) => html`
                    <label>
                      <input
                        type="checkbox"
                        .checked=${o.active}
                        @change=${() => this.onToggleOverlay?.(o.id)}
                      />
                      ${o.label}
                    </label>
                  `,
                )}
              </div>
            `
          : null}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "nyxmap-layer-switcher": LayerSwitcherControl;
  }
}
