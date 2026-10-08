import { describe, expect, it } from "vitest";
import * as ip from "../index.js";
import type { Row, Transform } from "../types.js";

const run = (data: Row[], options: ip.MarkOptions) => {
  const t = options.transform as Transform | undefined;
  const facets = [data.map((_, i) => i)];
  const r = t ? t(data, facets) : { data, facets };
  const channels: Record<string, unknown[] | undefined> = {};
  for (const k of ["x", "y", "x1", "x2", "y1", "y2", "z", "fill", "stroke"]) {
    const v = (options as Record<string, unknown>)[k];
    if (v !== undefined && !ip.isColor(v)) channels[k] = ip.valueof(r.data, v as ip.ChannelValue);
  }
  return { ...r, channels };
};

describe("bin / group", () => {
  const data = Array.from({ length: 100 }, (_, i) => ({ w: i * 0.37, sex: i % 3 === 0 ? "F" : "M", v: i }));
  it("binX counts with full-width uniform bins", () => {
    const r = run(data, ip.binX({ y: "count" }, { x: "w" }));
    const x1 = r.channels.x1 as number[];
    const x2 = r.channels.x2 as number[];
    expect(x1.length).toBeGreaterThan(3);
    const widths = x1.map((a, i) => x2[i] - a);
    for (const w of widths) expect(Math.abs(w - widths[0])).toBeLessThan(1e-9);
    const total = (r.channels.y as number[]).reduce((a, b) => a + b, 0);
    expect(total).toBe(100);
  });
  it("binX with fill groups and sum reducer", () => {
    const r = run(data, ip.binX({ y: "sum", thresholds: 5 }, { x: "w", y: "v", fill: "sex" }));
    const fills = new Set(r.channels.fill);
    expect(fills).toEqual(new Set(["F", "M"]));
    const total = (r.channels.y as number[]).reduce((a, b) => a + b, 0);
    expect(total).toBe(data.reduce((a, d) => a + d.v, 0));
  });
  it("groupX with ordinal keys in natural order", () => {
    const r = run(data, ip.groupX({ y: "mean" }, { x: "sex", y: "v" }));
    expect(r.channels.x).toEqual(["F", "M"]);
    const ys = r.channels.y as number[];
    expect(ys[0]).toBeCloseTo(data.filter((d) => d.sex === "F").reduce((a, d) => a + d.v, 0) / 34, 6);
  });
  it("group on x and y (2D)", () => {
    const r = run(data, ip.group({ fill: "count" }, { x: "sex", y: (d) => (Number(d.v) % 2 ? "odd" : "even") }));
    expect(r.data.length).toBe(4);
    expect((r.channels.fill as number[]).reduce((a, b) => a + b, 0)).toBe(100);
  });
  it("bins dates on calendar intervals", () => {
    const dates = Array.from({ length: 60 }, (_, i) => ({ d: new Date(Date.UTC(2024, 0, 1 + i)), n: 1 }));
    const r = run(dates, ip.binX({ y: "count", interval: "week" }, { x: "d" }));
    expect(r.data.length).toBe(9);
    expect(r.channels.x1![0]).toBeInstanceOf(Date);
    const total = (r.channels.y as number[]).reduce((a, b) => a + b, 0);
    expect(total).toBe(60);
  });
  it("keeps empty bins with filter: null", () => {
    const sparse = [{ w: 0 }, { w: 10 }];
    const r = run(sparse, ip.binX({ y: "count", thresholds: 10, filter: null }, { x: "w" }));
    expect(r.data.length).toBeGreaterThan(5);
    expect((r.channels.y as number[]).filter((v) => v === 0).length).toBeGreaterThan(3);
  });
});

