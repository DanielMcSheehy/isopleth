import * as ip from "isopleth";
import { categoryCounts, fleet, penguins, sales, single, timeseries } from "./data.js";

interface Example {
  id: string;
  title: string;
  description: string;
  wide?: boolean;
  code: string;
  make: (theme: "light" | "dark") => ip.Chart;
}

const ts = timeseries();
const web = single();
const peng = penguins();
const sl = sales();
const hosts = fleet();
const statuses = categoryCounts();

const examples: Example[] = [
  {
    id: "auto-insights",
    title: "auto + insights",
    description: "One call picks the mark (line over a monotonic time axis); the insights config adds anomalies, a forecast with its interval, changepoints, seasonality and a trend line.",
    wide: true,
    code: `ip.plot({
  marks: [ip.auto(web, { x: "date", y: "value" })],
  insights: { anomalies: true, forecast: { horizon: 30 }, changepoints: true, seasonality: true, trend: true },
  x: { zoom: true },
})`,
    make: (theme) =>
      ip.plot({
        marks: [ip.auto(web, { x: "date", y: "value" })],
        insights: { anomalies: true, forecast: { horizon: 30 }, changepoints: true, seasonality: true, trend: true },
        x: { zoom: true },
        theme,
      }),
  },
  {
    id: "stacked-area",
    title: "stacked areas, rolling mean, gradients",
    description: "areaY stacks series automatically; windowY smooths each series with a 7-day centred mean; gradient fades the fills.",
    code: `ip.plot({
  marks: [
    ip.areaY(ts, ip.windowY(7, { x: "date", y: "value", fill: "series", gradient: true })),
    ip.lineY(ts, ip.windowY(7, ip.stackY({ x: "date", y: "value", stroke: "series", strokeWidth: 1 }))),
  ],
  y: { label: "requests / day" },
})`,
    make: (theme) =>
      ip.plot({
        marks: [
          ip.areaY(ts, ip.windowY(7, { x: "date", y: "value", fill: "series", gradient: true })),
          ip.lineY(ts, ip.windowY(7, ip.stackY2({ x: "date", y: "value", stroke: "series", strokeWidth: 1 }))),
        ],
        y: { label: "requests / day" },
        theme,
      }),
  },
  {
    id: "histogram",
    title: "histogram (binX + stacked fill)",
    description: "binX with a count reducer picks nice thresholds; the fill channel subdivides each bin and rectY stacks the parts.",
    code: `ip.plot({
  marks: [ip.rectY(peng, ip.binX({ y: "count" }, { x: "mass", fill: "species" }))],
  x: { label: "body mass (g)" },
})`,
    make: (theme) =>
      ip.plot({
        marks: [ip.rectY(peng, ip.binX({ y: "count" }, { x: "mass", fill: "species", tip: true }))],
        x: { label: "body mass (g)" },
        color: { legend: true },
        theme,
      }),
  },
  {
    id: "normalized",
    title: "proportions over time",
    description: "stackY with offset \"normalize\" turns stacked values into shares; the y axis is formatted as percent.",
    code: `ip.plot({
  marks: [ip.areaY(ts, ip.stackY({ offset: "normalize" }, { x: "date", y: "value", fill: "series" }))],
  y: { percent: true },
})`,
    make: (theme) =>
      ip.plot({
        marks: [ip.areaY(ts, ip.stackY({ offset: "normalize" }, { x: "date", y: "value", fill: "series" }))],
        y: { percent: true, label: "share" },
        theme,
      }),
  },
  {
    id: "frequency",
    title: "frequency outliers",
    description: "groupX counts rows per category; the frequencyOutliers insight flags categories that are unusually rare or dominant.",
    code: `ip.plot({
  marks: [ip.barY(statuses, ip.groupX({ y: "count" }, { x: "kind", sort: { x: "-y" } }))],
  insights: { frequencyOutliers: true },
})`,
    make: (theme) =>
      ip.plot({
        marks: [ip.barY(statuses, ip.groupX({ y: "count" }, { x: "kind", fill: "#4269d0", sort: { x: "-y" } }))],
        insights: { frequencyOutliers: true },
        x: { label: "HTTP status" },
        y: { label: "requests" },
        theme,
      }),
  },
  {
    id: "category",
    title: "category outliers",
    description: "Dots per region with within-category outliers and whole categories that stand out, both flagged by categoryOutliers.",
    code: `ip.plot({
  marks: [ip.dot(sales, { x: "region", y: "units", fill: "product" })],
  insights: { categoryOutliers: true },
})`,
    make: (theme) =>
      ip.plot({
        marks: [ip.dot(sl, { x: "region", y: "units", fill: "product", fillOpacity: 0.7 })],
        insights: { categoryOutliers: true },
        x: { jitter: 14 },
        theme,
      }),
  },
  {
    id: "heatmap",
    title: "heatmap (cell + group)",
    description: "group on two ordinal channels; a continuous fill gets a visualMap.",
    code: `ip.plot({
  marks: [ip.cell(sales, ip.group({ fill: "sum" }, { x: "region", y: "product", fill: "revenue" }))],
  color: { scheme: "ylgnbu" },
})`,
    make: (theme) =>
      ip.plot({
        marks: [ip.cell(sl, ip.group({ fill: "sum" }, { x: "region", y: "product", fill: "revenue", label: true }))],
        color: { scheme: "ylgnbu", label: "revenue" },
        theme,
      }),
  },
  {
    id: "difference",
    title: "difference (year over year)",
    description: "shiftX compares the series with itself one year earlier; differenceY fills green where above and blue where below.",
    code: `ip.plot({
  marks: [ip.differenceY(sales, ip.shiftX("+1 year", ip.groupX({ y: "sum" }, { x: "month", y: "revenue" })))],
})`,
    make: (theme) => {
      const monthly = sl;
      return ip.plot({
        marks: [ip.differenceY(monthly, ip.shiftX("+1 year", ip.groupX({ y: "sum" }, { x: "month", y: "revenue" })))],
        y: { label: "revenue" },
        theme,
      });
    },
  },
  {
    id: "facets",
    title: "facets (small multiples)",
    description: "fx splits marks across grids with shared scales; the anomaly insight runs per facet.",
    wide: true,
    code: `ip.plot({
  marks: [ip.lineY(ts, { x: "date", y: "value", stroke: "series", fx: "series" })],
  insights: { anomalies: true },
})`,
    make: (theme) =>
      ip.plot({
        marks: [ip.lineY(ts, { x: "date", y: "value", stroke: "series", fx: "series" })],
        insights: { anomalies: true },
        theme,
      }),
  },
  {
    id: "fleet",
    title: "series outliers across a fleet",
    description: "Twelve hosts; seriesOutliers finds the one that drifts, dims the rest and shades the normal band.",
    wide: true,
    code: `ip.plot({
  marks: [ip.lineY(fleet, { x: "t", y: "cpu", stroke: "host" })],
  insights: { seriesOutliers: true },
})`,
    make: (theme) =>
      ip.plot({
        marks: [ip.lineY(hosts, { x: "t", y: "cpu", stroke: "host", strokeWidth: 1 })],
        insights: { seriesOutliers: true },
        legend: { type: "scroll" },
        y: { label: "cpu %" },
        theme,
      }),
  },
  {
    id: "missing",
    title: "missing data: gaps vs imputation",
    description: "interval: \"day\" reveals missing days as gaps; imputeY fills them (dashed) so downstream transforms keep working.",
    code: `const sparse = web.filter((d) => d.date.getUTCDate() % 6 !== 0);
ip.plot({
  marks: [
    ip.lineY(sparse, ip.imputeY("linear", ip.intervalX("day", { x: "date", y: "value", stroke: "#9498a0", strokeDasharray: "3 3" }))),
    ip.lineY(sparse, { x: "date", y: "value", interval: "day", stroke: "#4269d0" }),
  ],
})`,
    make: (theme) => {
      const sparse = web.filter((d) => d.date.getUTCDate() % 6 !== 0 && d.date.getUTCDate() % 7 !== 0);
      return ip.plot({
        marks: [
          ip.lineY(sparse, ip.imputeY("linear", ip.intervalX("day", { x: "date", y: "value", stroke: "#9498a0", strokeDasharray: "3 3", name: "imputed" }))),
          ip.lineY(sparse, { x: "date", y: "value", interval: "day", stroke: "#4269d0", name: "observed" }),
        ],
        theme,
      });
    },
  },
  {
    id: "scatter",
    title: "scatter with size, continuous color and a trend",
    description: "r and fill map to numeric channels (sqrt size scale, visualMap color); trend fits an OLS line.",
    code: `ip.plot({
  marks: [ip.dot(peng, { x: "flipper", y: "mass", r: "bill", fill: "bill" })],
  insights: { trend: true },
  color: { scheme: "viridis" },
})`,
    make: (theme) =>
      ip.plot({
        marks: [ip.dot(peng, { x: "flipper", y: "mass", r: "bill", fill: "bill", fillOpacity: 0.8 })],
        insights: { trend: true },
        color: { scheme: "viridis", label: "bill length" },
        x: { label: "flipper length (mm)" },
        y: { label: "body mass (g)" },
        theme,
      }),
  },
  {
    id: "rolling",
    title: "rolling min / max envelope",
    description: "windowY with min and max reducers (O(n) monotonic deques) draws a 14-day envelope around the raw series.",
    code: `ip.plot({
  marks: [
    ip.areaY(web, ip.map({ y1: ip.window({ k: 14, reduce: "min" }), y2: ip.window({ k: 14, reduce: "max" }) }, { x: "date", y1: "value", y2: "value", fill: "#4269d0", fillOpacity: 0.15 })),
    ip.lineY(web, { x: "date", y: "value" }),
  ],
})`,
    make: (theme) =>
      ip.plot({
        marks: [
          ip.areaY(web, ip.map({ y1: ip.window({ k: 14, reduce: "min" }), y2: ip.window({ k: 14, reduce: "max" }) }, { x: "date", y1: "value", y2: "value", fill: "#4269d0", fillOpacity: 0.15, name: "14d envelope" })),
          ip.lineY(web, { x: "date", y: "value", stroke: "#4269d0", name: "value" }),
          ip.lineY(web, ip.windowY({ k: 14, reduce: "median" }, { x: "date", y: "value", stroke: "#e4572e", name: "14d median" })),
        ],
        theme,
      }),
  },
  {
    id: "grouped-bars",
    title: "grouped bars, time binning",
    description: "binX on a time channel with a quarter interval, a sum reducer, and dodge: true for side-by-side bars.",
    code: `ip.plot({
  marks: [ip.barY(sales, ip.binX({ y: "sum", interval: "quarter" }, { x: "month", y: "revenue", fill: "product", dodge: true }))],
})`,
    make: (theme) =>
      ip.plot({
        marks: [ip.barY(sl, ip.binX({ y: "sum", interval: "quarter" }, { x: "month", y: "revenue", fill: "product", dodge: true }))],
        x: { type: "ordinal", tickFormat: (d) => { const t = new Date(String(d)); return `${t.getUTCFullYear()} Q${Math.floor(t.getUTCMonth() / 3) + 1}`; } },
        y: { label: "revenue" },
        theme,
      }),
  },
];

