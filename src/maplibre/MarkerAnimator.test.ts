// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANIM_MS, animateConverge, animateEmerge } from "./MarkerAnimator";

const OUT_CLASS = "nyxmap-anim-out";

describe("MarkerAnimator", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  describe("animateConverge", () => {
    it("adds the collapsed class with the given offset and fires onDone on transitionend", () => {
      const el = document.createElement("div");
      const done = vi.fn();

      animateConverge(el, 12, -8, done);
      expect(el.classList.contains(OUT_CLASS)).toBe(true);
      expect(el.style.getPropertyValue("--nyxmap-anim-dx")).toBe("12px");
      expect(el.style.getPropertyValue("--nyxmap-anim-dy")).toBe("-8px");
      expect(done).not.toHaveBeenCalled();

      el.dispatchEvent(new Event("transitionend"));
      expect(done).toHaveBeenCalledTimes(1);
    });

    it("fires onDone via the fallback timer when transitionend never fires, then cleans up", () => {
      const el = document.createElement("div");
      const done = vi.fn();

      animateConverge(el, 0, 0, done);
      vi.advanceTimersByTime(ANIM_MS + 60);

      expect(done).toHaveBeenCalledTimes(1);
      // After completion the class/offset are cleared so a later reuse is clean.
      expect(el.classList.contains(OUT_CLASS)).toBe(false);
      expect(el.style.getPropertyValue("--nyxmap-anim-dx")).toBe("");
    });

    it("fires onDone only once even if both transitionend and the fallback timer occur", () => {
      const el = document.createElement("div");
      const done = vi.fn();

      animateConverge(el, 5, 5, done);
      el.dispatchEvent(new Event("transitionend"));
      vi.advanceTimersByTime(ANIM_MS + 60);

      expect(done).toHaveBeenCalledTimes(1);
    });

    it("a later converge replaces an earlier pending callback rather than firing both", () => {
      const el = document.createElement("div");
      const first = vi.fn();
      const second = vi.fn();

      animateConverge(el, 0, 0, first);
      animateConverge(el, 0, 0, second);
      el.dispatchEvent(new Event("transitionend"));

      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledTimes(1);
    });

    // Regression: the listener was attached without a target check, and
    // transitionend bubbles. A marker element has children — the <ha-icon>
    // buildMarkerElement appends — whose own CSS transitions would settle the
    // marker's animation early, firing onDone() (marker.remove()) mid-flight
    // so the marker popped out of existence instead of shrinking away.
    it("ignores a transitionend bubbling up from a descendant", () => {
      const el = document.createElement("div");
      const child = document.createElement("ha-icon");
      el.appendChild(child);
      const done = vi.fn();

      animateConverge(el, 10, 10, done);
      child.dispatchEvent(new Event("transitionend", { bubbles: true }));

      expect(done).not.toHaveBeenCalled();
      // The marker's own transitionend still settles it.
      el.dispatchEvent(new Event("transitionend"));
      expect(done).toHaveBeenCalledTimes(1);
    });

    it("still settles via the fallback timer after a descendant event was ignored", () => {
      const el = document.createElement("div");
      const child = document.createElement("span");
      el.appendChild(child);
      const done = vi.fn();

      animateConverge(el, 0, 0, done);
      child.dispatchEvent(new Event("transitionend", { bubbles: true }));
      vi.advanceTimersByTime(ANIM_MS + 60);

      expect(done).toHaveBeenCalledTimes(1);
    });

    it("removes its listener on settle, so a later descendant event can't re-fire it", () => {
      const el = document.createElement("div");
      const child = document.createElement("span");
      el.appendChild(child);
      const done = vi.fn();

      animateConverge(el, 0, 0, done);
      el.dispatchEvent(new Event("transitionend"));
      child.dispatchEvent(new Event("transitionend", { bubbles: true }));
      el.dispatchEvent(new Event("transitionend"));

      expect(done).toHaveBeenCalledTimes(1);
    });
  });

  describe("animateEmerge", () => {
    it("snaps to the collapsed@offset start state, then transitions back to rest", () => {
      const el = document.createElement("div");
      animateEmerge(el, 20, 30);

      // Snapped hidden@offset synchronously (transitions suppressed during snap).
      expect(el.classList.contains(OUT_CLASS)).toBe(true);
      expect(el.style.getPropertyValue("--nyxmap-anim-dx")).toBe("20px");

      // The rAF (stubbed as setTimeout(0)) releases it back to the resting state.
      vi.runAllTimers();
      expect(el.classList.contains(OUT_CLASS)).toBe(false);
    });

    // Regression: the deferred release frame wasn't cancellable, so a converge
    // starting inside its window had its just-added class stripped by the
    // queued callback (the marker popped instead of shrinking), and that
    // callback's onceSettled replaced the converge's pending entry without
    // clearing it — leaving the converge's listener attached for good, free to
    // fire its onDone (marker.remove()) a second time on an unrelated later
    // transitionend, unmounting a marker that was legitimately visible.
    it("a converge starting inside the pending release frame cancels it and settles exactly once", () => {
      const el = document.createElement("div");
      const done = vi.fn();

      animateEmerge(el, 10, 10);
      animateConverge(el, 5, 5, done);
      vi.advanceTimersByTime(1); // the release frame would have fired here

      // The converge owns the element now: its collapsed state stands.
      expect(el.classList.contains(OUT_CLASS)).toBe(true);
      expect(el.style.getPropertyValue("--nyxmap-anim-dx")).toBe("5px");

      vi.advanceTimersByTime(ANIM_MS + 60);
      expect(done).toHaveBeenCalledTimes(1);

      // No stale listener left over to re-fire onDone later.
      el.dispatchEvent(new Event("transitionend"));
      expect(done).toHaveBeenCalledTimes(1);
    });

    it("clears the offset custom properties once the emerge settles", () => {
      const el = document.createElement("div");
      animateEmerge(el, 20, 30);
      vi.runAllTimers();
      el.dispatchEvent(new Event("transitionend"));

      expect(el.style.getPropertyValue("--nyxmap-anim-dx")).toBe("");
    });
  });
});
