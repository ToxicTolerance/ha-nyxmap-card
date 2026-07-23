import { describe, expect, it, vi } from "vitest";
import type { HomeAssistant } from "../types/home-assistant";
import { HaUrlResolveService } from "./HaUrlResolveService";

function hassWith(states: HomeAssistant["states"]): HomeAssistant {
  return { states, callWS: vi.fn(), language: "en" };
}

describe("HaUrlResolveService", () => {
  it("resolves a states() token to the entity's current state", () => {
    const resolver = new HaUrlResolveService(
      hassWith({ "input_datetime.radar_time": { entity_id: "input_datetime.radar_time", state: "2026-07-19T12:00:00", attributes: {}, last_changed: "", last_updated: "" } }),
    );

    // The state is percent-encoded on substitution, so the `:` in the ISO
    // timestamp comes out as %3A — this test previously asserted the raw value,
    // which encoded the bug the encodeURIComponent fix closes.
    expect(resolver.resolveUrl("https://example.com/wms?TIME={{ states('input_datetime.radar_time') }}")).toBe(
      "https://example.com/wms?TIME=2026-07-19T12%3A00%3A00",
    );
  });

  it("percent-encodes url-significant characters in the substituted state", () => {
    const resolver = new HaUrlResolveService(
      hassWith({ "sensor.x": { entity_id: "sensor.x", state: "a&b=c/d ?e", attributes: {}, last_changed: "", last_updated: "" } }),
    );

    expect(resolver.resolveUrl("https://example.com/tiles?q={{ states('sensor.x') }}")).toBe(
      "https://example.com/tiles?q=a%26b%3Dc%2Fd%20%3Fe",
    );
  });

  it("resolves multiple tokens in the same url", () => {
    const resolver = new HaUrlResolveService(
      hassWith({
        "sensor.a": { entity_id: "sensor.a", state: "1", attributes: {}, last_changed: "", last_updated: "" },
        "sensor.b": { entity_id: "sensor.b", state: "2", attributes: {}, last_changed: "", last_updated: "" },
      }),
    );

    expect(resolver.resolveUrl("https://example.com?a={{states('sensor.a')}}&b={{states('sensor.b')}}")).toBe(
      "https://example.com?a=1&b=2",
    );
  });

  it("resolves to an empty string when the entity doesn't exist", () => {
    const resolver = new HaUrlResolveService(hassWith({}));

    expect(resolver.resolveUrl("https://example.com?x={{ states('sensor.missing') }}")).toBe(
      "https://example.com?x=",
    );
  });

  it("leaves a url with no tokens untouched", () => {
    const resolver = new HaUrlResolveService(hassWith({}));

    expect(resolver.resolveUrl("https://example.com/{z}/{x}/{y}.png")).toBe(
      "https://example.com/{z}/{x}/{y}.png",
    );
  });

  it("tolerates single or double quotes around the entity id", () => {
    const resolver = new HaUrlResolveService(
      hassWith({ "sensor.a": { entity_id: "sensor.a", state: "1", attributes: {}, last_changed: "", last_updated: "" } }),
    );

    expect(resolver.resolveUrl(`https://example.com?a={{ states("sensor.a") }}`)).toBe("https://example.com?a=1");
  });
});
