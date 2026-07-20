import type { IControl } from "maplibre-gl";

export interface IconButtonControlOptions {
  /** MDI icon name, e.g. "mdi:image-filter-center-focus". */
  icon: string;
  /** Used as both the button's aria-label and its title tooltip. */
  label: string;
  onClick: () => void;
  /** When set, the button reflects a toggled/pressed visual state via
   * aria-pressed — call refresh() after the underlying state changes
   * elsewhere (e.g. the layer switcher's own checkbox) to keep it in sync. */
  isPressed?: () => boolean;
}

/**
 * A single MapLibre control button rendered in the same
 * `.maplibregl-ctrl-group` style as the built-in NavigationControl, so it
 * stacks naturally alongside it instead of needing its own hand-positioned
 * CSS (see LayerSwitcherControl.styles.ts for what that costs). Ports
 * upstream ha-map-card's "Reset focus"/"Toggle grouping" map buttons —
 * options.onClick/isPressed are exposed as a public field (not just closed
 * over) so tests can drive the same callback the button itself would.
 */
export class IconButtonControl implements IControl {
  readonly options: IconButtonControlOptions;
  private _container?: HTMLDivElement;
  private _button?: HTMLButtonElement;

  constructor(options: IconButtonControlOptions) {
    this.options = options;
  }

  onAdd(): HTMLElement {
    this._container = document.createElement("div");
    this._container.className = "maplibregl-ctrl maplibregl-ctrl-group";

    this._button = document.createElement("button");
    this._button.type = "button";
    this._button.className = "nyxmap-ctrl-button";
    this._button.setAttribute("aria-label", this.options.label);
    this._button.title = this.options.label;
    this._button.addEventListener("click", () => this.options.onClick());

    const icon = document.createElement("ha-icon");
    icon.setAttribute("icon", this.options.icon);
    this._button.appendChild(icon);

    this._container.appendChild(this._button);
    this.refresh();
    return this._container;
  }

  onRemove(): void {
    this._container?.remove();
    this._container = undefined;
    this._button = undefined;
  }

  refresh(): void {
    if (!this._button || !this.options.isPressed) return;
    this._button.setAttribute("aria-pressed", String(this.options.isPressed()));
  }
}
