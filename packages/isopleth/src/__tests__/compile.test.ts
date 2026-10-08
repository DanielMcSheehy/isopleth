import { describe, expect, it } from "vitest";
import * as ip from "../index.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const r = rng(11);
const days = 120;
const ts = Array.from({ length: days }, (_, i) => {
  const date = new Date(Date.UTC(2024, 0, 1 + i));
  const base = 100 + i * 0.5 + 8 * Math.sin((2 * Math.PI * i) / 7);
  return [
    { date, series: "alpha", value: base + (r() * 4 - 2) + (i === 70 ? 60 : 0) },
    { date, series: "beta", value: base * 0.6 + (r() * 4 - 2) },
  ];
}).flat();
const cats = ["a", "b", "c", "d", "e", "f"].flatMap((cat, k) => Array.from({ length: 20 }, (_, i) => ({ cat, v: (k === 3 ? 100 : 10) + ((i * 7 + k) % 5) * 0.5, g: i % 2 ? "x" : "y" })));

const series = (chart: ip.Chart) => chart.option.series as any[];

describe("plot → option", () => {
  it("infers axis types and builds one series per color group", () => {
    const chart = ip.plot({ marks: [ip.lineY(ts, { x: "date", y: "value", stroke: "series" }), ip.ruleY([0])] });
    const xAxis = chart.option.xAxis as any[];
    const yAxis = chart.option.yAxis as any[];
    expect(xAxis[0].type).toBe("time");
    expect(yAxis[0].type).toBe("value");
    expect(xAxis[0].name).toBe("date");
    expect(yAxis[0].name).toBe("value");
    const lines = series(chart).filter((s) => s.type === "line" && s.data.length);
    expect(lines.map((s) => s.name)).toEqual(["alpha", "beta"]);
    expect(lines[0].data[0][0]).toBe(Date.UTC(2024, 0, 1));
    expect((chart.option.legend as any).data).toEqual(["alpha", "beta"]);
    expect(chart.scales.color.kind).toBe("categorical");
    const rule = series(chart).find((s) => s.markLine);
    expect(rule.markLine.data[0].yAxis).toBe(0);
  });

  it("stacks areas natively and uses category axes for bars", () => {
    const chart = ip.plot({ marks: [ip.areaY(ts, { x: "date", y: "value", fill: "series" })] });
    const s = series(chart);
    expect(s.length).toBe(2);
    expect(s.every((x) => x.stack === s[0].stack)).toBe(true);
    expect(s[0].areaStyle).toBeDefined();
    const bars = ip.plot({ marks: [ip.barY(cats, ip.groupX({ y: "sum" }, { x: "cat", y: "v", fill: "g" }))] });
    expect((bars.option.xAxis as any[])[0].type).toBe("category");
    expect((bars.option.xAxis as any[])[0].data).toEqual(["a", "b", "c", "d", "e", "f"]);
    const bs = series(bars);
    expect(bs.map((b) => b.type)).toEqual(["bar", "bar"]);
    expect(bs[0].stack).toBe(bs[1].stack);
    const sumA = bs.reduce((acc, b) => acc + b.data.find((d: any) => (Array.isArray(d) ? d[0] : d.value[0]) === "a")[1], 0);
    expect(sumA).toBeCloseTo(cats.filter((c) => c.cat === "a").reduce((a, c) => a + c.v, 0), 6);
  });

  it("renders histograms as custom rect series", () => {
    const chart = ip.plot({ marks: [ip.rectY(ts, ip.binX({ y: "count" }, { x: "value", fill: "series" }))] });
    const s = series(chart);
    expect(s.every((x) => x.type === "custom")).toBe(true);
    expect(typeof s[0].renderItem).toBe("function");
    expect(s[0].data[0].value.length).toBeGreaterThanOrEqual(4);
  });

  it("builds heatmaps with a visualMap for continuous fill", () => {
    const chart = ip.plot({ marks: [ip.cell(cats, ip.group({ fill: "mean" }, { x: "cat", y: "g", fill: "v" }))] });
    const s = series(chart);
    expect(s[0].type).toBe("heatmap");
    expect(chart.scales.color.kind).toBe("continuous");
    expect((chart.option.visualMap as any[])[0].seriesIndex).toEqual([0]);
  });

  it("dots with r and continuous fill", () => {
    const chart = ip.plot({ marks: [ip.dot(cats, { x: "cat", y: "v", r: "v", fill: "v" })] });
    const s = series(chart)[0];
    expect(s.type).toBe("scatter");
    expect(typeof s.symbolSize).toBe("function");
    expect((chart.option.visualMap as any[])[0].dimension).toBe(3);
  });

  it("differenceY emits fills and the metric line", () => {
    const d = Array.from({ length: 30 }, (_, i) => ({ x: i, a: Math.sin(i / 3), b: Math.cos(i / 3) }));
    const chart = ip.plot({ marks: [ip.differenceY(d, { x: "x", y1: "a", y2: "b" })] });
    const s = series(chart);
    const bands = s.filter((x) => x.type === "custom");
    expect(bands.map((b) => b.name)).toEqual(["positive", "negative"]);
    expect(bands[0].data.length).toBeGreaterThan(30); // crossing points inserted
    expect(s.filter((x) => x.type === "line" && !x.silent).length).toBe(1);
  });

  it("facets create one grid per key with shared axes", () => {
    const chart = ip.plot({ marks: [ip.lineY(ts, { x: "date", y: "value", fy: "series" })] });
    expect((chart.option.grid as any[]).length).toBe(2);
    expect((chart.option.xAxis as any[]).length).toBe(2);
    const s = series(chart);
    expect(s.filter((x) => x.yAxisIndex === 1).length).toBe(1);
    expect(s[0].data.length).toBe(days);
  });

  it("interval option reveals gaps", () => {
    const sparse = ts.filter((d) => d.series === "alpha" && d.date.getUTCDate() % 5 !== 0);
    const chart = ip.plot({ marks: [ip.lineY(sparse, { x: "date", y: "value", interval: "day" })] });
    const data = series(chart)[0].data as any[];
    expect(data.length).toBeGreaterThan(sparse.length);
    expect(data.some((d: any) => d[1] === null)).toBe(true);
  });

  it("sort by -y orders the ordinal domain", () => {
    const chart = ip.plot({ marks: [ip.barY(cats, ip.groupX({ y: "sum" }, { x: "cat", y: "v", sort: { x: "-y" } }))] });
    expect((chart.option.xAxis as any[])[0].data[0]).toBe("d");
  });

  it("escape hatch merges extra ECharts options", () => {
    const chart = ip.plot({ marks: [ip.lineY(ts, { x: "date", y: "value" })], echarts: { backgroundColor: "#123", xAxis: { name: "custom" } as any } });
    expect(chart.option.backgroundColor).toBe("#123");
    expect((chart.option.xAxis as any).name).toBe("custom");
  });
});

