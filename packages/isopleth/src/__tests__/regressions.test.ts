import { describe, expect, it } from "vitest";
import * as ip from "../index.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const series = (chart: ip.Chart) => chart.option.series as any[];
const tasks = [
  { name: "design", start: new Date(Date.UTC(2024, 0, 1)), end: new Date(Date.UTC(2024, 0, 10)), color: "#e15759" },
  { name: "build", start: new Date(Date.UTC(2024, 0, 5)), end: new Date(Date.UTC(2024, 0, 20)), color: "#59a14f" },
  { name: "ship", start: new Date(Date.UTC(2024, 0, 18)), end: new Date(Date.UTC(2024, 0, 25)), color: "#4e79a7" },
];

describe("reported rendering bugs", () => {
  it("barX/rectX with x1/x2 draw floating bars and keep the time extent", async () => {
    for (const mark of [ip.barX(tasks, { y: "name", x1: "start", x2: "end" }), ip.rectX(tasks, { y: "name", x1: "start", x2: "end" })]) {
      const chart = ip.plot({ marks: [mark] });
      expect(chart.scales.x.zero).toBe(false);
      expect(chart.scales.x.extent).toEqual([Date.UTC(2024, 0, 1), Date.UTC(2024, 0, 25)]);
      const s = series(chart);
      expect(s.map((x) => x.type)).toEqual(["custom"]);
      expect(s[0].data[0]).toEqual(["design", Date.UTC(2024, 0, 1), Date.UTC(2024, 0, 10)]);
      expect(await chart.toSVG()).toContain("<svg");
    }
  });

  it("cell with a categorical fill draws one coloured series per category", async () => {
    const rows = ["a", "b"].flatMap((x) => ["p", "q"].map((y) => ({ x, y, kind: x === "a" ? "lo" : "hi" })));
    const chart = ip.plot({ marks: [ip.cell(rows, { x: "x", y: "y", fill: "kind" })] });
    const s = series(chart);
    expect(s.map((x) => [x.type, x.name, x.itemStyle.color])).toEqual([
      ["custom", "lo", chart.scales.color.colorOf("lo")],
      ["custom", "hi", chart.scales.color.colorOf("hi")],
    ]);
    expect(chart.option.visualMap).toBeUndefined();
    const svg = await chart.toSVG();
    expect(svg).toContain(`fill="${chart.scales.color.colorOf("hi")}"`);
  });

  it("stackX with numeric codes on a forced categorical colour scale stacks one series per code", () => {
    const rows = ["a", "b"].flatMap((cat) => [1, 2].map((g) => ({ cat, g, v: 3 })));
    const chart = ip.plot({ marks: [ip.barX(rows, ip.stackX({ x: "v", y: "cat", fill: "g" }))], color: { type: "categorical" } });
    const s = series(chart);
    expect(s.map((x) => x.name)).toEqual(["1", "2"]);
    expect(s.every((x) => x.type === "bar" && x.stack === s[0].stack)).toBe(true);
  });

  it("offset stacks with a continuous fill draw each segment between its own edges", () => {
    const rows = ["a", "b"].flatMap((cat) => [1, 2].map((g) => ({ cat, g, v: 3 })));
    const chart = ip.plot({ marks: [ip.barX(rows, ip.stackX({ offset: "center" }, { x: "v", y: "cat", fill: "g" }))] });
    const [s] = series(chart);
    expect(s.type).toBe("custom");
    expect(s.data.map((d: any[]) => d.slice(0, 3))).toEqual([["a", -3, 0], ["a", 0, 3], ["b", -3, 0], ["b", 0, 3]]);
  });

  it("fill given as literal colours (field or function) draws those colours without a legend", () => {
    for (const fill of ["color", (d: any) => d.color]) {
      const chart = ip.plot({ marks: [ip.barY(tasks, { x: "name", y: 1, fill })] });
      expect(series(chart).map((s) => s.itemStyle.color)).toEqual(tasks.map((t) => t.color));
      expect((chart.option.legend as any).show).toBe(false);
    }
  });
});

describe("reported layout bugs", () => {
  it("escape hatch arrays patch the generated axes by index", () => {
    const chart = ip.plot({ marks: [ip.lineY(tasks, { x: "start", y: "end" })], echarts: { yAxis: [{ name: "custom" }] } as any });
    const y = (chart.option.yAxis as any[])[0];
    expect(y.name).toBe("custom");
    expect(y.type).toBe("time");
  });

  it("default margins shrink so short charts keep a plot area", () => {
    const chart = ip.plot({ marks: [ip.lineY(tasks, { x: "start", y: "end" })], height: 60 });
    const [g] = chart.option.grid as any[];
    expect(parseFloat(g.top) + parseFloat(g.bottom)).toBeLessThanOrEqual(30);
    const tall = ip.plot({ marks: [ip.lineY(tasks, { x: "start", y: "end" })], height: 400 });
    expect((tall.option.grid as any[])[0]).toMatchObject({ top: "20px", bottom: "48px" });
    // Explicit margins are kept; only the defaults flex.
    const fixed = ip.plot({ marks: [ip.lineY(tasks, { x: "start", y: "end" })], height: 60, margin: { bottom: 30 } });
    expect((fixed.option.grid as any[])[0].bottom).toBe("30px");
    expect(chart.internals.gridFor(400)[0]).toMatchObject({ top: "20px", bottom: "48px" });
  });
});
