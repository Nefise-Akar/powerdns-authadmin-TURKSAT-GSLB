import { describe, expect, it } from "vitest";
import { multiSeriesOption } from "./chart-options";

const at = new Date("2026-11-01T10:00:00Z");
const row = (serverSlug: string, zoneCount: number) => ({
  serverSlug,
  serverName: serverSlug,
  sampledAt: at,
  zoneCount,
  latencyP95Ms: 12,
});

describe("multiSeriesOption", () => {
  it("stacks the end labels of several backends instead of overlapping them", () => {
    const option = multiSeriesOption(
      [row("golbasi", 49), row("macunkoy", 49)],
      "zoneCount",
      "Zones",
    );
    expect(option.series).toHaveLength(2);
    for (const s of option.series) {
      expect(s).toMatchObject({ labelLayout: { moveOverlap: "shiftY" } });
      expect(s.endLabel).toMatchObject({ formatter: "{@[1]}  {a}", overflow: "truncate" });
    }
  });

  it("keeps a single backend's plain value label", () => {
    const option = multiSeriesOption([row("golbasi", 49)], "zoneCount", "Zones");
    expect(option.series[0]).not.toHaveProperty("labelLayout");
    expect(option.series[0]!.endLabel.formatter).toBe("{@[1]}");
  });
});
