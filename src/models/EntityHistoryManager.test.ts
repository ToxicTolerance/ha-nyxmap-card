import { describe, expect, it, vi } from "vitest";
import { EntityConfig } from "../configs/EntityConfig";
import { MapConfig } from "../configs/MapConfig";
import { colorFromString } from "../maplibre/MarkerFactory";
import { EntityHistoryManager } from "./EntityHistoryManager";

const NOW = new Date("2026-07-18T12:00:00.000Z");

describe("EntityHistoryManager.refresh", () => {
  it("skips entities with no history_start at either level", async () => {
    const manager = new EntityHistoryManager();
    const fetchPath = vi.fn();
    const result = await manager.refresh(
      [EntityConfig.from("device_tracker.phone")],
      new MapConfig({}),
      fetchPath,
      NOW,
    );

    expect(result.has("device_tracker.phone")).toBe(false);
    expect(fetchPath).not.toHaveBeenCalled();
  });

  it("uses the card-level history_start when the entity doesn't define one", async () => {
    const manager = new EntityHistoryManager();
    const fetchPath = vi.fn().mockResolvedValue([]);
    const mapConfig = new MapConfig({ history_start: "1 hour ago" });

    await manager.refresh([EntityConfig.from("device_tracker.phone")], mapConfig, fetchPath, NOW);

    expect(fetchPath).toHaveBeenCalledWith(
      "device_tracker.phone",
      new Date("2026-07-18T11:00:00.000Z"),
      NOW,
    );
  });

  it("prefers the entity-level history_start over the card-level one", async () => {
    const manager = new EntityHistoryManager();
    const fetchPath = vi.fn().mockResolvedValue([]);
    const mapConfig = new MapConfig({ history_start: "1 hour ago" });
    const entity = EntityConfig.from({ entity: "device_tracker.phone", history_start: "5 hours ago" });

    await manager.refresh([entity], mapConfig, fetchPath, NOW);

    expect(fetchPath).toHaveBeenCalledWith(
      "device_tracker.phone",
      new Date("2026-07-18T07:00:00.000Z"),
      NOW,
    );
  });

  it("resolves history_end when set, and falls back to `now` otherwise", async () => {
    const manager = new EntityHistoryManager();
    const fetchPath = vi.fn().mockResolvedValue([]);
    const entity = EntityConfig.from({
      entity: "device_tracker.phone",
      history_start: "1 day ago",
      history_end: "1 hour ago",
    });

    await manager.refresh([entity], new MapConfig({}), fetchPath, NOW);

    expect(fetchPath).toHaveBeenCalledWith(
      "device_tracker.phone",
      new Date("2026-07-17T12:00:00.000Z"),
      new Date("2026-07-18T11:00:00.000Z"),
    );
  });

  it("skips an entity whose history_start is an unresolvable entity-value ref", async () => {
    const manager = new EntityHistoryManager();
    const fetchPath = vi.fn();
    const entity = EntityConfig.from({
      entity: "device_tracker.phone",
      history_start: "input_number.hours",
    });

    const result = await manager.refresh([entity], new MapConfig({}), fetchPath, NOW);

    expect(result.has("device_tracker.phone")).toBe(false);
    expect(fetchPath).not.toHaveBeenCalled();
  });

  it("wraps the fetched coordinates and line color into an EntityHistory", async () => {
    const manager = new EntityHistoryManager();
    const coords: Array<[number, number]> = [
      [1, 2],
      [3, 4],
    ];
    const fetchPath = vi.fn().mockResolvedValue(coords);
    const entity = EntityConfig.from({
      entity: "device_tracker.phone",
      history_start: "1 hour ago",
      history_line_color: "#123456",
    });

    const result = await manager.refresh([entity], new MapConfig({}), fetchPath, NOW);

    const history = result.get("device_tracker.phone")!;
    expect(history.coordinates).toEqual(coords);
    expect(history.lineColor).toBe("#123456");
    expect(history.hasPath).toBe(true);
  });

  it("threads the card-level history_show_lines/history_show_dots onto each EntityHistory", async () => {
    const manager = new EntityHistoryManager();
    const fetchPath = vi.fn().mockResolvedValue([]);
    const entity = EntityConfig.from({ entity: "device_tracker.phone", history_start: "1 hour ago" });
    const mapConfig = new MapConfig({
      history_start: "1 hour ago",
      history_show_lines: false,
      history_show_dots: true,
    });

    const result = await manager.refresh([entity], mapConfig, fetchPath, NOW);

    const history = result.get("device_tracker.phone")!;
    expect(history.showLines).toBe(false);
    expect(history.showDots).toBe(true);
  });

  it("defaults the line color from the entity id when unset", async () => {
    const manager = new EntityHistoryManager();
    const fetchPath = vi.fn().mockResolvedValue([]);
    const entity = EntityConfig.from({ entity: "device_tracker.phone", history_start: "1 hour ago" });

    const result = await manager.refresh([entity], new MapConfig({}), fetchPath, NOW);

    expect(result.get("device_tracker.phone")!.lineColor).toBe(colorFromString("device_tracker.phone"));
  });
});
