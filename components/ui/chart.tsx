"use client";

/**
 * components/ui/chart.tsx
 *
 * Thin wrapper over `echarts-for-react` that imports only the ECharts
 * modules the dashboard actually uses (line / bar + tooltip / grid /
 * legend / canvas), keeping the client bundle far smaller than the full
 * `echarts` umbrella import.
 *
 * Default styling: 240–280px tall, transparent background (so design tokens
 * show through), monospace-ish tooltips. Consumers pass a `title` for the
 * card frame and `option` for the ECharts spec.
 */

import { use as echartsUse } from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
  DataZoomComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import ReactECharts from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { useEffect, useState } from "react";

// Register every ECharts module we use BEFORE any component mounts. Doing
// this lazily inside useEffect causes "Q[l] is not a constructor" - ECharts
// instantiates the chart on first render, before any effect runs, so the
// chart-type constructors must already be registered at that point.
echartsUse([
  BarChart,
  LineChart,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
  DataZoomComponent,
  CanvasRenderer,
]);

interface ChartProps {
  option: EChartsOption;
  /** Height in px. Default 280. */
  height?: number;
  className?: string;
}

/**
 * Series colors. One accent plus grays, so a chart reads as "the thing" and
 * its context; success/destructive are reserved for series that mean
 * success or failure and are set per series by the caller.
 */
const DEFAULT_PALETTE = ["var(--primary)", "var(--muted-foreground)", "var(--input)"];

/**
 * Options are built on the server and arrive as plain data, so they name
 * colors as design tokens - `"var(--success)"` - and this resolves every such
 * string against the active theme before ECharts (a canvas, blind to CSS
 * variables) sees it.
 */
function resolveTokens<T>(value: T, root: CSSStyleDeclaration): T {
  if (typeof value === "string") {
    const m = /^var\((--[a-z0-9-]+)\)$/.exec(value);
    return (m ? root.getPropertyValue(m[1]!).trim() || value : value) as T;
  }
  if (Array.isArray(value)) {
    return (value as unknown[]).map((v) => resolveTokens(v, root)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, resolveTokens(v, root)]),
    ) as T;
  }
  return value;
}

export function Chart({ option, height = 280, className = "" }: ChartProps) {
  // Null until mounted: the tokens only resolve in the browser, and ECharts
  // only draws there anyway. The sized box holds the layout meanwhile.
  const [resolved, setResolved] = useState<EChartsOption | null>(null);

  // Resolve after mount and again whenever the theme attribute flips.
  useEffect(() => {
    const update = () => {
      const root = getComputedStyle(document.documentElement);
      const font = getComputedStyle(document.body).fontFamily;
      setResolved(resolveTokens(withThemeDefaults(option, font), root));
    };
    update();
    const obs = new MutationObserver(update);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => obs.disconnect();
  }, [option]);

  return (
    <div className={className} style={{ height }}>
      {resolved ? (
        <ReactECharts
          echarts={echarts}
          option={resolved}
          style={{ height: "100%", width: "100%" }}
          notMerge
          lazyUpdate
          opts={{ renderer: "canvas" }}
        />
      ) : null}
    </div>
  );
}

/** The axis keys this file themes - every ECharts axis option has them. */
interface AxisLike {
  axisLine?: object;
  axisTick?: object;
  axisLabel?: object;
  nameTextStyle?: object;
}

/** Token colors for an axis (or axis list), under whatever the caller set. */
function themeAxis<T>(axis: T): T {
  if (axis === undefined) return axis;
  const one = (a: AxisLike): AxisLike => ({
    ...a,
    axisLine: { lineStyle: { color: "var(--border)" }, ...a.axisLine },
    axisTick: { lineStyle: { color: "var(--border)" }, ...a.axisTick },
    axisLabel: { color: "var(--muted-foreground)", ...a.axisLabel },
    nameTextStyle: { color: "var(--muted-foreground)", ...a.nameTextStyle },
  });
  return (Array.isArray(axis) ? (axis as AxisLike[]).map(one) : one(axis as AxisLike)) as T;
}

/**
 * Merge theme defaults - palette, fonts, axis and tooltip colors - under the
 * caller's option. There is no legend unless a caller asks for one: series
 * are named by direct labels (end labels on lines, value labels on bars),
 * which also keeps the x-axis free of an overlapping legend row.
 */
function withThemeDefaults(option: EChartsOption, font: string): EChartsOption {
  return {
    backgroundColor: "transparent",
    textStyle: { color: "var(--muted-foreground)", fontFamily: font },
    color: DEFAULT_PALETTE,
    ...option,
    legend: { show: false, ...(option.legend as object) },
    xAxis: themeAxis(option.xAxis),
    yAxis: themeAxis(option.yAxis),
    tooltip: {
      backgroundColor: "var(--card)",
      borderColor: "var(--border)",
      borderWidth: 1,
      textStyle: { color: "var(--foreground)", fontSize: 12 },
      ...(option.tooltip ?? {}),
    },
    grid: {
      left: 40,
      right: 16,
      top: 28,
      bottom: 28,
      containLabel: true,
      ...(option.grid ?? {}),
    },
  };
}
