/**
 * `isopleth/editor` — an optional, framework-free panel for composing a chart
 * interactively: mark type, encodings (x / y / aggregate / colour / size /
 * facet), composition (stack, smoothing, time interval, curve), insights,
 * per-series colours and theme. It edits a `ChartSpec` and re-renders the
 * chart on every change; `specToCode()` gives the equivalent `ip.plot()` call.
 *
 * ```ts
 * import { createEditor } from "isopleth/editor";
 * const editor = createEditor(document.querySelector("#panel")!, {
 *   data, target: document.querySelector("#chart")!,
 *   spec: { mark: "auto", x: "date", y: "value", color: "series" },
 *   onChange: (spec, chart) => console.log(specToCode(spec), chart.insights),
 * });
 * ```
 */

import type { Value, InsightsConfig } from "../types.js";
import { Chart, plot } from "../chart.js";
import { fromSpec, inspectFields, specToCode, type ChartSpec, type FieldInfo, type SpecMark } from "../spec.js";
import { resolveTheme, themeToCSSVars, themes } from "../theme.js";
import { formatValue } from "../channel.js";

export interface EditorOptions {
  data: readonly object[];
  /** Initial spec; missing fields are guessed from the data. */
  spec?: Partial<ChartSpec>;
  /** Element the chart renders into. When omitted the editor renders nothing itself and only reports specs. */
  target?: HTMLElement;
  /** Called after every change with the new spec and the compiled chart (when `target` is set). */
  onChange?: (spec: ChartSpec, chart: Chart | null) => void;
  /** Which sections to show. */
  sections?: Partial<Record<"chart" | "encoding" | "composition" | "insights" | "colors" | "theme", boolean>>;
  /** Available theme names for the theme picker (default: all registered). */
  themeNames?: string[];
}

export interface Editor {
  readonly element: HTMLElement;
  readonly spec: ChartSpec;
  readonly chart: Chart | null;
  readonly fields: FieldInfo[];
  setSpec(patch: Partial<ChartSpec>): void;
  setData(data: readonly object[]): void;
  /** The `ip.plot({...})` code for the current spec. */
  code(): string;
  destroy(): void;
}

const STYLE_ID = "isopleth-editor-style";

