/**
 * app/(app)/dashboard/_components/chart-options.ts
 *
 * Pure ECharts option builders for the dashboard. Server-rendered and
 * serializable - each takes already-fetched rows and returns a plain option
 * object shipped as a prop to the `<Chart>` client wrapper. Extracted from
 * page.tsx to keep the page focused on data-fetching + layout.
 *
 * Charts use the `<Chart>` palette (one accent + grays) and name series with
 * direct labels instead of a legend: lines carry their latest value (and,
 * with several series, their name) at the end; bars carry their value. Since
 * the options must stay serializable, labels use ECharts template strings
 * (`{@[1]}` = the point's value) rather than formatter functions. Colors are
 * design tokens (`var(--success)`), resolved by `<Chart>` in the browser.
 */

/** Room on the right for a line's end label. */
const END_LABEL_ROOM = 44;
/** …and for "name value" end labels when several series share a chart. */
const NAMED_END_LABEL_ROOM = 150;

const VALUE_END_LABEL = {
  show: true,
  formatter: "{@[1]}",
  color: "var(--foreground)",
  fontSize: 12,
};

/** Horizontal bars, largest first, each labelled with its value. */
function barListOption(rows: Array<{ name: string; value: number }>, seriesName: string) {
  const sorted = rows.slice().sort((a, b) => b.value - a.value);
  return {
    tooltip: { trigger: "axis" as const, axisPointer: { type: "shadow" as const } },
    grid: { left: 8, right: END_LABEL_ROOM, top: 8, bottom: 8 },
    xAxis: { type: "value" as const, show: false },
    yAxis: {
      type: "category" as const,
      data: sorted.map((r) => r.name),
      inverse: true,
      axisTick: { show: false },
      axisLabel: { width: 140, overflow: "truncate" as const },
    },
    series: [
      {
        name: seriesName,
        type: "bar" as const,
        data: sorted.map((r) => r.value),
        barMaxWidth: 16,
        itemStyle: { borderRadius: [0, 2, 2, 0] },
        label: {
          show: true,
          position: "right" as const,
          color: "var(--foreground)",
          fontSize: 12,
        },
      },
    ],
  };
}

import type { HourlyBucket } from "@/lib/db/repositories/dashboard";

/** Fill missing hours with 0 so line charts show continuous time. Buckets
 *  align on UTC hours to match the database's `date_trunc('hour', ts)`. */
function fillHourly(rows: HourlyBucket[], hours: number): Array<{ hour: Date; count: number }> {
  const map = new Map<number, number>();
  for (const row of rows) {
    const h = startOfHourUtc(new Date(row.bucket)).getTime();
    map.set(h, (map.get(h) ?? 0) + row.count);
  }
  const out: Array<{ hour: Date; count: number }> = [];
  const end = startOfHourUtc(new Date());
  for (let i = hours - 1; i >= 0; i--) {
    const hour = new Date(end.getTime() - i * 3600 * 1000);
    out.push({ hour, count: map.get(hour.getTime()) ?? 0 });
  }
  return out;
}

function startOfHourUtc(d: Date): Date {
  const out = new Date(d);
  out.setUTCMinutes(0, 0, 0);
  return out;
}

/**
 * `color` is for a series that carries meaning - `"var(--success)"` for
 * successful logins; anything else keeps the accent.
 */
export function hourlyLineOption(
  rows: HourlyBucket[],
  hours: number,
  label: string,
  color?: string,
) {
  const filled = fillHourly(rows, hours);
  return {
    tooltip: { trigger: "axis" as const },
    grid: { right: END_LABEL_ROOM },
    // `type: "time"` lets ECharts format every tick label in the
    // BROWSER's local timezone - the server is upstream of timezone
    // decisions and shouldn't be baking "08:00" into category labels.
    // Data points are [iso-string, count] pairs; the browser places
    // them on the time axis and produces local-zone tick labels.
    xAxis: {
      // No `boundaryGap` on a time axis - it isn't a category axis, and
      // echarts 6 types it as a tuple there. Time axes place points exactly.
      type: "time" as const,
      splitLine: { show: false },
    },
    yAxis: {
      type: "value" as const,
      minInterval: 1,
      splitLine: { show: false },
    },
    series: [
      {
        name: label,
        type: "line" as const,
        smooth: true,
        symbol: "none" as const,
        ...(color ? { color } : {}),
        endLabel: VALUE_END_LABEL,
        data: filled.map((row) => [row.hour.toISOString(), row.count]),
      },
    ],
  };
}

