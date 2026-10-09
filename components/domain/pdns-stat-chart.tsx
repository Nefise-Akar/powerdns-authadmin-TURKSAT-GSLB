"use client";

/**
 * Chart wrappers tuned for the per-server PDNS statistics we capture in
 * `pdns_server_stats`. Three shapes:
 *
 *   `<CounterRateChart>` - takes the raw (ts, value) samples of a
 *     cumulative counter and plots the per-second delta line. Suitable
 *     for `udp4-queries`, `query-cache-hit`, etc.
 *
 *   `<ValueLineChart>` - plots point-in-time values as they are.
 *
 *   `<MapBarChart>` - takes the latest `MapStatisticItem` snapshot
 *     (`[{name, value}, ...]`) and renders a sorted horizontal bar list.
 *     Suitable for `response-by-qtype`, `response-by-rcode`,
 *     `response-sizes`.
 *
 * Single-series lines in the accent color, no area fill, the latest value
 * written at the line's end; bars carry their value - no legends.
 */

/** Template label: the point's value (dimension 1 of a `[ts, value]` pair). */
const END_LABEL = { show: true, formatter: "{@[1]}", color: "var(--foreground)", fontSize: 11 };

/** Two decimals is plenty for a rate on a chart label. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

import { Chart } from "@/components/ui/chart";

interface Sample {
  ts: string;
  value: number;
}

interface CounterRateChartProps {
  /** Oldest first. `value` is the cumulative counter as stored. */
  samples: Sample[];
  /** Display label for the legend / tooltip. */
  label: string;
  height?: number;
  /** Y-axis title - e.g. "queries / s", "ms". Defaults to a generic "rate". */
  yAxisLabel?: string;
}

/**
 * Delta the cumulative counter between consecutive samples and divide by
 * the elapsed seconds. Drops any data point where the counter resets
 * (PDNS process restart → value resets to 0 → delta is huge negative);
 * we treat negative deltas as gaps.
 */
export function CounterRateChart({
  samples,
  label,
  height = 200,
  yAxisLabel,
}: CounterRateChartProps) {
  const points: Array<[string, number]> = [];
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1]!;
    const cur = samples[i]!;
    const dt = (new Date(cur.ts).getTime() - new Date(prev.ts).getTime()) / 1000;
    if (dt <= 0) continue;
    const dv = cur.value - prev.value;
    if (dv < 0) continue;
    points.push([cur.ts, round2(dv / dt)]);
  }
  return (
    <Chart
      height={height}
      option={{
        // Single-series card - the series name is redundant with the card
        // title, and a default legend overlaps the x-axis labels. Hide it.
        legend: { show: false },
        tooltip: { trigger: "axis" },
        xAxis: {
          type: "time",
          axisLabel: { fontSize: 10, hideOverlap: true },
          splitLine: { show: false },
        },
        yAxis: {
          type: "value",
          // Unit sits at the top of the axis (e.g. "q/s"). nameGap + the grid
          // top margin below keep it inside the canvas instead of clipped.
          name: yAxisLabel ?? "",
          nameLocation: "end",
          nameGap: 10,
          nameTextStyle: { fontSize: 10, align: "left" },
          axisLabel: { fontSize: 10 },
          minInterval: 1,
          splitLine: { show: false },
        },
        series: [
          {
            type: "line",
            name: label,
            data: points,
            showSymbol: false,
            smooth: true,
            lineStyle: { width: 1.5 },
            endLabel: END_LABEL,
          },
        ],
        // containLabel (from the Chart wrapper) reserves room for tick labels
        // but not the end label, hence the wider right margin. top:22 is
        // headroom for the axis-name unit.
        grid: { left: 6, right: 44, top: 22, bottom: 6 },
      }}
    />
  );
}

interface ValueLineChartProps {
  samples: Sample[];
  label: string;
  height?: number;
  yAxisLabel?: string;
}

/** Plot the raw values (no rate diff) - useful for gauges like `latency`,
 *  `cpu-iowait`, `fd-usage` that are point-in-time, not counters. */
export function ValueLineChart({ samples, label, height = 200, yAxisLabel }: ValueLineChartProps) {
  const points = samples.map((s) => [s.ts, round2(s.value)] as [string, number]);
  return (
    <Chart
      height={height}
      option={{
        legend: { show: false },
        tooltip: { trigger: "axis" },
        xAxis: {
          type: "time",
          axisLabel: { fontSize: 10, hideOverlap: true },
          splitLine: { show: false },
        },
        yAxis: {
          type: "value",
          name: yAxisLabel ?? "",
          nameLocation: "end",
          nameGap: 10,
          nameTextStyle: { fontSize: 10, align: "left" },
          axisLabel: { fontSize: 10 },
          splitLine: { show: false },
        },
        series: [
          {
            type: "line",
            name: label,
            data: points,
            showSymbol: false,
            smooth: true,
            lineStyle: { width: 1.5 },
            endLabel: END_LABEL,
          },
        ],
        grid: { left: 6, right: 44, top: 22, bottom: 6 },
      }}
    />
  );
}

interface MapBarChartProps {
  /** Latest `MapStatisticItem.value` - array of name/value pairs. */
  entries: Array<{ name: string; value: string }>;
  height?: number;
  /** Hide buckets whose value is 0 (PDNS sends a bunch of zero-rcode rows). */
  hideZeros?: boolean;
  /**
   * By default bars are sorted by value (largest first) - right for
   * categorical maps like qtype/rcode. Set this to keep the caller's
   * order instead, for data that has a meaningful sequence of its own
   * (e.g. response-size buckets, which read best ordered by size).
   */
  preserveOrder?: boolean;
}

export function MapBarChart({
  entries,
  height = 240,
  hideZeros = true,
  preserveOrder = false,
}: MapBarChartProps) {
  const mapped = entries
    .map((e) => ({ name: e.name, value: Number(e.value) || 0 }))
    .filter((d) => (hideZeros ? d.value > 0 : true));
  const data = preserveOrder ? mapped : mapped.sort((a, b) => b.value - a.value);
  return (
    <Chart
      height={height}
      option={{
        tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, confine: true },
        grid: { left: 6, right: 56, top: 6, bottom: 6 },
        xAxis: { type: "value", show: false },
        yAxis: {
          type: "category",
          data: data.map((d) => d.name),
          inverse: true,
          axisTick: { show: false },
          // Long rcode names ("Server Not Authoritative for zone / Not
          // Authorized") truncate with an ellipsis; the tooltip has the rest.
          axisLabel: { fontSize: 11, width: 110, overflow: "truncate" },
        },
        series: [
          {
            type: "bar",
            data: data.map((d) => d.value),
            barMaxWidth: 14,
            itemStyle: { borderRadius: [0, 2, 2, 0] },
            label: { show: true, position: "right", color: "var(--foreground)", fontSize: 11 },
          },
        ],
      }}
    />
  );
}