const CSS = `
.ip-editor { --ipe-r: 10px; font: 12.5px/1.45 var(--ip-font); color: var(--ip-text); background: var(--ip-surface); border: 1px solid var(--ip-grid); border-radius: 14px; padding: 6px 0 10px; width: 100%; box-sizing: border-box; }
.ip-editor *, .ip-editor *::before, .ip-editor *::after { box-sizing: border-box; }
.ip-editor section { padding: 10px 14px 12px; border-bottom: 1px solid var(--ip-grid); }
.ip-editor section:last-of-type { border-bottom: 0; }
.ip-editor h4 { margin: 0 0 8px; font-size: 10.5px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ip-text-3); display: flex; align-items: center; justify-content: space-between; }
.ip-editor h4 small { font-weight: 500; letter-spacing: 0; text-transform: none; color: var(--ip-text-3); cursor: pointer; }
.ip-editor h4 small:hover { color: var(--ip-text); }
.ip-editor .row { display: grid; grid-template-columns: 76px 1fr; align-items: center; gap: 8px; margin: 0 0 7px; }
.ip-editor .row label { color: var(--ip-text-2); font-size: 12px; }
.ip-editor select, .ip-editor input[type=text], .ip-editor input[type=number] { width: 100%; font: inherit; color: var(--ip-text); background: var(--ip-bg); border: 1px solid var(--ip-grid); border-radius: 8px; padding: 5px 8px; outline: none; height: 29px; }
.ip-editor select:focus, .ip-editor input:focus { border-color: var(--ip-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ip-accent) 25%, transparent); }
.ip-editor .seg { display: flex; flex-wrap: wrap; gap: 4px; }
.ip-editor .seg button { font: inherit; font-size: 11.5px; padding: 5px 8px; border-radius: 8px; border: 1px solid var(--ip-grid); background: var(--ip-bg); color: var(--ip-text-2); cursor: pointer; display: inline-flex; align-items: center; gap: 6px; line-height: 1; }
.ip-editor .seg button svg { width: 14px; height: 14px; stroke: currentColor; fill: none; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.ip-editor .seg button:hover { color: var(--ip-text); border-color: var(--ip-text-3); }
.ip-editor .seg button[aria-pressed=true] { background: var(--ip-accent); border-color: var(--ip-accent); color: #fff; }
.ip-editor .toggles { display: flex; flex-wrap: wrap; gap: 6px; }
.ip-editor .toggle { display: inline-flex; align-items: center; gap: 6px; padding: 5px 9px; border-radius: 999px; border: 1px solid var(--ip-grid); background: var(--ip-bg); color: var(--ip-text-2); cursor: pointer; font-size: 11.5px; user-select: none; }
.ip-editor .toggle input { display: none; }
.ip-editor .toggle i { width: 7px; height: 7px; border-radius: 50%; background: var(--ip-text-3); }
.ip-editor .toggle[data-on=true] { color: var(--ip-text); border-color: color-mix(in srgb, var(--ip-accent) 70%, var(--ip-grid)); background: color-mix(in srgb, var(--ip-accent) 22%, var(--ip-bg)); }
.ip-editor .toggle[data-on=true] i { background: var(--ip-accent); }
.ip-editor .range { display: flex; align-items: center; gap: 8px; }
.ip-editor input[type=range] { flex: 1; accent-color: var(--ip-accent); height: 20px; }
.ip-editor .range output { min-width: 28px; text-align: right; color: var(--ip-text-2); font-variant-numeric: tabular-nums; font-size: 11.5px; }
.ip-editor .swatches { display: flex; flex-direction: column; gap: 4px; }
.ip-editor .swatch { display: grid; grid-template-columns: 22px 1fr auto; align-items: center; gap: 8px; font-size: 12px; color: var(--ip-text-2); }
.ip-editor .swatch input[type=color] { width: 22px; height: 22px; padding: 0; border: 0; border-radius: 6px; background: none; cursor: pointer; }
.ip-editor .swatch input[type=color]::-webkit-color-swatch-wrapper { padding: 0; }
.ip-editor .swatch input[type=color]::-webkit-color-swatch { border: 1px solid var(--ip-grid); border-radius: 6px; }
.ip-editor .swatch span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ip-editor .swatch code { font: 10.5px var(--ip-mono); color: var(--ip-text-3); }
.ip-editor .hint { color: var(--ip-text-3); font-size: 11px; margin: 2px 0 0; }
.ip-editor .inline { display: flex; gap: 6px; align-items: center; }
.ip-editor .inline input[type=number] { width: 64px; }
`;

const ICONS: Record<SpecMark, string> = {
  auto: '<svg viewBox="0 0 16 16"><path d="M8 1.5l1.6 4.2L14 7l-4.4 1.3L8 12.5 6.4 8.3 2 7l4.4-1.3z"/></svg>',
  line: '<svg viewBox="0 0 16 16"><path d="M1.5 12l3.5-5 3 3 2.5-6 4 4"/></svg>',
  area: '<svg viewBox="0 0 16 16"><path d="M1.5 13V9l3.5-4 3 2.5 3-5 3.5 4V13z"/></svg>',
  bar: '<svg viewBox="0 0 16 16"><path d="M2.5 13V7M6.5 13V3M10.5 13V9M14.5 13V5"/></svg>',
  dot: '<svg viewBox="0 0 16 16"><circle cx="4" cy="11" r="1.6"/><circle cx="8" cy="5" r="1.6"/><circle cx="12.5" cy="8.5" r="1.6"/></svg>',
  cell: '<svg viewBox="0 0 16 16"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>',
  histogram: '<svg viewBox="0 0 16 16"><path d="M1.5 13V10h3v3M4.5 13V5h3v8M7.5 13V3h3v10M10.5 13V8h3v5"/></svg>',
};

