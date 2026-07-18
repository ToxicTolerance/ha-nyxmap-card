import { describe, expect, it, vi } from "vitest";
import { StyleReattach } from "./StyleReattach";

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

  it("clear() removes all registrations", () => {
    const registry = new StyleReattach();
    registry.register("a", vi.fn());
    registry.register("b", vi.fn());
    registry.clear();
    expect(registry.has("a")).toBe(false);
    expect(registry.has("b")).toBe(false);
  });
});
