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

    it("clears the offset custom properties once the emerge settles", () => {
      const el = document.createElement("div");
      animateEmerge(el, 20, 30);
      vi.runAllTimers();
      el.dispatchEvent(new Event("transitionend"));

      expect(el.style.getPropertyValue("--nyxmap-anim-dx")).toBe("");
    });
  });
});