const MARKS: SpecMark[] = ["auto", "line", "area", "bar", "dot", "cell", "histogram"];
const REDUCERS = ["none", "count", "sum", "mean", "median", "min", "max"] as const;
const INTERVALS = ["none", "minute", "hour", "day", "week", "month", "quarter", "year"] as const;
const CURVES = ["linear", "monotone-x", "step", "basis"] as const;
const INSIGHT_KEYS = ["anomalies", "forecast", "changepoints", "seasonality", "trend", "frequencyOutliers", "categoryOutliers", "seriesOutliers"] as const;
const INSIGHT_LABELS: Record<(typeof INSIGHT_KEYS)[number], string> = {
  anomalies: "anomalies",
  forecast: "forecast",
  changepoints: "changepoints",
  seasonality: "seasonality",
  trend: "trend",
  frequencyOutliers: "frequency outliers",
  categoryOutliers: "category outliers",
  seriesOutliers: "series outliers",
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | number | boolean> = {}, children: (Node | string)[] = []): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = String(v);
    else if (k === "html") e.innerHTML = String(v);
    else if (k === "text") e.textContent = String(v);
    else if (typeof v === "boolean") {
      if (k.startsWith("aria-") || k.startsWith("data-")) e.setAttribute(k, String(v));
      else if (v) e.setAttribute(k, "");
    } else e.setAttribute(k, String(v));
  }
  for (const c of children) e.append(c);
  return e;
}

function guessSpec(fields: FieldInfo[], given: Partial<ChartSpec>): ChartSpec {
  const temporal = fields.find((f) => f.type === "temporal");
  const quant = fields.filter((f) => f.type === "quantitative");
  const ordinal = fields.filter((f) => f.type === "ordinal" && (f.values?.length ?? 99) <= 24);
  const spec: ChartSpec = { mark: "auto", ...given };
  if (!spec.x) spec.x = temporal?.name ?? ordinal[0]?.name ?? quant[0]?.name;
  if (!spec.y) spec.y = quant.find((f) => f.name !== spec.x)?.name;
  if (spec.color === undefined && ordinal.length && temporal) spec.color = ordinal.find((f) => f.name !== spec.x)?.name;
  return spec;
}

