import { LitElement, html, svg } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ThemeMode } from "../configs/MapConfig";
import { layerSwitcherStyles } from "./LayerSwitcherControl.styles";
import {
  computeMaxPanelHeight,
  computeSwitcherOffsets,
  groupOverlays,
  SWITCHER_INSET_PX,
} from "./LayerSwitcherLayout";

// mdi:layers — inline (not ha-icon) so the button icon renders everywhere,
// including the dev harness and any context without HA's ha-icon element.
const LAYERS_ICON = svg`<svg viewBox="0 0 24 24" aria-hidden="true">
  <path fill="currentColor" d="M12,16L19.36,10.27L21,9L12,2L3,9L4.63,10.27M12,18.54L4.62,12.81L3,14.07L12,21.07L21,14.07L19.37,12.8L12,18.54Z" />
</svg>`;

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
  /** Caps the panel to the space below the toggle within the map area, so a
   * tall panel on a short map scrolls internally instead of overflowing (and
   * being clipped by ha-card's overflow:hidden). Measured when opening. */
  @state() private _maxPanelHeight = 260;
  /** Vertical offset of the toggle from the top of the map area, equal to the
   * bottom of MapLibre's top-right control column so the switcher sits just
   * beneath it. Re-measured on resize and whenever that column's height might
   * have changed (e.g. the Toggle grouping button appearing/disappearing). */
  private _topOffset = SWITCHER_INSET_PX;
  private _rightOffset = SWITCHER_INSET_PX;
  private _resizeObserver?: ResizeObserver;

  override firstUpdated(): void {
    this._observeParent();
  }

  /**
   * Re-arms everything `disconnectedCallback()` tore down. HA's Sections and
   * masonry layouts re-parent cards on a dashboard edit, which fires
   * disconnect → connect on the *same* element: without this the resize
   * observer stayed dead and, if the panel had been left open, `_open` was
   * still true but the outside-pointerdown listener was gone, so tapping the
   * map could no longer close the panel for the life of the page. NyxmapCard
   * already re-observes its own container on reconnect; this is the same fix.
   */
  override connectedCallback(): void {
    super.connectedCallback();
    // firstUpdated() covers the initial mount; on a reconnect the element has
    // already rendered once, so re-observe here instead.
    if (this.hasUpdated) this._observeParent();
    if (this._open) window.addEventListener("pointerdown", this._onOutsidePointerDown, true);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._resizeObserver?.disconnect();
    this._resizeObserver = undefined;
    window.removeEventListener("pointerdown", this._onOutsidePointerDown, true);
  }

  private _observeParent(): void {
    this._measure();
    const parent = this.offsetParent as HTMLElement | null;
    if (!parent || this._resizeObserver) return;
    this._resizeObserver = new ResizeObserver(() => this._measure());
    this._resizeObserver.observe(parent);
  }

  protected override updated(): void {
    // The control column's height can change without a resize (the Toggle
    // grouping button is added/removed with cluster state, which also changes
    // this component's own props → an update) — re-measure so we re-stack.
    this._measure();
  }

  /** Reads the rendered rects and hands them to the DOM-free math in
   * LayerSwitcherLayout, which is where the reasoning about *why* these
   * particular edges lives. */
  private _measure(): void {
    const parent = this.offsetParent as HTMLElement | null;
    if (!parent) return;
    const column = parent.querySelector(".maplibregl-ctrl-top-right");
    const ctrl = column?.querySelector(".maplibregl-ctrl");
    const { top, right } = computeSwitcherOffsets(
      parent.getBoundingClientRect(),
      column?.getBoundingClientRect() ?? null,
      ctrl?.getBoundingClientRect() ?? null,
    );
    if (top !== this._topOffset || right !== this._rightOffset) {
      this._topOffset = top;
      this._rightOffset = right;
      this.style.top = `${top}px`;
      this.style.right = `${right}px`;
    }
  }

  /** Closes the panel when a pointer goes down anywhere outside this control —
   * e.g. tapping the map again. Capture phase so it runs before the map's own
   * handlers; composedPath() sees into this shadow root, so clicks on the
   * toggle/panel are correctly treated as "inside". */
  private _onOutsidePointerDown = (e: PointerEvent): void => {
    if (e.composedPath().includes(this)) return;
    this._setOpen(false);
  };

  private _setOpen(open: boolean): void {
    if (open === this._open) return;
    this._open = open;
    if (open) {
      const parent = this.offsetParent as HTMLElement | null;
      if (parent) this._maxPanelHeight = computeMaxPanelHeight(parent.clientHeight, this._topOffset);
      window.addEventListener("pointerdown", this._onOutsidePointerDown, true);
    } else {
      window.removeEventListener("pointerdown", this._onOutsidePointerDown, true);
    }
  }

  protected override render() {
    return html`
      <button
        class="toggle"
        aria-label="Map layers"
        aria-expanded=${this._open}
        @click=${() => this._setOpen(!this._open)}
      >
        ${LAYERS_ICON}
      </button>
      ${this._open ? this._renderPanel() : null}
    `;
  }

  private _renderPanel() {
    return html`
      <div class="panel">
        <div class="panel-scroll" style="max-height: ${this._maxPanelHeight}px">
        ${this.baseStyles.length
          ? html`
              <div class="group">
                <div class="group-label">Map type</div>
                <div class="cards">
                  ${this.baseStyles.map(
                    (s) => html`
                      <label class="card ${s.active ? "card--active" : ""}">
                        <input
                          type="radio"
                          name="nyxmap-base-style"
                          .checked=${s.active}
                          @change=${() => this.onSelectBaseStyle?.(s.id)}
                        />
                        <span class="card-icon">${LAYERS_ICON}</span>
                        <span class="card-label">${s.label}</span>
                      </label>
                    `,
                  )}
                </div>
              </div>
            `
          : null}
        ${this.showThemeToggle
          ? html`
              <div class="group">
                <div class="group-label">Theme</div>
                <div class="segmented">
                  ${THEME_MODE_OPTIONS.map(
                    (o) => html`
                      <label class="seg ${this.themeMode === o.mode ? "seg--active" : ""}">
                        <input
                          type="radio"
                          name="nyxmap-theme-mode"
                          .checked=${this.themeMode === o.mode}
                          @change=${() => this.onSelectThemeMode?.(o.mode)}
                        />${o.label}
                      </label>
                    `,
                  )}
                </div>
              </div>
            `
          : null}
        ${groupOverlays(this.overlays).map(
          (group) => html`
            <div class="group">
              <div class="group-label">${group.label}</div>
              ${group.items.map(
                (o) => html`
                  <label class="overlay-row">
                    <span class="overlay-label">${o.label}</span>
                    <input
                      type="checkbox"
                      .checked=${o.active}
                      @change=${() => this.onToggleOverlay?.(o.id)}
                    /><span class="switch"></span>
                  </label>
                `,
              )}
            </div>
          `,
        )}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "nyxmap-layer-switcher": LayerSwitcherControl;
  }
}
