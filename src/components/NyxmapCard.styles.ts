import { css } from "lit";

export const nyxmapCardStyles = css`
  :host {
    display: block;
    /* No default height here — the host sizes to its content (.nyxmap-
     * viewport's own explicit pixel height) same as always. A percentage
     * height:100% is opted into via an inline style set in NyxmapCard,
     * only when the user actually configures a percentage height — see
     * that inline style's comment for why this can't just be unconditional
     * CSS here. */
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
    /* A flex column so an optional title takes only the height it needs
     * and .nyxmap-map-area gets exactly what's left — see .nyxmap-title's
     * comment for why this exists instead of ha-card's own built-in
     * header. */
    display: flex;
    flex-direction: column;
    width: 100%;
    /* A percentage height (e.g. "100%" for a Panel view) needs an ancestor
     * with a *specified* height to resolve against — min-height on :host
     * (see NyxmapCard.ts's updated()) makes it render at a real size, but
     * CSS doesn't count a min-height-clamped auto height as "specified" for
     * a descendant's own percentage-height purposes, so the unresolved
     * chain (:host → ha-card → here) still computes to 0 wherever the
     * outermost ancestor (e.g. HA's edit-card dialog preview pane) has no
     * real height of its own — no error, just a blank map area. min-height
     * *here* sidesteps that: flexbox distributes .nyxmap-map-area's space
     * from this element's own actual (min-height-clamped) computed size,
     * not from a percentage resolution. Harmless for a real Panel view,
     * which already provides a taller real height this floor sits under. */
    min-height: 200px;
  }
  .nyxmap-title {
    /* Renders our own title instead of using ha-card's built-in .header
     * property. ha-card's header adds its own height *on top of*
     * .nyxmap-viewport's already-explicit height (rather than the two
     * sharing it), so with a title configured the combined content could
     * exceed ha-card's box — and since ha-card clips to its rounded
     * corners, the excess got silently cut off the bottom, taking whatever
     * sat there (e.g. the attribution control) with it. Styled to
     * approximate ha-card's own header look via the same theme variables. */
    flex: 0 0 auto;
    padding: 16px 16px 0;
    color: var(--ha-card-header-color, var(--primary-text-color));
    font-family: var(--ha-card-header-font-family, inherit);
    font-size: var(--ha-card-header-font-size, 24px);
    font-weight: 400;
    letter-spacing: -0.012em;
    line-height: 1.2;
  }
  .nyxmap-map-area {
    /* Its own positioning context, separate from .nyxmap-viewport (which
     * also contains the title): nyxmap-layer-switcher is position:absolute,
     * top:8px/left:8px — if it were positioned against the whole viewport
     * instead of just the map area, that offset would land on top of the
     * title bar rather than the map's own top-left corner. */
    position: relative;
    flex: 1 1 auto;
    /* Flex items default to min-height:auto (their content size) which
     * would otherwise prevent this from ever shrinking below the map's
     * own intrinsic size, defeating the "exactly what's left" sizing this
     * flex layout exists for. */
    min-height: 0;
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
  /* Pure animation anchor: maplibregl.Marker positions this element via its
   * own translate transform (written directly onto it every move tick), so
   * the actual visual node (.nyxmap-marker / .nyxmap-cluster-bubble) is a
   * child, letting its own scale transform below animate without colliding
   * with MapLibre's positioning transform. See wrapAnimatedMarker(). */
  .nyxmap-marker-anchor {
    line-height: 0;
  }
  /* Shared enter/exit transition for both individual markers and cluster
   * bubbles — the resting (visible) state. .nyxmap-anim-out is the
   * collapsed-at-offset state MarkerAnimator toggles for the merge/split
   * spring: it translates toward the cluster centroid (via the per-element
   * --nyxmap-anim-dx/dy custom properties MarkerAnimator sets) while shrinking
   * and fading, mirroring Home Assistant's own Leaflet cluster animation.
   * Duration must match ANIM_MS in MarkerAnimator.ts. */
  .nyxmap-marker,
  .nyxmap-cluster-bubble {
    transition: opacity 220ms ease, transform 220ms ease;
    transform: translate(0, 0) scale(1);
    opacity: 1;
  }
  .nyxmap-anim-out {
    opacity: 0;
    transform: translate(var(--nyxmap-anim-dx, 0px), var(--nyxmap-anim-dy, 0px)) scale(0.3);
    pointer-events: none;
  }
  /* Themed to match Home Assistant's own map cluster marker: filled with the
   * active theme's accent (--primary-color) and ringed by a translucent halo
   * of the same colour (via HA's --rgb-primary-color), instead of a fixed
   * palette. Fallbacks are HA's default primary blue for contexts that don't
   * provide the theme vars (e.g. the dev harness). */
  .nyxmap-cluster-bubble {
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: var(--primary-color, #03a9f4);
    color: var(--text-primary-color, #fff);
    font: 600 12px/1 var(--paper-font-body1_-_font-family, sans-serif);
    box-shadow: 0 0 0 6px rgba(var(--rgb-primary-color, 3, 169, 244), 0.35),
      0 1px 4px rgba(0, 0, 0, 0.4);
    cursor: pointer;
  }
  .nyxmap-marker--initials {
    background-color: var(--nyxmap-color);
  }
  /* display: state renders an unbounded value ("Not home", "unavailable"),
   * which a fixed-diameter disc clips. Grow horizontally into a pill instead:
   * min-width keeps a short value ("21.5") circular like every other marker,
   * max-width stops a pathological state from spanning the map, and the
   * marker's own inline height still sets the pill height. */
  .nyxmap-marker--state {
    width: auto;
    min-width: var(--nyxmap-marker-size, 48px);
    max-width: 160px;
    padding: 0 8px;
    box-sizing: border-box;
    border-radius: 999px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    display: block;
    line-height: var(--nyxmap-marker-size, 48px);
    text-align: center;
  }
  .nyxmap-marker ha-icon {
    --mdc-icon-size: 60%;
  }
  /* MapLibre positions its control corners flush against the container
   * edge (bottom:0/right:0 etc, zero inset) — fine against a square box,
   * but ha-card clips to its own rounded corners (border-radius, see
   * above), so a control sitting exactly in the corner with no margin has
   * its outer edge cut off by the curve (most visible on the bottom-right
   * compact attribution icon). A small margin pulls every corner's
   * controls in far enough to clear it. Margin, not padding/inset, because
   * these are absolutely positioned: for an abspos box, top/right/bottom/
   * left place the *margin* box, so margin still creates a real inset from
   * the containing block's edge here. */
  .maplibregl-ctrl-top-right,
  .maplibregl-ctrl-bottom-right,
  .maplibregl-ctrl-top-left,
  .maplibregl-ctrl-bottom-left {
    margin: 8px;
  }
  /* MapLibre's own .maplibregl-ctrl-group hardcodes a #fff background
   * regardless of HA's theme; theme it (this also covers our own
   * IconButtonControls, which carry the same class) so every control matches
   * the card surface. */
  .maplibregl-ctrl-group {
    background: var(--card-background-color, #fff);
  }
  /* NavigationControl's zoom/compass icons are baked-in dark SVGs (background-
   * image data-URIs, no CSS var to recolor), so on a dark card background they
   * vanish. Invert them to light when the background is dark; hue-rotate keeps
   * the compass needle's colour instead of flipping it. data-dark is set from
   * the resolved --card-background-color in NyxmapCard.updated(). */
  :host([data-dark]) .maplibregl-ctrl-icon {
    filter: invert(1) hue-rotate(180deg);
  }
  :host([data-dark]) .maplibregl-ctrl-group button + button {
    border-top-color: rgba(255, 255, 255, 0.14);
  }
  /* IconButtonControl (Reset focus / Toggle grouping): sized/centered to
   * match MapLibre's own NavigationControl buttons, which it stacks below
   * via the shared .maplibregl-ctrl-group container. */
  .nyxmap-ctrl-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 29px;
    height: 29px;
    padding: 0;
    border: none;
    background: none;
    color: var(--primary-text-color, #333);
    cursor: pointer;
  }
  .nyxmap-ctrl-button[aria-pressed="false"] {
    opacity: 0.5;
  }
  .nyxmap-ctrl-button svg {
    width: 18px;
    height: 18px;
  }
`;