describe("insights", () => {
  it("anomalies + forecast + changepoints + seasonality + trend produce marks and summaries", () => {
    const alpha = ts.filter((d) => d.series === "alpha");
    const chart = ip.plot({
      marks: [ip.lineY(alpha, { x: "date", y: "value" })],
      insights: { anomalies: true, forecast: { horizon: 14 }, changepoints: true, seasonality: true, trend: true },
    });
    const kinds = chart.insights.map((i) => i.kind);
    expect(kinds).toEqual(expect.arrayContaining(["anomalies", "forecast", "changepoints", "seasonality", "trend"]));
    const anomalies = chart.insights.find((i) => i.kind === "anomalies")!;
    expect((anomalies.data as any).indices).toContain(70);
    const season = chart.insights.find((i) => i.kind === "seasonality")!;
    expect((season.data as any).periods[0]).toBe(7);
    expect(season.summary).toContain("weekly");
    const fc = chart.insights.find((i) => i.kind === "forecast")!;
    expect((fc.data as any).point.length).toBe(14);
    const s = series(chart);
    expect(s.some((x) => x.name === "anomaly")).toBe(true);
    expect(s.some((x) => x.name?.startsWith("forecast"))).toBe(true);
    expect(s.some((x) => x.lineStyle?.type !== "solid" && x.name?.startsWith("forecast"))).toBe(true);
    // The x axis extends into the forecast horizon.
    expect(chart.scales.x.extent[1]).toBeGreaterThan(+alpha[alpha.length - 1].date);
    expect(chart.warnings).toEqual([]);
    expect((chart.option.title as any[])[0].subtext).toContain("anomal");
  });

  it("runs per series and respects mark-level targets", () => {
    const chart = ip.plot({
      marks: [ip.lineY(ts, { x: "date", y: "value", stroke: "series", id: "main", insights: { anomalies: { sensitivity: 0.3 } } }), ip.lineY(ts, { x: "date", y: "value", id: "other" })],
      insights: { trend: { target: "other" } },
    });
    expect(chart.insights.filter((i) => i.kind === "anomalies").map((i) => i.mark)).toEqual(["main", "main"]);
    expect(chart.insights.filter((i) => i.kind === "trend").map((i) => i.mark)).toEqual(["other"]);
  });

  it("category and frequency outliers highlight bars", () => {
    const counts = [...Array(50).fill("a"), ...Array(48).fill("b"), ...Array(52).fill("c"), ...Array(2).fill("rare"), ...Array(400).fill("big")].map((cat) => ({ cat }));
    const chart = ip.plot({ marks: [ip.barY(counts, ip.groupX({ y: "count" }, { x: "cat" }))], insights: { frequencyOutliers: true } });
    const f = chart.insights.find((i) => i.kind === "frequencyOutliers")!;
    expect(f.summary).toContain("rare");
    expect(f.summary).toContain("big");
    const bar = series(chart).find((s) => s.type === "bar");
    expect(bar.data.some((d: any) => d.itemStyle)).toBe(true);
    const c = ip.plot({ marks: [ip.dot(cats, { x: "cat", y: "v" })], insights: { categoryOutliers: true } });
    const ci = c.insights.find((i) => i.kind === "categoryOutliers")!;
    expect(ci.summary).toContain("d (z");
  });

  it("series outliers restyle the odd series", () => {
    const many = ["s1", "s2", "s3", "s4", "odd"].flatMap((name) =>
      Array.from({ length: 60 }, (_, i) => ({ t: i, name, v: name === "odd" && i > 30 ? 40 : 10 + Math.sin(i / 5) })),
    );
    const chart = ip.plot({ marks: [ip.lineY(many, { x: "t", y: "v", stroke: "name" })], insights: { seriesOutliers: true } });
    const so = chart.insights.find((i) => i.kind === "seriesOutliers")!;
    expect(so.summary).toContain("odd");
    const odd = series(chart).find((s) => s.name === "odd");
    expect(odd.lineStyle.width).toBe(2.5);
    expect(series(chart).find((s) => s.name === "s1").lineStyle.opacity).toBe(0.35);
  });

  it("show: false computes without drawing", () => {
    const alpha = ts.filter((d) => d.series === "alpha");
    const chart = ip.plot({ marks: [ip.lineY(alpha, { x: "date", y: "value" })], insights: { anomalies: { show: false } } });
    expect(chart.insights.length).toBe(1);
    expect(series(chart).length).toBe(1);
  });
});

