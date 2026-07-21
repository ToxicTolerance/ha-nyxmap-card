/**
 * A tiny, framework-free enter/exit animation state machine shared by
 * EntitiesRenderService (an entity marker being absorbed into / released from a
 * cluster bubble) and ClusterRenderService (a bubble appearing / dissolving).
 *
 * Ports the *feel* of Home Assistant's own map (Leaflet.markercluster): markers
 * don't just fade in place, they spring — a marker converging into a cluster
 * translates toward the bubble's centre as it shrinks and fades, and a marker
 * emerging from a splitting cluster starts at that centre and flies out to its
 * real position. The per-marker pixel offset `(dx, dy)` is the vector from the
 * marker's own position to the cluster centroid; a bubble itself animates in
 * place with `(0, 0)`.
 *
 * The visual transition lives in CSS (`.nyxmap-anim-out` in
 * NyxmapCard.styles.ts, parameterised by the `--nyxmap-anim-dx/dy` custom
 * properties this module sets); here we only toggle the class / properties and
 * fire a completion callback, reconciling the fact that a CSS `transitionend`
 * doesn't fire under jsdom/vitest (nor reliably for a detached element) by
 * racing it against a fallback timer.
 */

const ANIM_CLASS = "nyxmap-anim-out";
const DX_PROP = "--nyxmap-anim-dx";
const DY_PROP = "--nyxmap-anim-dy";
// Keep in sync with the transition-duration declared on .nyxmap-marker /
// .nyxmap-cluster-bubble in NyxmapCard.styles.ts.
export const ANIM_MS = 220;
const FALLBACK_BUFFER_MS = 60;

interface AnimState {
  timer: ReturnType<typeof setTimeout>;
  listener: (e: Event) => void;
}

const pending = new WeakMap<HTMLElement, AnimState>();

function clearPending(el: HTMLElement): void {
  const s = pending.get(el);
  if (!s) return;
  clearTimeout(s.timer);
  el.removeEventListener("transitionend", s.listener);
  pending.delete(el);
}

/** Runs `cb` exactly once when the current transition settles — via
 * `transitionend` or a fallback timer, whichever comes first.
 *
 * The `e.target !== el` guard is load-bearing: `transitionend` bubbles, and a
 * marker element has children (the `<ha-icon>` buildMarkerElement appends,
 * whose internal HA components transition on their own). Without it a
 * descendant's unrelated transition settles the marker's animation early, so
 * `onDone()` — `marker.remove()` — fires mid-flight and the marker pops out of
 * existence instead of shrinking into the cluster bubble. Because the listener
 * must survive those foreign events it can't use `{ once: true }`; it's
 * removed explicitly by clearPending() instead. */
function onceSettled(el: HTMLElement, cb: () => void): void {
  const settle = () => {
    clearPending(el);
    cb();
  };
  const listener = (e: Event) => {
    if (e.target !== el) return;
    settle();
  };
  const timer = setTimeout(settle, ANIM_MS + FALLBACK_BUFFER_MS);
  pending.set(el, { timer, listener });
  el.addEventListener("transitionend", listener);
}

function setOffset(el: HTMLElement, dx: number, dy: number): void {
  el.style.setProperty(DX_PROP, `${dx}px`);
  el.style.setProperty(DY_PROP, `${dy}px`);
}

function clearOffset(el: HTMLElement): void {
  el.style.removeProperty(DX_PROP);
  el.style.removeProperty(DY_PROP);
}

/**
 * Animates `el` converging toward the pixel offset `(dx, dy)` — the direction
 * of the cluster bubble it's being absorbed into — while shrinking and fading,
 * then invokes `onDone` (unmount). `(0, 0)` gives an in-place shrink/fade (used
 * for a dissolving bubble). Taking over from any in-flight animation is safe.
 */
export function animateConverge(el: HTMLElement, dx: number, dy: number, onDone: () => void): void {
  clearPending(el);
  setOffset(el, dx, dy);
  // The element is currently at its resting state, so adding the class
  // transitions it toward the offset/faded state.
  el.classList.add(ANIM_CLASS);
  onceSettled(el, () => {
    onDone();
    // Reset so a later reuse of this element starts clean (invisible now:
    // onDone has unmounted it).
    el.classList.remove(ANIM_CLASS);
    clearOffset(el);
  });
}

/**
 * Animates `el` emerging FROM the pixel offset `(dx, dy)` (the cluster centre it
 * was released from) out to its resting position, scaling/fading in. Snaps to
 * the collapsed-at-offset start state without transitioning into it (so the
 * jump to the centre isn't itself animated), then transitions out to rest.
 */
export function animateEmerge(el: HTMLElement, dx: number, dy: number): void {
  clearPending(el);
  setOffset(el, dx, dy);
  // Snap to the hidden@offset start state with transitions suppressed, force a
  // reflow to commit it, then release to animate back to rest.
  el.style.transition = "none";
  el.classList.add(ANIM_CLASS);
  void el.offsetWidth; // force reflow so the snapped start state is committed
  el.style.transition = "";
  requestAnimationFrame(() => {
    el.classList.remove(ANIM_CLASS);
    onceSettled(el, () => clearOffset(el));
  });
}
