import { afterEach, describe, expect, it, vi } from "vitest";
import { StyleReattach } from "./StyleReattach";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("StyleReattach", () => {
  it("replays every registered factory with the given map", () => {
    const registry = new StyleReattach();
    const a = vi.fn();
    const b = vi.fn();
    registry.register("a", a);
    registry.register("b", b);

    const fakeMap = {} as never;
    registry.replayAll(fakeMap);

    expect(a).toHaveBeenCalledWith(fakeMap);
    expect(b).toHaveBeenCalledWith(fakeMap);
  });

  it("stops replaying a factory after unregister", () => {
    const registry = new StyleReattach();
    const factory = vi.fn();
    registry.register("a", factory);
    registry.unregister("a");

    registry.replayAll({} as never);

    expect(factory).not.toHaveBeenCalled();
    expect(registry.has("a")).toBe(false);
  });

  it("overwrites a factory registered under the same id", () => {
    const registry = new StyleReattach();
    const first = vi.fn();
    const second = vi.fn();
    registry.register("a", first);
    registry.register("a", second);

    registry.replayAll({} as never);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("isolates a throwing factory so the remaining ones still replay", () => {
    const onError = vi.spyOn(console, "error").mockImplementation(() => {});
    const registry = new StyleReattach();
    const before = vi.fn();
    const after = vi.fn();
    registry.register("before", before);
    registry.register("boom", () => {
      throw new Error("bad layer spec");
    });
    registry.register("after", after);

    const fakeMap = {} as never;
    expect(() => registry.replayAll(fakeMap)).not.toThrow();

    expect(before).toHaveBeenCalledWith(fakeMap);
    expect(after).toHaveBeenCalledWith(fakeMap);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('"boom"'), expect.any(Error));
  });

  it("keeps a throwing factory registered so a later replay retries it", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const registry = new StyleReattach();
    let calls = 0;
    registry.register("boom", () => {
      calls += 1;
      throw new Error("boom");
    });

    registry.replayAll({} as never);
    registry.replayAll({} as never);

    expect(calls).toBe(2);
    expect(registry.has("boom")).toBe(true);
  });

  it("snapshots the registry so a factory registering during replay isn't visited in the same pass", () => {
    const registry = new StyleReattach();
    const late = vi.fn();
    let selfRegistrations = 0;
    registry.register("self", () => {
      selfRegistrations += 1;
      // A self-registering factory would loop forever against a live Map.
      registry.register(`self-${selfRegistrations}`, late);
    });

    registry.replayAll({} as never);

    expect(selfRegistrations).toBe(1);
    expect(late).not.toHaveBeenCalled();
    expect(registry.has("self-1")).toBe(true);
  });

  it("tolerates a factory that unregisters another factory mid-replay", () => {
    const registry = new StyleReattach();
    const victim = vi.fn();
    registry.register("a", () => registry.unregister("b"));
    registry.register("b", victim);

    expect(() => registry.replayAll({} as never)).not.toThrow();
    // Snapshotted: "b" was already queued for this pass.
    expect(victim).toHaveBeenCalledTimes(1);
    expect(registry.has("b")).toBe(false);
  });

  it("clear() removes all registrations", () => {
    const registry = new StyleReattach();
    registry.register("a", vi.fn());
    registry.register("b", vi.fn());
    registry.clear();
    expect(registry.has("a")).toBe(false);
    expect(registry.has("b")).toBe(false);
  });
});
