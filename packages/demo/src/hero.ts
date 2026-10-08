import * as ip from "isopleth";
import { fleet, sales, single, timeseries } from "./data.js";

const web = single(200);
const ts = timeseries(200);
const sl = sales();
const hosts = fleet(10, 72);

// A transparent variant of the dark theme so the cards' glass shows through.
const theme = ip.defineTheme("hero", "dark", { background: "#10152b", grid: "#1d2443", axis: "#2a3254", textMuted: "#7d86a0" });

const main = ip.plot({
  marks: [ip.auto(web, { x: "date", y: "value", color: theme.categorical[0] })],
  insights: { anomalies: true, forecast: { horizon: 28 }, changepoints: true, trend: true, annotate: false },
  y: { label: null },
  x: { label: null },
  theme: "hero",
  margin: { top: 28, right: 16, bottom: 34, left: 44 },
  animation: false,
});
main.render(document.getElementById("c-main")!);

ip.plot({
  marks: [ip.areaY(ts, ip.windowY(7, { x: "date", y: "value", fill: "series", gradient: true }))],
  x: { label: null, axis: null },
  y: { label: null, axis: null, grid: false },
  legend: false,
  theme: "hero",
  margin: { top: 30, right: 8, bottom: 6, left: 8 },
  animation: false,
}).render(document.getElementById("c-a")!);

ip.plot({
  marks: [ip.cell(sl, ip.group({ fill: "sum" }, { x: "region", y: "product", fill: "revenue" }))],
  x: { label: null },
  y: { label: null },
  color: { legend: false },
  theme: "hero",
  margin: { top: 30, right: 8, bottom: 26, left: 70 },
  animation: false,
}).render(document.getElementById("c-b")!);

ip.plot({
  marks: [ip.lineY(hosts, { x: "t", y: "cpu", stroke: "host", strokeWidth: 1.25 })],
  insights: { seriesOutliers: true, annotate: false },
  x: { label: null, axis: null },
  y: { label: null, axis: null, grid: false },
  legend: false,
  theme: "hero",
  margin: { top: 30, right: 8, bottom: 6, left: 8 },
  animation: false,
}).render(document.getElementById("c-c")!);
