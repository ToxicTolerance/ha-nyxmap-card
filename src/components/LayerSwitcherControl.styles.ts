import { css } from "lit";

export const layerSwitcherStyles = css`
  :host {
    position: absolute;
    top: 8px;
    /* top-left: MapLibre's own NavigationControl occupies top-right (its
     * .maplibregl-ctrl-top-right container is z-index: 2 in maplibre-gl.css)
     * — sharing that corner put this control underneath it, effectively
     * invisible/unclickable. z-index is still bumped past that defensively
     * in case a future control lands in this corner too. */
    left: 8px;
    z-index: 3;
    font: 13px/1.4 var(--paper-font-body1_-_font-family, sans-serif);
  }
  .toggle {
    width: 32px;
    height: 32px;
    border-radius: 4px;
    border: none;
    background: var(--card-background-color, #fff);
    color: var(--primary-text-color, #212121);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
    cursor: pointer;
    font-size: 16px;
  }
  .panel {
    position: absolute;
    top: 38px;
    left: 0;
    min-width: 180px;
    padding: 8px 10px;
    border-radius: 6px;
    background: var(--card-background-color, #fff);
    color: var(--primary-text-color, #212121);
    box-shadow: 0 1px 6px rgba(0, 0, 0, 0.35);
  }
  .group + .group {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--divider-color, #e0e0e0);
  }
  .group-label {
    font-weight: 600;
    opacity: 0.7;
    margin-bottom: 4px;
  }
  label {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 0;
    cursor: pointer;
  }
`;