describe("auto", () => {
  it("picks marks like Plot", () => {
    expect(ip.autoSpec(ts, { x: "date", y: "value" }).markImpl).toBe("lineY");
    expect(ip.autoSpec(cats, { x: "v" }).markImpl).toBe("rectY");
    expect(ip.autoSpec(cats, { x: "v" }).transformImpl).toBe("binX");
    expect(ip.autoSpec(cats, { x: "cat" }).markImpl).toBe("barY");
    expect(ip.autoSpec(cats, { x: "cat", y: "v" }).markImpl).toBe("dot");
    expect(ip.autoSpec(cats, { x: "cat", y: "v", color: "g" }).markImpl).toBe("dot");
    expect(ip.autoSpec(cats, { x: "cat", y: { value: "v", reduce: "mean" } }).markImpl).toBe("dot");
    expect(ip.autoSpec(cats, { x: "cat", y: { value: "v", reduce: "mean" } }).transformImpl).toBe("groupX");
    expect(ip.autoSpec(cats, { x: "cat", y: { value: "v", reduce: "sum" } }).markImpl).toBe("barY");
    const scatter = cats.map((c, i) => ({ a: (i * 37) % 101, b: (i * 53) % 97 }));
    expect(ip.autoSpec(scatter, { x: "a", y: "b" }).markImpl).toBe("dot");
    expect(ip.autoSpec(scatter, { x: "a", y: "b", color: "count" }).markImpl).toBe("rect");
    expect(ip.autoSpec(scatter, { x: "a", y: "b", color: "count" }).transformImpl).toBe("bin");
    expect(ip.autoSpec(cats, { x: "cat", y: "g" }).markImpl).toBe("dot");
    expect(ip.autoSpec(cats, { x: "cat", y: "g" }).transformImpl).toBe("group");
    expect(ip.autoSpec(cats, { x: "cat", y: "g" }).size.reduce).toBe("count");
  });
  it("builds a working chart with insights", () => {
    const chart = ip.plot({ marks: [ip.auto(ts, { x: "date", y: "value", color: "series", insights: { anomalies: true } })] });
    expect(series(chart).filter((s) => s.type === "line" && s.data.length > 10 && !s.silent).length).toBe(2);
    expect(chart.insights.length).toBe(2);
    const hist = ip.plot({ marks: [ip.auto(cats, { x: "v" })] });
    expect(series(hist)[0].type).toBe("custom");
    const bars = ip.plot({ marks: [ip.auto(cats, { x: "cat", y: { value: "v", reduce: "sum" }, insights: { categoryOutliers: true } })] });
    expect(series(bars)[0].type).toBe("bar");
    expect(bars.insights[0].summary).toContain("d (z");
  });
});

