import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HISTORY_REFRESH_MS, HistoryRefreshController, type HistoryRefreshDeps } from "./HistoryRefreshController";
import type { EntityHistory } from "../models/EntityHistory";

type Deferred = { promise: Promise<Map<string, EntityHistory>>; resolve: () => void; reject: (e: unknown) => void };

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<Map<string, EntityHistory>>((res, rej) => {
    resolve = () => res(new Map());
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeDeps(overrides: Partial<HistoryRefreshDeps> = {}) {
  const pending: Deferred[] = [];
  const deps: HistoryRefreshDeps = {
    hasHistoryConfigured: () => true,
    isReady: () => true,
    fetchHistories: () => {
      const d = deferred();
      pending.push(d);
      return d.promise;
    },
    onHistories: vi.fn(),
    ...overrides,
  };
  return { deps, pending };
}

/** Lets the promise chain (then → catch → finally) drain. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe("HistoryRefreshController", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fetches and hands the result to onHistories", async () => {
    const { deps, pending } = makeDeps();
    const controller = new HistoryRefreshController(deps);

    controller.refresh();
    pending[0]!.resolve();
    await settle();

    expect(deps.onHistories).toHaveBeenCalledTimes(1);
  });

  it("does not stack overlapping fetches", () => {
    const { deps, pending } = makeDeps();
    const controller = new HistoryRefreshController(deps);

    controller.refresh();
    controller.refresh();
    controller.refresh();

    expect(pending).toHaveLength(1);
  });

  // The in-flight guard used to just drop a concurrent request, discarding the
  // *reason* for it: editing history_start mid-fetch left the old window on
  // screen until the next poll, up to a minute later.
  it("re-fires once for requests that arrived while a fetch was in flight", async () => {
    const { deps, pending } = makeDeps();
    const controller = new HistoryRefreshController(deps);

    controller.refresh();
    controller.refresh(); // config changed mid-flight
    controller.refresh(); // and again
    expect(pending).toHaveLength(1);

    pending[0]!.resolve();
    await settle();

    // Exactly one catch-up fetch, not one per dropped call.
    expect(pending).toHaveLength(2);

    pending[1]!.resolve();
    await settle();
    expect(pending).toHaveLength(2);
  });

  it("drops a response that is no longer the newest", async () => {
    const { deps, pending } = makeDeps();
    const controller = new HistoryRefreshController(deps);

    controller.refresh();
    controller.stop(); // invalidates the in-flight generation
    pending[0]!.resolve();
    await settle();

    expect(deps.onHistories).not.toHaveBeenCalled();
  });

  it("drops a response that lands while the map is not ready", async () => {
    let ready = true;
    const { deps, pending } = makeDeps({ isReady: () => ready });
    const controller = new HistoryRefreshController(deps);

    controller.refresh();
    ready = false; // e.g. a style swap started
    pending[0]!.resolve();
    await settle();

    expect(deps.onHistories).not.toHaveBeenCalled();
  });

  it("swallows a rejection instead of leaving it unhandled", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { deps, pending } = makeDeps();
    const controller = new HistoryRefreshController(deps);

    controller.refresh();
    pending[0]!.reject(new Error("ws down"));
    await settle();

    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  describe("catch-up latch", () => {
    it("stays pending until the first fetch settles", async () => {
      const { deps, pending } = makeDeps();
      const controller = new HistoryRefreshController(deps);
      expect(controller.catchUpPending).toBe(true);

      controller.refresh();
      expect(controller.catchUpPending).toBe(true);

      pending[0]!.resolve();
      await settle();
      expect(controller.catchUpPending).toBe(false);
    });

    // Latching on settle rather than up front is what lets a first fetch that
    // failed still be retried by the catch-up path.
    it("clears after a failed fetch too", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { deps, pending } = makeDeps();
      const controller = new HistoryRefreshController(deps);

      controller.refresh();
      pending[0]!.reject(new Error("nope"));
      await settle();

      expect(controller.catchUpPending).toBe(false);
      warn.mockRestore();
    });

    it("re-arms on resetCatchUp so a config change is re-fetched", () => {
      const { deps } = makeDeps();
      const controller = new HistoryRefreshController(deps);

      controller.resetCatchUp();
      expect(controller.catchUpPending).toBe(true);
    });
  });

  describe("poll timer", () => {
    it("re-fetches on the interval", async () => {
      const { deps, pending } = makeDeps();
      const controller = new HistoryRefreshController(deps);

      controller.refresh();
      pending[0]!.resolve();
      await settle();

      vi.advanceTimersByTime(HISTORY_REFRESH_MS);
      expect(pending).toHaveLength(2);
    });

    it("installs no timer at all when no history is configured", () => {
      const { deps, pending } = makeDeps({ hasHistoryConfigured: () => false });
      const controller = new HistoryRefreshController(deps);

      controller.refresh();
      vi.advanceTimersByTime(HISTORY_REFRESH_MS * 3);

      expect(vi.getTimerCount()).toBe(0);
      expect(pending).toHaveLength(1);
    });

    it("stops polling once history is removed from the config", async () => {
      let configured = true;
      const { deps, pending } = makeDeps({ hasHistoryConfigured: () => configured });
      const controller = new HistoryRefreshController(deps);

      controller.refresh();
      pending[0]!.resolve();
      await settle();
      expect(vi.getTimerCount()).toBe(1);

      configured = false;
      controller.syncTimer();

      expect(vi.getTimerCount()).toBe(0);
    });

    it("stop() clears the timer", async () => {
      const { deps, pending } = makeDeps();
      const controller = new HistoryRefreshController(deps);

      controller.refresh();
      pending[0]!.resolve();
      await settle();

      controller.stop();

      expect(vi.getTimerCount()).toBe(0);
    });
  });

  it("does nothing when there is not enough context to fetch yet", () => {
    const { deps } = makeDeps({ fetchHistories: () => undefined });
    const controller = new HistoryRefreshController(deps);

    expect(() => controller.refresh()).not.toThrow();
    expect(deps.onHistories).not.toHaveBeenCalled();
  });
});
