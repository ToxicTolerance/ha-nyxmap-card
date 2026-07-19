import { css } from "lit";

export const nyxmapCardStyles = css`
  :host {
    display: block;
  }
  ha-card {
    height: 100%;
  }
  .nyxmap-viewport {
    position: relative;
    width: 100%;
  }
  .nyxmap-container {
    width: 100%;
    height: 100%;
    /* Clip the map canvas (square corners) to ha-card's own rounded corners.
     * This used to live on ha-card itself, but that also clipped the layer
     * switcher's floating dropdown panel (nyxmap-layer-switcher is
     * position:absolute and can extend past the map's box) — scoping the
     * clip to just the canvas container keeps the rounded-corner look
     * without cutting off UI that's meant to float outside it. */
    overflow: hidden;
    border-radius: var(--ha-card-border-radius, 12px);
  }
  .nyxmap-marker {
    background-size: cover;
    background-position: center;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 0 0 2px var(--nyxmap-color), 0 1px 4px rgba(0, 0, 0, 0.4);
    color: #fff;
    font: 600 12px/1 var(--paper-font-body1_-_font-family, sans-serif);
    cursor: pointer;
    background-color: var(--nyxmap-color);
  }
  .nyxmap-marker--initials {
    background-color: var(--nyxmap-color);
  }
  .nyxmap-marker ha-icon {
    --mdc-icon-size: 60%;
  }
`;
