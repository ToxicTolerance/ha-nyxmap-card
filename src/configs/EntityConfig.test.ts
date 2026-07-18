import { describe, expect, it } from "vitest";
import { EntityConfig } from "./EntityConfig";

describe("EntityConfig", () => {
  it("parses a bare entity-id string into a marker-display config with defaults", () => {
    const cfg = EntityConfig.from("device_tracker.phone");
    expect(cfg.id).toBe("device_tracker.phone");
    expect(cfg.display).toBe("marker");
    expect(cfg.size).toBe(48);
    expect(cfg.zIndexOffset).toBe(1);
    expect(cfg.picture).toBeUndefined();
  });

  it("parses a full object config", () => {
    const cfg = EntityConfig.from({
      entity: "person.alice",
      display: "icon",
      icon: "mdi:account",
      color: "#ff0000",
      size: 64,
      fixed_x: 1.5,
      fixed_y: 2.5,
      z_index_offset: 3,
    });
    expect(cfg.id).toBe("person.alice");
    expect(cfg.display).toBe("icon");
    expect(cfg.icon).toBe("mdi:account");
    expect(cfg.color).toBe("#ff0000");
    expect(cfg.size).toBe(64);
    expect(cfg.fixedX).toBe(1.5);
    expect(cfg.fixedY).toBe(2.5);
    expect(cfg.zIndexOffset).toBe(3);
  });

  it("defaults history_line_color to the entity color when unset", () => {
    const cfg = EntityConfig.from({ entity: "person.alice", color: "#00ff00" });
    expect(cfg.historyLineColor).toBe("#00ff00");
  });

  it("prefers an explicit history_line_color over the entity color", () => {
    const cfg = EntityConfig.from({
      entity: "person.alice",
      color: "#00ff00",
      history_line_color: "#0000ff",
    });
    expect(cfg.historyLineColor).toBe("#0000ff");
  });

  it("throws when entity id is missing", () => {
    // @ts-expect-error deliberately malformed config
    expect(() => EntityConfig.from({})).toThrow();
  });
});