export function multiSeriesOption(
  rows: Array<{
    serverSlug: string;
    serverName: string;
    sampledAt: Date;
    zoneCount: number | null;
    latencyP95Ms: number | null;
  }>,
  field: "zoneCount" | "latencyP95Ms",
  axisLabel: string,
) {
  const bySlug = new Map<string, { name: string; data: Array<[string, number]> }>();
  for (const row of rows) {
    const value = row[field];
    if (value === null || value === undefined) continue;
    const entry =
      bySlug.get(row.serverSlug) ??
      bySlug.set(row.serverSlug, { name: row.serverName, data: [] }).get(row.serverSlug)!;
    entry.data.push([new Date(row.sampledAt).toISOString(), value]);
  }
  const named = bySlug.size > 1;
  const series = Array.from(bySlug.values()).map((entry) => ({
    name: entry.name,
    type: "line" as const,
    smooth: true,
    symbol: "none" as const,
    endLabel: named ? { ...VALUE_END_LABEL, formatter: "{a}  {@[1]}" } : VALUE_END_LABEL,
    data: entry.data,
  }));

  return {
    tooltip: { trigger: "axis" as const },
    grid: { right: named ? NAMED_END_LABEL_ROOM : END_LABEL_ROOM },
    xAxis: { type: "time" as const, splitLine: { show: false } },
    yAxis: { type: "value" as const, name: axisLabel, splitLine: { show: false } },
    series,
  };
}

export function topActorsOption(
  rows: Array<{ email: string; name: string | null; count: number }>,
) {
  return barListOption(
    rows.map((r) => ({ name: r.name ?? r.email, value: r.count })),
    "Events",
  );
}

/** Action breakdown as a sorted bar list (a donut needed a legend to read). */
export function actionBarsOption(rows: Array<{ action: string; count: number }>) {
  return barListOption(
    rows.map((r) => ({ name: r.action, value: r.count })),
    "Events",
  );
}

/**
 * PDNS reports `response-sizes` as a fine-grained histogram (one bucket
 * per ~20–400 byte step), which makes a dozen tiny numeric bars. Collapse
 * those into a handful of human-readable size ranges and emit them
 * largest-first so the chart reads as a clean, ordered size distribution.
 * Returns the MapBarChart `entries` shape (value as a string); pair with
 * `preserveOrder` so the chart keeps this size order instead of re-sorting
 * by count.
 */
const RESPONSE_SIZE_BUCKETS: Array<{ label: string; max: number }> = [
  { label: "≤ 64 B", max: 64 },
  { label: "65–128 B", max: 128 },
  { label: "129–256 B", max: 256 },
  { label: "257–512 B", max: 512 },
  { label: "513 B – 1 KB", max: 1024 },
  { label: "1 – 2 KB", max: 2048 },
  { label: "> 2 KB", max: Infinity },
];

export function bucketResponseSizes(
  entries: Array<{ name: string; value: string }>,
): Array<{ name: string; value: string }> {
  const sums = new Map<string, number>();
  for (const e of entries) {
    const size = Number(e.name);
    const count = Number(e.value) || 0;
    if (!Number.isFinite(size) || count <= 0) continue;
    const bucket =
      RESPONSE_SIZE_BUCKETS.find((b) => size <= b.max) ??
      RESPONSE_SIZE_BUCKETS[RESPONSE_SIZE_BUCKETS.length - 1]!;
    sums.set(bucket.label, (sums.get(bucket.label) ?? 0) + count);
  }
  // Walk the buckets large→small so the bars are size-ordered
  // (descending), dropping any range with no traffic.
  return RESPONSE_SIZE_BUCKETS.slice()
    .reverse()
    .filter((b) => sums.has(b.label))
    .map((b) => ({ name: b.label, value: String(sums.get(b.label)!) }));
}

export function sessionsOption(rows: Array<{ sampledAt: Date; activeSessions: number }>) {
  return {
    tooltip: { trigger: "axis" as const },
    grid: { right: END_LABEL_ROOM },
    xAxis: { type: "time" as const, splitLine: { show: false } },
    yAxis: { type: "value" as const, minInterval: 1, splitLine: { show: false } },
    series: [
      {
        name: "Active sessions",
        type: "line" as const,
        smooth: true,
        symbol: "none" as const,
        endLabel: VALUE_END_LABEL,
        data: rows.map((row) => [new Date(row.sampledAt).toISOString(), row.activeSessions]),
      },
    ],
  };
}