let theme: "light" | "dark" = "light";
const charts = new Map<string, HTMLElement>();

function renderAll() {
  const t0 = performance.now();
  for (const ex of examples) {
    const el = charts.get(ex.id)!;
    const list = el.parentElement!.querySelector("ul.insights") as HTMLUListElement;
    try {
      const chart = ex.make(theme);
      chart.render(el, { renderer: "canvas" });
      list.innerHTML = chart.insights.map((i) => `<li>${i.summary} <small style="color:var(--muted)">(${i.method}, ${i.backend})</small></li>`).join("");
      for (const w of chart.warnings) list.innerHTML += `<li style="color:#e4572e">${w}</li>`;
    } catch (err) {
      list.innerHTML = `<li style="color:#e4572e">${(err as Error).message}</li>`;
      console.error(ex.id, err);
    }
  }
  console.log(`rendered ${examples.length} charts in ${(performance.now() - t0).toFixed(0)}ms (${ip.getBackend().name})`);
}

const gallery = document.getElementById("gallery")!;
for (const ex of examples) {
  const section = document.createElement("section");
  section.className = `example${ex.wide ? " wide" : ""}`;
  section.id = ex.id;
  section.innerHTML = `<h2>${ex.title}</h2><p>${ex.description}</p><div class="chart"></div><ul class="insights"></ul><details><summary>code</summary><pre></pre></details>`;
  section.querySelector("pre")!.textContent = ex.code;
  gallery.appendChild(section);
  charts.set(ex.id, section.querySelector(".chart") as HTMLElement);
}
renderAll();

document.getElementById("theme")!.addEventListener("click", (e) => {
  theme = theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
  (e.target as HTMLButtonElement).textContent = theme === "light" ? "dark mode" : "light mode";
  for (const el of charts.values()) ip.disposeChart(el);
  renderAll();
});

document.getElementById("wasm")!.addEventListener("click", async (e) => {
  const btn = e.target as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = "loading…";
  try {
    const { loadWasm } = await import("isopleth/wasm");
    const backend = await ip.init(loadWasm());
    document.getElementById("backend")!.textContent = `backend: ${backend.name}`;
    btn.textContent = backend.name === "wasm" ? "wasm loaded" : "wasm unavailable (js)";
    renderAll();
  } catch (err) {
    btn.textContent = "wasm unavailable (build it with npm run build:wasm)";
    console.warn(err);
  }
});

(window as unknown as { ip: typeof ip }).ip = ip;
