/**
 * ECharts rendering. Imports the tree-shaken `echarts/core` build and
 * registers only what isopleth emits: line, bar, scatter, heatmap and custom
 * series; grid, dataset, tooltip, legend, title, dataZoom, visualMap,
 * markLine/markPoint/markArea; axis breaks; both renderers.
 */

import * as echarts from "echarts/core";
import { BarChart, CustomChart, HeatmapChart, LineChart, ScatterChart } from "echarts/charts";
import {
  AxisPointerComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  TitleComponent,
  ToolboxComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { AxisBreak, LabelLayout, ScatterJitter, UniversalTransition } from "echarts/features";
import { CanvasRenderer, SVGRenderer } from "echarts/renderers";
import type { Chart, ChartInstance, RenderOptions } from "./chart.js";

let registered = false;

/** Register the ECharts modules isopleth needs (idempotent). Call this if you create your own instances. */
export function registerECharts(): void {
  if (registered) return;
  registered = true;
  echarts.use([
    LineChart,
    BarChart,
    ScatterChart,
    HeatmapChart,
    CustomChart,
    GridComponent,
    TooltipComponent,
    AxisPointerComponent,
    LegendComponent,
    TitleComponent,
    DataZoomComponent,
    VisualMapComponent,
    MarkLineComponent,
    MarkPointComponent,
    MarkAreaComponent,
    ToolboxComponent,
    AxisBreak,
    ScatterJitter,
    LabelLayout,
    UniversalTransition,
    CanvasRenderer,
    SVGRenderer,
  ]);
}

interface Entry {
  chart: ChartInstance;
  /** The chart currently shown (re-renders swap it). */
  source: Chart;
  /** Serialized grid last applied, so refits only call `setOption` when the layout changes. */
  gridKey: string;
  cleanup: () => void;
}

const instances = new WeakMap<HTMLElement, Entry>();

/** Render a compiled chart into `element`. Re-rendering into the same element reuses the instance. */
export function renderChart(chart: Chart, element: HTMLElement, opts: RenderOptions = {}): ChartInstance {
  registerECharts();
  // The compiled option carries every colour, so no ECharts theme is needed; `opts.theme` can still name a registered one.
  let entry = instances.get(element);
  if (!entry) {
    const inst = echarts.init(element, opts.theme as string | undefined, {
      renderer: opts.renderer ?? "canvas",
      width: opts.width ?? chart.options.width,
      height: opts.height ?? chart.options.height,
      devicePixelRatio: opts.devicePixelRatio,
    }) as unknown as ChartInstance;
    const created: Entry = { chart: inst, source: chart, gridKey: "", cleanup: () => {} };
    if (opts.autoResize !== false && typeof window !== "undefined") {
      const onResize = () => {
        inst.resize();
        fitGrid(created);
      };
      const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onResize) : undefined;
      if (ro) ro.observe(element);
      else window.addEventListener("resize", onResize);
      created.cleanup = () => {
        ro?.disconnect();
        window.removeEventListener("resize", onResize);
      };
    }
    entry = created;
    instances.set(element, entry);
  }
  entry.source = chart;
  entry.chart.setOption(chart.option, { notMerge: true, ...(opts.setOption ?? {}) });
  entry.gridKey = JSON.stringify(chart.option.grid);
  fitGrid(entry);
  return entry.chart;
}

/** Recompute the grid for the measured height: default margins shrink on short charts. */
function fitGrid(entry: Entry): void {
  const height = entry.chart.getHeight();
  if (!height) return;
  const grid = entry.source.internals.gridFor(height);
  const key = JSON.stringify(grid);
  if (key === entry.gridKey) return;
  entry.gridKey = key;
  entry.chart.setOption({ grid });
}

/** Dispose the ECharts instance bound to `element` (if any). */
export function disposeChart(element: HTMLElement): void {
  const entry = instances.get(element);
  if (!entry) return;
  entry.cleanup();
  entry.chart.dispose();
  instances.delete(element);
}

/** Server-side / test rendering to an SVG string (no DOM needed). */
export function renderSVG(chart: Chart, opts: { width?: number; height?: number } = {}): string {
  registerECharts();
  const inst = echarts.init(null, undefined, {
    renderer: "svg",
    ssr: true,
    width: opts.width ?? chart.options.width ?? 640,
    height: opts.height ?? chart.options.height ?? 400,
  });
  inst.setOption({ ...chart.option, animation: false });
  const svg = inst.renderToSVGString();
  inst.dispose();
  return svg;
}

export { echarts };
