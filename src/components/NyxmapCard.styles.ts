import { css } from "lit";

export const nyxmapCardStyles = css`
  :host {
    display: block;
  }
  ha-card {
    /* Clips everything to ha-card's own rounded corners: the map canvas
     * (square by default) and, just as importantly, the layer switcher's
     * floating dropdown panel — without this, an open panel (or anything
     * else position:absolute in here) can spill past the card's box and
     * into the surrounding dashboard, which shows up as a page-level
     * scrollbar rather than a contained, scrollable card. The switcher no
     * longer collides with MapLibre's own top-right NavigationControl (see
     * LayerSwitcherControl.styles.ts), so this clip no longer needs to be
     * relaxed to keep it usable. */
    overflow: hidden;
    height: 100%;
  }
  .nyxmap-viewport {
    position: relative;
    width: 100%;
  }
  .nyxmap-container {
    width: 100%;
    height: 100%;
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
