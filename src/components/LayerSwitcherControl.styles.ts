import { css } from "lit";

export const layerSwitcherStyles = css`
  :host {
    position: absolute;
    /* bottom-left: NavigationControl + the Reset focus / Toggle grouping map
     * buttons now share top-right, and attribution sits bottom-right, leaving
     * this corner free. z-index sits above MapLibre's own control containers
     * (z-index 2 in maplibre-gl.css). */
    bottom: 8px;
    left: 8px;
    z-index: 3;
    font: 13px/1.4 var(--paper-font-body1_-_font-family, sans-serif);
  }
  .toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    padding: 0;
    border: none;
    border-radius: 10px;
    background: var(--card-background-color, #fff);
    color: var(--primary-text-color, #212121);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
    cursor: pointer;
  }
  .toggle svg {
    width: 22px;
    height: 22px;
  }
  /* Opens upward from the bottom-left button, like Google/Apple Maps' layer
   * picker. */
  /* Rounded container: it owns the border-radius and clips the inner scroller
   * (and its scrollbar) to that rounded shape via overflow:hidden — so the
   * scrollbar follows the curve instead of squaring off the right corners. */
  .panel {
    position: absolute;
    bottom: 48px;
    left: 0;
    min-width: 216px;
    border-radius: 14px;
    overflow: hidden;
    background: var(--card-background-color, #fff);
    color: var(--primary-text-color, #212121);
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.28);
  }
  /* Inner scroller: does the actual scrolling when the panel is taller than
   * the map (max-height set inline from the available height). */
  .panel-scroll {
    /* border-box so the inline max-height (computed from the available map
     * height) caps the whole scroller incl. padding, not just its content —
     * otherwise the panel is ~1 padding taller than intended and clips at the
     * top of the card. */
    box-sizing: border-box;
    padding: 14px;
    overflow-y: auto;
    /* Firefox thin themed scrollbar. */
    scrollbar-width: thin;
    scrollbar-color: var(--divider-color, #bbb) transparent;
  }
  .panel-scroll::-webkit-scrollbar {
    width: 8px;
  }
  /* Drop the default up/down arrow buttons entirely — they read as a heavy OS
   * scrollbar and, sitting at the very top/bottom, get clipped by the panel's
   * rounded corners. All button variants are covered so none slip through. */
  .panel-scroll::-webkit-scrollbar-button,
  .panel-scroll::-webkit-scrollbar-button:single-button,
  .panel-scroll::-webkit-scrollbar-button:start,
  .panel-scroll::-webkit-scrollbar-button:end {
    display: none;
    width: 0;
    height: 0;
  }
  /* Inset the track (and thus the thumb) away from the top/bottom so the
   * scrollbar clears the 14px rounded corners entirely — nothing to clip. */
  .panel-scroll::-webkit-scrollbar-track {
    background: transparent;
    margin: 14px 0;
  }
  .panel-scroll::-webkit-scrollbar-thumb {
    background: var(--divider-color, #bbb);
    border-radius: 6px;
    border: 2px solid transparent;
    background-clip: padding-box;
  }
  .group + .group {
    margin-top: 14px;
    padding-top: 14px;
    border-top: 1px solid var(--divider-color, #e0e0e0);
  }
  .group-label {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    opacity: 0.6;
    margin-bottom: 8px;
  }
  /* Native inputs stay in the DOM (accessibility + label toggling) but are
   * visually replaced by the styled cards/segments/switches below. */
  .panel input {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: 0;
    opacity: 0;
    pointer-events: none;
  }

  /* Base-map choices as a uniform-width vertical list (icon left, label right),
   * so every card is the same size regardless of how long its name is. */
  .cards {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .card {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 10px;
    width: 100%;
    box-sizing: border-box;
    padding: 10px 12px;
    border: 2px solid var(--divider-color, #e0e0e0);
    border-radius: 12px;
    cursor: pointer;
    transition: border-color 0.15s ease, background 0.15s ease;
  }
  .card-icon {
    flex: 0 0 auto;
    display: flex;
  }
  .card-icon svg {
    display: block;
    width: 22px;
    height: 22px;
    opacity: 0.7;
  }
  .card-label {
    flex: 1;
    min-width: 0;
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .card--active {
    border-color: var(--primary-color, #03a9f4);
    background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.12);
  }
  .card--active .card-icon svg {
    opacity: 1;
    color: var(--primary-color, #03a9f4);
  }

  /* Theme picker as a connected segmented control. */
  .segmented {
    display: inline-flex;
    border: 1px solid var(--divider-color, #e0e0e0);
    border-radius: 9px;
    overflow: hidden;
  }
  .seg {
    padding: 6px 14px;
    font-size: 12px;
    cursor: pointer;
    border-right: 1px solid var(--divider-color, #e0e0e0);
    transition: background 0.15s ease, color 0.15s ease;
  }
  .seg:last-child {
    border-right: none;
  }
  .seg--active {
    background: var(--primary-color, #03a9f4);
    color: var(--text-primary-color, #fff);
  }

  /* Overlays as labelled rows with an iOS-style toggle switch. */
  .overlay-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 5px 0;
    cursor: pointer;
  }
  .switch {
    position: relative;
    flex: 0 0 auto;
    width: 36px;
    height: 20px;
    border-radius: 10px;
    background: var(--disabled-text-color, rgba(0, 0, 0, 0.26));
    transition: background 0.2s ease;
  }
  .switch::after {
    content: "";
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
    transition: transform 0.2s ease;
  }
  input:checked + .switch {
    background: var(--primary-color, #03a9f4);
  }
  input:checked + .switch::after {
    transform: translateX(16px);
  }
`;
