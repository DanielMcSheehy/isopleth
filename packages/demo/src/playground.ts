import * as ip from "isopleth";
import { createEditor, specToCode, type ChartSpec } from "isopleth/editor";
import { categoryCounts, fleet, penguins, sales, single, timeseries } from "./data.js";

const datasets: Record<string, { data: object[]; spec: Partial<ChartSpec> }> = {
  timeseries: { data: timeseries(), spec: { mark: "line", x: "date", y: "value", color: "series", insights: { anomalies: true } } },
  single: { data: single(), spec: { mark: "auto", x: "date", y: "value", insights: { anomalies: true, forecast: { horizon: 30 }, changepoints: true } } },
  penguins: { data: penguins(), spec: { mark: "dot", x: "flipper", y: "mass", color: "species" } },
  sales: { data: sales(), spec: { mark: "bar", x: "region", y: "revenue", reduce: "sum", color: "product" } },
  fleet: { data: fleet(), spec: { mark: "line", x: "t", y: "cpu", color: "host", insights: { seriesOutliers: true } } },
  statuses: { data: categoryCounts(), spec: { mark: "bar", x: "kind", reduce: "count", sort: "-y", insights: { frequencyOutliers: true } } },
};

let theme: "light" | "dark" = "dark";
const chartEl = document.getElementById("chart")!;
const insightsEl = document.getElementById("insights")!;
const codeEl = document.getElementById("code")!;
const statsEl = document.getElementById("stats")!;

function highlight(code: string): string {
  return code
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/("[^"]*")/g, '<span class="s">$1</span>')
    .replace(/\b(ip\.\w+)/g, '<span class="f">$1</span>');
}

const editor = createEditor(document.getElementById("panel")!, {
  data: datasets.timeseries.data,
  spec: { ...datasets.timeseries.spec, theme },
  target: chartEl,
  onChange: (spec, chart) => {
    codeEl.innerHTML = highlight(specToCode(spec));
    insightsEl.innerHTML = chart ? chart.insights.map((i) => `<li>${i.summary}<small>${i.method} · ${i.backend}</small></li>`).join("") : "";
    for (const w of chart?.warnings ?? []) insightsEl.innerHTML += `<li class="warn">${w}</li>`;
    const t = spec.theme === "dark" || spec.theme === "light" ? spec.theme : theme;
    if (t !== theme) {
      theme = t;
      document.documentElement.dataset.theme = theme;
      document.getElementById("theme")!.textContent = theme === "light" ? "dark mode" : "light mode";
    }
  },
});

function load(name: string) {
  const d = datasets[name];
  editor.setData(d.data);
  editor.setSpec({ ...d.spec, theme });
  statsEl.innerHTML = `<code>${d.data.length.toLocaleString()} rows · ${editor.fields.length} fields</code>`;
}
load("timeseries");

(document.getElementById("dataset") as HTMLSelectElement).addEventListener("change", (e) => load((e.target as HTMLSelectElement).value));

document.getElementById("theme")!.addEventListener("click", () => {
  theme = theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
  editor.setSpec({ theme });
});

document.getElementById("copy")!.addEventListener("click", async () => {
  await navigator.clipboard.writeText(editor.code());
  const b = document.getElementById("copy")!;
  b.textContent = "copied";
  setTimeout(() => (b.textContent = "copy"), 1200);
});

/** Minimal CSV loader: numbers and ISO dates are coerced, everything else stays a string. */
document.getElementById("csv")!.addEventListener("change", async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const header = lines[0].split(",").map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const cells = line.split(",");
    const row: ip.Row = {};
    header.forEach((h, i) => {
      const raw = (cells[i] ?? "").trim();
      if (raw === "") (row as Record<string, unknown>)[h] = null;
      else if (/^-?\d+(\.\d+)?$/.test(raw)) (row as Record<string, unknown>)[h] = Number(raw);
      else if (/^\d{4}-\d{2}-\d{2}/.test(raw)) (row as Record<string, unknown>)[h] = new Date(raw);
      else (row as Record<string, unknown>)[h] = raw;
    });
    return row;
  });
  datasets[file.name] = { data: rows, spec: { mark: "auto", theme } };
  const sel = document.getElementById("dataset") as HTMLSelectElement;
  sel.append(new Option(file.name, file.name, true, true));
  load(file.name);
});

(window as unknown as { editor: typeof editor; ip: typeof ip }).editor = editor;
(window as unknown as { editor: typeof editor; ip: typeof ip }).ip = ip;
