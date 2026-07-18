import { css } from "lit";

export const nyxmapCardStyles = css`
  :host {
    display: block;
  }
  ha-card {
    overflow: hidden;
    height: 100%;
  }
  .nyxmap-container {
    width: 100%;
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