describe("stack / window / map", () => {
  const data = [
    { x: 1, y: 1, k: "a" },
    { x: 1, y: 2, k: "b" },
    { x: 2, y: 3, k: "a" },
    { x: 2, y: -1, k: "b" },
  ];
  it("stackY produces y1/y2 and diverges negatives", () => {
    const r = run(data, ip.stackY({ x: "x", y: "y", fill: "k" }));
    expect(r.channels.y1).toEqual([0, 1, 0, 0]);
    expect(r.channels.y2).toEqual([1, 3, 3, -1]);
  });
  it("stackY normalize", () => {
    const r = run(data.slice(0, 2), ip.stackY({ offset: "normalize" }, { x: "x", y: "y", fill: "k" }));
    expect(r.channels.y2).toEqual([1 / 3, 1]);
  });
  it("windowY rolls per series in input order", () => {
    const d = [1, 2, 3, 4, 10, 20, 30, 40].map((y, i) => ({ y, x: i % 4, s: i < 4 ? "a" : "b" }));
    const r = run(d, ip.windowY({ k: 2, anchor: "end" }, { x: "x", y: "y", stroke: "s" }));
    expect(r.channels.y).toEqual([1, 1.5, 2.5, 3.5, 10, 15, 25, 35]);
  });
  it("mapY cumsum and normalizeY first", () => {
    const d = [1, 2, 3].map((y, i) => ({ y, x: i }));
    expect(run(d, ip.mapY("cumsum", { x: "x", y: "y" })).channels.y).toEqual([1, 3, 6]);
    expect(run(d, ip.normalizeY("first", { x: "x", y: "y" })).channels.y).toEqual([1, 2, 3]);
    expect(run(d, ip.normalizeY({ x: "x", y: "y" })).channels.y).toEqual([1, 2, 3]);
  });
  it("imputeY fills gaps", () => {
    const d = [1, null, 3].map((y, i) => ({ y, x: i }));
    expect(run(d, ip.imputeY("linear", { x: "x", y: "y" })).channels.y).toEqual([1, 2, 3]);
  });
  it("shiftX offsets x1 by an interval", () => {
    const d = [{ x: new Date(Date.UTC(2024, 0, 1)), y: 1 }];
    const r = run(d, ip.shiftX("+1 month", { x: "x", y: "y" }));
    expect((r.channels.x1![0] as Date).toISOString()).toBe("2024-02-01T00:00:00.000Z");
    expect((r.channels.x2![0] as Date).toISOString()).toBe("2024-01-01T00:00:00.000Z");
  });
});

describe("interval / select / basic", () => {
  it("intervalX inserts gaps for missing days and reduces duplicates", () => {
    const d = [
      { t: new Date(Date.UTC(2024, 0, 1)), v: 1 },
      { t: new Date(Date.UTC(2024, 0, 1, 12)), v: 3 },
      { t: new Date(Date.UTC(2024, 0, 4)), v: 4 },
    ];
    const r = run(d, ip.intervalX({ interval: "day", reduce: "sum" }, { x: "t", y: "v" }));
    expect(r.data.length).toBe(4);
    expect(r.channels.y).toEqual([4, null, null, 4]);
    const filled = run(d, ip.intervalX({ interval: "day", fill: 0 }, { x: "t", y: "v" }));
    expect(filled.channels.y).toEqual([1, 0, 0, 4]);
  });
  it("select and basic transforms operate on facets", () => {
    const d = [3, 1, 2].map((y, i) => ({ y, x: i }));
    expect(run(d, ip.selectMaxY({ x: "x", y: "y" })).facets[0]).toEqual([0]);
    expect(run(d, ip.sort("y", { x: "x", y: "y" })).facets[0]).toEqual([1, 2, 0]);
    expect(run(d, ip.filter((dd) => (dd.y as number) > 1, { x: "x", y: "y" })).facets[0]).toEqual([0, 2]);
    expect(run(d, ip.reverse({ x: "x", y: "y" })).facets[0]).toEqual([2, 1, 0]);
  });
  it("transforms compose inner-first", () => {
    const data = Array.from({ length: 50 }, (_, i) => ({ w: i, g: i % 2 ? "a" : "b" }));
    const r = run(data, ip.windowY(3, ip.binX({ y: "count", thresholds: 10 }, { x: "w", fill: "g" })));
    expect(r.data.length).toBeGreaterThan(0);
    expect((r.channels.y as number[]).every(Number.isFinite)).toBe(true);
  });
});