export function createEditor(container: HTMLElement, options: EditorOptions): Editor {
  if (!document.getElementById(STYLE_ID)) {
    const style = el("style", { id: STYLE_ID });
    style.textContent = CSS;
    document.head.appendChild(style);
  }
  let data = options.data;
  let fields = inspectFields(data);
  let spec = guessSpec(fields, options.spec ?? {});
  let chart: Chart | null = null;
  const sections = { chart: true, encoding: true, composition: true, insights: true, colors: true, theme: true, ...(options.sections ?? {}) };
  const root = el("div", { class: "ip-editor" });
  container.appendChild(root);

  const applyThemeVars = () => {
    const t = resolveTheme(spec.theme);
    for (const [k, v] of Object.entries(themeToCSSVars(t))) root.style.setProperty(k, v);
  };

  const fieldsOf = (types: FieldInfo["type"][]) => fields.filter((f) => types.includes(f.type));
  const selectField = (value: string | undefined, allowed: FieldInfo[], onChange: (v: string | undefined) => void, none = "none") => {
    const s = el("select");
    s.append(el("option", { value: "" }, [none]));
    for (const f of allowed) s.append(el("option", { value: f.name, ...(f.name === value ? { selected: true } : {}) }, [`${f.name}`]));
    s.value = value ?? "";
    s.addEventListener("change", () => onChange(s.value || undefined));
    return s;
  };
  const selectOf = (value: string, list: readonly string[], onChange: (v: string) => void) => {
    const s = el("select");
    for (const v of list) s.append(el("option", { value: v }, [v]));
    s.value = value;
    s.addEventListener("change", () => onChange(s.value));
    return s;
  };
  const row = (label: string, control: Node) => el("div", { class: "row" }, [el("label", { text: label }), control]);
  const toggle = (label: string, on: boolean, onChange: (on: boolean) => void) => {
    const t = el("label", { class: "toggle", "data-on": on }, [el("i"), label]);
    t.addEventListener("click", (e) => {
      e.preventDefault();
      const next = t.dataset.on !== "true";
      t.dataset.on = String(next);
      onChange(next);
    });
    return t;
  };
  const range = (min: number, max: number, step: number, value: number, format: (v: number) => string, onChange: (v: number) => void) => {
    const input = el("input", { type: "range", min, max, step, value });
    const out = el("output", { text: format(value) });
    input.addEventListener("input", () => {
      out.textContent = format(Number(input.value));
      onChange(Number(input.value));
    });
    return el("div", { class: "range" }, [input, out]);
  };

  function render() {
    applyThemeVars();
    if (!options.target) {
      options.onChange?.(spec, null);
      return;
    }
    try {
      chart = plot(fromSpec(data, spec));
      void chart.render(options.target);
    } catch (err) {
      console.error("[isopleth editor]", err);
      chart = null;
    }
    options.onChange?.(spec, chart);
  }

  function update(patch: Partial<ChartSpec>, rebuild = false) {
    spec = { ...spec, ...patch };
    render();
    if (rebuild) build();
    else refreshColors();
  }

  let colorsBox: HTMLElement | null = null;
  function refreshColors() {
    if (!colorsBox) return;
    colorsBox.replaceChildren();
    const domain = chart?.scales.color.kind === "categorical" ? chart.scales.color.domain : [];
    if (!domain.length) {
      colorsBox.append(el("p", { class: "hint", text: spec.color ? "no categorical colour scale" : "pick a colour field to edit series colours" }));
      return;
    }
    for (const v of domain.slice(0, 24)) {
      const key = String(v instanceof Date ? v.toISOString() : v);
      const current = chart!.scales.color.colorOf(v as Value) ?? "#888888";
      const input = el("input", { type: "color", value: toHex(current) });
      input.addEventListener("input", () => update({ colors: { ...(spec.colors ?? {}), [key]: input.value } }));
      colorsBox.append(el("div", { class: "swatch" }, [input, el("span", { text: formatValue(v as Value) }), el("code", { text: toHex(current) })]));
    }
  }

  function build() {
    root.replaceChildren();
    const typeOfX = fields.find((f) => f.name === spec.x)?.type;

    if (sections.chart) {
      const seg = el("div", { class: "seg" });
      for (const m of MARKS) {
        const b = el("button", { type: "button", "aria-pressed": spec.mark === m, html: `${ICONS[m]}<span>${m}</span>` });
        b.addEventListener("click", () => update({ mark: m }, true));
        seg.append(b);
      }
      root.append(el("section", {}, [el("h4", { text: "Chart" }), seg]));
    }

    if (sections.encoding) {
      const s = el("section", {}, [el("h4", { text: "Encoding" })]);
      s.append(row("x", selectField(spec.x, fields, (v) => update({ x: v }, true), "—")));
      if (spec.mark !== "histogram") s.append(row(spec.mark === "cell" ? "y" : "y", selectField(spec.y, spec.mark === "cell" ? fields : fieldsOf(["quantitative"]), (v) => update({ y: v }, true), "—")));
      if (spec.mark !== "histogram" && spec.mark !== "dot") {
        s.append(row(spec.mark === "cell" ? "fill" : "aggregate", selectOf(spec.reduce ? String(spec.reduce) : "none", REDUCERS, (v) => update({ reduce: v === "none" ? null : (v as ChartSpec["reduce"]) }, true))));
      }
      s.append(row("color by", selectField(spec.color, spec.mark === "cell" ? fieldsOf(["quantitative"]) : fieldsOf(["ordinal"]), (v) => update({ color: v }, true))));
      if (spec.mark === "dot" || spec.mark === "auto") s.append(row("size by", selectField(spec.size, fieldsOf(["quantitative"]), (v) => update({ size: v }, true))));
      s.append(row("facet by", selectField(spec.facet, fieldsOf(["ordinal"]).filter((f) => (f.values?.length ?? 99) <= 12), (v) => update({ facet: v }, true))));
      root.append(s);
    }

    if (sections.composition) {
      const s = el("section", {}, [el("h4", { text: "Composition" })]);
      if ((spec.mark === "area" || spec.mark === "bar") && spec.color) {
        const stackVal = spec.stack === false ? (spec.mark === "bar" ? "dodge" : "overlay") : spec.stack === "normalize" ? "normalize" : spec.stack === "center" ? "center" : "stack";
        const opts = spec.mark === "bar" ? ["stack", "dodge", "normalize"] : ["stack", "overlay", "normalize", "center"];
        s.append(row("stack", selectOf(stackVal, opts, (v) => update({ stack: v === "dodge" || v === "overlay" ? false : v === "stack" ? true : (v as "normalize" | "center") }, true))));
      }
      if (spec.mark === "line" || spec.mark === "area" || spec.mark === "auto") {
        s.append(row("smooth", range(0, 60, 1, spec.window ?? 0, (v) => (v <= 1 ? "off" : `${v} pts`), (v) => update({ window: v }))));
        s.append(row("curve", selectOf(spec.curve ?? "linear", CURVES, (v) => update({ curve: v === "linear" ? undefined : (v as ChartSpec["curve"]) }))));
      }
      if (typeOfX === "temporal" && spec.mark !== "cell") s.append(row("interval", selectOf(typeof spec.interval === "string" ? spec.interval : "none", INTERVALS, (v) => update({ interval: v === "none" ? undefined : (v as ChartSpec["interval"]) }, true))));
      if (spec.mark === "histogram") s.append(row("bins", range(5, 100, 1, spec.bins ?? 20, (v) => String(v), (v) => update({ bins: v }))));
      if (spec.mark === "bar" && typeOfX === "ordinal") s.append(row("sort", selectOf(spec.sort ?? "none", ["none", "-y", "y"], (v) => update({ sort: v as ChartSpec["sort"] }))));
      const toggles = el("div", { class: "toggles" });
      if (spec.mark === "area" || spec.mark === "auto") toggles.append(toggle("gradient", Boolean(spec.gradient), (on) => update({ gradient: on })));
      toggles.append(toggle("zoom", Boolean(spec.zoom), (on) => update({ zoom: on })));
      s.append(row("", toggles));
      root.append(s);
    }

    if (sections.insights) {
      const s = el("section", {}, [el("h4", { text: "Insights" })]);
      const box = el("div", { class: "toggles" });
      const ins: InsightsConfig = { ...(spec.insights ?? {}) };
      for (const k of INSIGHT_KEYS) {
        box.append(
          toggle(INSIGHT_LABELS[k], Boolean(ins[k]), (on) => {
            const next: InsightsConfig = { ...(spec.insights ?? {}) };
            if (on) (next as Record<string, unknown>)[k] = k === "forecast" ? { horizon: spec.insights && typeof spec.insights.forecast === "object" ? spec.insights.forecast.horizon : 24 } : true;
            else delete (next as Record<string, unknown>)[k];
            update({ insights: next }, k === "forecast");
          }),
        );
      }
      s.append(box);
      if (spec.insights?.forecast) {
        const h = typeof spec.insights.forecast === "object" ? (spec.insights.forecast.horizon ?? 24) : 24;
        s.append(el("div", { style: "margin-top:8px" }, [row("horizon", range(1, 120, 1, h, (v) => `${v}`, (v) => update({ insights: { ...spec.insights, forecast: { horizon: v } } })))]));
      }
      root.append(s);
    }

    if (sections.colors) {
      const s = el("section", {}, [el("h4", { html: `<span>Series colours</span><small>reset</small>` })]);
      s.querySelector("small")!.addEventListener("click", () => update({ colors: {} }));
      colorsBox = el("div", { class: "swatches" });
      s.append(colorsBox);
      root.append(s);
    }

    if (sections.theme) {
      const names = options.themeNames ?? Object.keys(themes);
      root.append(el("section", {}, [el("h4", { text: "Theme" }), row("theme", selectOf(spec.theme ?? "light", names, (v) => update({ theme: v })))]));
    }
    refreshColors();
  }

  build();
  render();
  refreshColors();

  return {
    element: root,
    get spec() {
      return spec;
    },
    get chart() {
      return chart;
    },
    get fields() {
      return fields;
    },
    setSpec(patch) {
      update(patch, true);
    },
    setData(next) {
      data = next;
      fields = inspectFields(data);
      spec = guessSpec(fields, { mark: spec.mark, theme: spec.theme, insights: spec.insights });
      build();
      render();
      refreshColors();
    },
    code() {
      return specToCode(spec);
    },
    destroy() {
      root.remove();
    },
  };
}

function toHex(color: string): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase();
  const m = /rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(color);
  if (m) return "#" + [m[1], m[2], m[3]].map((c) => Number(c).toString(16).padStart(2, "0")).join("");
  return "#888888";
}

export { fromSpec, specToCode, inspectFields };
export type { ChartSpec, FieldInfo, SpecMark };
