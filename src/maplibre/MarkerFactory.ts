import type { EntityConfig } from "../configs/EntityConfig";
import type { HassEntity } from "../types/home-assistant";

export function initials(name: string): string {
  return name
    .split(/[\s_.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export function colorFromString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
  // The 32-bit accumulator goes negative and JS `%` keeps the sign, so a bare
  // `h % 360` yields e.g. hsl(-257, …) for `device_tracker.phone`. CSS treats
  // hue as an angle mod 360 and tolerates it, but the same string is also fed
  // to MapLibre paint properties (history line-color, circle fill), whose
  // parser is spec-compliant — so normalize here rather than depend on parser
  // leniency.
  return `hsl(${((h % 360) + 360) % 360}, 60%, 45%)`;
}

/** Builds the marker DOM element: state > picture > icon > initials chain. */
export function buildMarkerElement(entityCfg: EntityConfig, stateObj?: HassEntity): HTMLElement {
  const el = document.createElement("div");
  el.className = "nyxmap-marker";
  applyMarkerVisual(el, entityCfg, stateObj);
  return el;
}

/** (Re)applies a marker's state-dependent visual to an *existing* element —
 * same split as buildClusterBubbleElement/applyClusterBubbleVisual below, and
 * for the same reason: the element must be updated in place rather than
 * replaced. EntitiesRenderService only ever built the DOM once, so a rotated
 * `entity_picture` signed-URL token, a state-templated `icon`, or a rename all
 * left the marker showing whatever it looked like at first render. Mutating
 * the same node (instead of swapping in a fresh one) keeps the click listener,
 * the MarkerAnimator WeakMap entry and any in-flight animation class attached
 * to it. Deliberately does not touch the `--nyxmap-anim-dx/dy` custom
 * properties or the `nyxmap-anim-out` class for that reason. */
export function applyMarkerVisual(el: HTMLElement, entityCfg: EntityConfig, stateObj?: HassEntity): void {
  el.classList.remove(
    "nyxmap-marker--picture",
    "nyxmap-marker--icon",
    "nyxmap-marker--initials",
    "nyxmap-marker--state",
  );
  el.replaceChildren();
  el.style.backgroundImage = "";
  el.style.width = el.style.height = `${entityCfg.size}px`;
  // Also exposed as a custom property so CSS can reference the configured size
  // in contexts where the inline width is cleared (see the state pill below).
  el.style.setProperty("--nyxmap-marker-size", `${entityCfg.size}px`);
  el.style.setProperty("--nyxmap-color", entityCfg.color ?? colorFromString(entityCfg.id));

  const picture = entityCfg.picture ?? stateObj?.attributes?.entity_picture;
  if (entityCfg.display === "state") {
    // Upstream ha-map-card renders the entity's state value for this display
    // mode. Falls back to label/initials when the entity has no state object at
    // all, so the marker never renders empty.
    //
    // Unlike the other text treatment (initials), a state value has no bounded
    // length — "Not home", "21.5", "unavailable" all land here — so this one
    // grows into a pill instead of being clipped by the fixed-diameter disc.
    // Width is cleared to let CSS size it to the text; `size` stays the height,
    // which keeps a short value looking like every other marker.
    el.textContent = stateObj?.state ?? entityCfg.label ?? initials(entityCfg.id);
    el.style.width = "";
    el.classList.add("nyxmap-marker--initials", "nyxmap-marker--state");
  } else if (entityCfg.display !== "icon" && picture) {
    el.style.backgroundImage = `url("${picture}")`;
    el.classList.add("nyxmap-marker--picture");
  } else if (entityCfg.icon || stateObj?.attributes?.icon) {
    const ico = document.createElement("ha-icon");
    ico.setAttribute("icon", entityCfg.icon ?? stateObj!.attributes.icon!);
    el.appendChild(ico);
    el.classList.add("nyxmap-marker--icon");
  } else {
    el.textContent = entityCfg.label ?? initials(stateObj?.attributes?.friendly_name ?? entityCfg.id);
    el.classList.add("nyxmap-marker--initials");
  }
}

/** Identity of everything that decides how a marker looks, as a single
 * comparable string. EntitiesRenderService stores it per marker and re-applies
 * the visual only when it changes, so the common case (a position-only update)
 * still does nothing but setLngLat().
 *
 * That is everything applyMarkerVisual() reads, plus `zIndexOffset` — which is
 * written by wrapAnimatedMarker onto the *wrapper* rather than the visual node,
 * and so is applied separately in the redraw branch. It's keyed here because it
 * otherwise only ever took effect at marker-creation time: raising an entity's
 * `z_index_offset` in the visual editor changed nothing until the card was
 * rebuilt. */
export function markerVisualKey(entityCfg: EntityConfig, stateObj?: HassEntity): string {
  return [
    entityCfg.display,
    entityCfg.size,
    entityCfg.zIndexOffset,
    entityCfg.color ?? "",
    entityCfg.picture ?? "",
    entityCfg.icon ?? "",
    entityCfg.label ?? "",
    entityCfg.display === "state" ? (stateObj?.state ?? "") : "",
    stateObj?.attributes?.entity_picture ?? "",
    stateObj?.attributes?.icon ?? "",
    stateObj?.attributes?.friendly_name ?? "",
    // NUL separator, written as an escape and never a literal byte (see
    // ClusterRenderService.pairKey): it can't occur in an entity id, icon
    // name, picture URL or friendly name, so two distinct field tuples can
    // never collide by concatenation.
  ].join("\u0000");
}

/** Wraps a marker's visual element in an outer anchor div. maplibregl.Marker
 * positions the element passed to `new Marker({element})` by writing
 * `style.transform` onto it directly on every move tick (verified in the
 * bundled maplibre-gl source), so animating `transform: scale()` on that same
 * node would be clobbered every frame. Putting the visual node one level down
 * lets its own transform compose independently of MapLibre's positioning
 * transform on the wrapper — this indirection is structural, not cosmetic.
 *
 * `zIndex` (an entity's `z_index_offset`) belongs on this outer node, not the
 * visual one: MapLibre gives every marker its own absolutely-positioned
 * element in the same container, so cross-marker stacking is decided there.
 * MapLibre itself never writes `style.zIndex` on a marker element (grepped in
 * the bundled dist), so there's nothing to fight over. */
export function wrapAnimatedMarker(inner: HTMLElement, zIndex?: number): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "nyxmap-marker-anchor";
  if (zIndex !== undefined) wrapper.style.zIndex = String(zIndex);
  wrapper.appendChild(inner);
  return wrapper;
}

/** Builds a cluster bubble's visual element (count label + size/color stepped
 * by member count) — the same 3-step visual language the old GL circle-paint
 * spec used, so a bubble looks the same as before; only *when* it forms
 * (touching-based, not zoom-bucketed) and *how* it animates has changed. */
export function buildClusterBubbleElement(count: number): HTMLElement {
  const el = document.createElement("div");
  el.className = "nyxmap-cluster-bubble";
  applyClusterBubbleVisual(el, count);
  return el;
}

/** (Re)applies a bubble's count-dependent size/label to an existing element —
 * used both by buildClusterBubbleElement and when a surviving bubble's member
 * count changes between frames, so the bubble updates in place instead of being
 * torn down and re-animated. The bubble's colour is theme-driven (HA's
 * --primary-color + translucent halo, see NyxmapCard.styles.ts), matching Home
 * Assistant's own map, so it isn't set here. */
export function applyClusterBubbleVisual(el: HTMLElement, count: number): void {
  const diameter = clusterDiameter(count);
  el.style.width = el.style.height = `${diameter}px`;
  el.textContent = abbreviateCount(count);
}

// Bubble diameter steps up with member count so a bigger cluster reads as
// heavier (matching the spirit of HA's own tiered cluster sizing).
function clusterDiameter(count: number): number {
  if (count >= 50) return 52;
  if (count >= 10) return 40;
  return 32;
}

// Matches supercluster's point_count_abbreviated formatting closely enough
// for this card's purposes (e.g. 1200 → "1.2k").
function abbreviateCount(count: number): string {
  if (count < 1000) return String(count);
  return `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k`;
}
