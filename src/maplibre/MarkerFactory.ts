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
  return `hsl(${h % 360}, 60%, 45%)`;
}

/** Builds the marker DOM element: picture > icon > initials fallback chain. */
export function buildMarkerElement(entityCfg: EntityConfig, stateObj?: HassEntity): HTMLElement {
  const el = document.createElement("div");
  el.className = "nyxmap-marker";
  const size = entityCfg.size;
  el.style.width = el.style.height = `${size}px`;
  el.style.setProperty("--nyxmap-color", entityCfg.color ?? colorFromString(entityCfg.id));

  const picture = entityCfg.picture ?? stateObj?.attributes?.entity_picture;
  if (entityCfg.display !== "icon" && picture) {
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
  return el;
}

/** Wraps a marker's visual element in an outer anchor div. maplibregl.Marker
 * positions the element passed to `new Marker({element})` by writing
 * `style.transform` onto it directly on every move tick (verified in the
 * bundled maplibre-gl source), so animating `transform: scale()` on that same
 * node would be clobbered every frame. Putting the visual node one level down
 * lets its own transform compose independently of MapLibre's positioning
 * transform on the wrapper — this indirection is structural, not cosmetic. */
export function wrapAnimatedMarker(inner: HTMLElement): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "nyxmap-marker-anchor";
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