describe("render", () => {
  it("renders to SVG without a DOM", async () => {
    const chart = ip.plot({
      marks: [ip.areaY(ts, ip.windowY(7, { x: "date", y: "value", fill: "series", fillOpacity: 0.2 })), ip.lineY(ts, { x: "date", y: "value", stroke: "series" })],
      insights: { anomalies: true, forecast: true },
      title: "Smoke",
      width: 800,
      height: 400,
    });
    const svg = await chart.toSVG();
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("Smoke");
    expect(svg.length).toBeGreaterThan(5000);
  });
  it("renders every mark type", async () => {
    const d = Array.from({ length: 24 }, (_, i) => ({ x: i, y: Math.sin(i / 3) * 10 + 20, c: ["p", "q", "r"][i % 3], d: new Date(Date.UTC(2024, i % 12, 1)) }));
    const chart = ip.plot({
      marks: [
        ip.barY(d, ip.groupX({ y: "sum" }, { x: "c", y: "y", fill: "c" })),
        ip.text(d.slice(0, 3), { x: "c", y: "y", text: "c" }),
        ip.ruleX(["p"]),
      ],
      x: { label: "category" },
      y: { grid: true, zero: true, label: "total" },
      color: { legend: true },
      theme: "dark",
    });
    const svg = await chart.toSVG({ width: 400, height: 300 });
    expect(svg).toContain("<svg");
    const cellChart = ip.plot({ marks: [ip.cell(d, ip.group({ fill: "count" }, { x: "c", y: (r) => String((r.x as number) % 2) }))] });
    expect(await cellChart.toSVG()).toContain("<svg");
    const rectChart = ip.plot({ marks: [ip.rectY(d, ip.binX({ y: "count", thresholds: 6 }, { x: "y" })), ip.frame(), ip.gridX()] });
    expect(await rectChart.toSVG()).toContain("<svg");
    const dotChart = ip.plot({ marks: [ip.dot(d, { x: "x", y: "y", r: "y", fill: "y" })], x: { zoom: true } });
    expect(await dotChart.toSVG()).toContain("<svg");
    const facetChart = ip.plot({ marks: [ip.lineY(d, { x: "x", y: "y", fx: "c" })], facet: { x: "c" } });
    expect(await facetChart.toSVG()).toContain("<svg");
    const diff = ip.plot({ marks: [ip.differenceY(d, { x: "x", y: "y" })] });
    expect(await diff.toSVG()).toContain("<svg");
  });
});
