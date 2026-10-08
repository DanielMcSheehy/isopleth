/** `plot()` and the `Chart` it returns. */

import type { EChartsOption } from "echarts";
import type { Insight, Mark, Markish, PlotOptions } from "./types.js";
import { compile, type Compiled } from "./compile/index.js";
import type { Scales } from "./compile/scales.js";
import type { Theme } from "./theme.js";

export interface RenderOptions {
  /** `"canvas"` (default) or `"svg"`. */
  renderer?: "canvas" | "svg";
  /** Override the theme passed to `echarts.init`. */
  theme?: string | Record<string, unknown>;
  width?: number;
  height?: number;
  /** Re-render on window resize (default true). */
  autoResize?: boolean;
  /** Pass `{ notMerge: true }` etc. to `setOption`. */
  setOption?: Record<string, unknown>;
  devicePixelRatio?: number;
}

/** Minimal shape of an ECharts instance we rely on (keeps `echarts` a peer dependency). */
export interface ChartInstance {
  setOption(option: unknown, opts?: unknown): void;
  resize(opts?: unknown): void;
  dispose(): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
  off(event: string, handler?: (...args: unknown[]) => void): void;
  getDom(): HTMLElement;
  renderToSVGString?(opts?: unknown): string;
}

/** A compiled chart: an ECharts option plus the insights that were computed. */
export class Chart {
  readonly option: EChartsOption;
  readonly insights: Insight[];
  readonly warnings: string[];
  readonly marks: Mark[];
  readonly scales: Scales;
  readonly theme: Theme;
  readonly options: PlotOptions;
  private compiled: Compiled;

  constructor(options: PlotOptions, compiled: Compiled) {
    this.options = options;
    this.compiled = compiled;
    this.option = compiled.option;
    this.insights = compiled.insights;
    this.warnings = compiled.warnings;
    this.marks = compiled.marks;
    this.scales = compiled.scales;
    this.theme = compiled.theme;
  }

  /** The ECharts option (for `chart.setOption(...)` with your own instance). */
  toOption(): EChartsOption {
    return this.option;
  }

  /** Human-readable insight summaries. */
  describe(): string[] {
    return this.insights.map((i) => i.summary);
  }

  /** Render into a DOM element with ECharts (loads `echarts/core` + components). */
  async render(element: HTMLElement, opts: RenderOptions = {}): Promise<ChartInstance> {
    const { renderChart } = await import("./render.js");
    return renderChart(this, element, opts);
  }

  /** Render to an SVG string without a DOM (server-side / tests). */
  async toSVG(opts: { width?: number; height?: number } = {}): Promise<string> {
    const { renderSVG } = await import("./render.js");
    return renderSVG(this, opts);
  }

  /** Re-compile with changed options (e.g. a new theme or more marks). */
  with(patch: Partial<PlotOptions>): Chart {
    return plot({ ...this.options, ...patch });
  }

  /** Internal compile result (resolved marks, facet plan). */
  get internals(): Compiled {
    return this.compiled;
  }
}

/**
 * Compile marks into a chart.
 *
 * ```ts
 * const chart = plot({
 *   marks: [lineY(data, { x: "date", y: "value", stroke: "series" }), ruleY([0])],
 *   insights: { anomalies: true, forecast: { horizon: 30 } },
 * });
 * await chart.render(document.querySelector("#chart"));
 * ```
 */
export function plot(options: PlotOptions | Markish): Chart {
  const o: PlotOptions = isPlotOptions(options) ? options : { marks: options as Markish[] };
  return new Chart(o, compile(o));
}

function isPlotOptions(v: unknown): v is PlotOptions {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !("type" in v && "data" in v);
}
