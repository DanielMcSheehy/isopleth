import { describe, expect, it } from "vitest";
import * as ip from "../index.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const rows = Array.from({ length: 90 }, (_, i) => ({
  date: new Date(Date.UTC(2024, 0, 1 + i)),
  value: 100 + i + 10 * Math.sin(i / 3),
  series: ["a", "b", "c"][i % 3],
  region: ["N", "S"][i % 2],
}));

describe("spec", () => {
  it("inspects fields", () => {
    const f = ip.inspectFields(rows);
    expect(f.find((d) => d.name === "date")?.type).toBe("temporal");
    expect(f.find((d) => d.name === "value")?.type).toBe("quantitative");
    expect(f.find((d) => d.name === "series")?.values).toEqual(["a", "b", "c"]);
  });

  it("builds every mark kind", () => {
    const specs: ip.ChartSpec[] = [
      { mark: "auto", x: "date", y: "value", color: "series" },
      { mark: "line", x: "date", y: "value", color: "series", window: 7, insights: { anomalies: true } },
      { mark: "area", x: "date", y: "value", color: "series", stack: "normalize", gradient: true },
      { mark: "area", x: "date", y: "value", color: "series", stack: false },
      { mark: "bar", x: "region", y: "value", reduce: "sum", color: "series", sort: "-y" },
      { mark: "bar", x: "region", y: "value", reduce: "mean", color: "series", stack: false },
      { mark: "dot", x: "date", y: "value", color: "series", size: "value" },
      { mark: "cell", x: "region", y: "series", color: "value", reduce: "mean" },
      { mark: "histogram", x: "value", color: "series", bins: 12 },
      { mark: "line", x: "date", y: "value", facet: "region", interval: "week", reduce: "sum" },
    ];
    for (const spec of specs) {
      const chart = ip.plot(ip.fromSpec(rows, spec));
      expect((chart.option.series as any[]).length, spec.mark).toBeGreaterThan(0);
      const code = ip.specToCode(spec);
      expect(code.startsWith("ip.plot({")).toBe(true);
      expect(code).toContain(spec.mark === "histogram" ? "ip.rectY" : spec.mark === "auto" ? "ip.auto" : "ip.");
    }
  });

  it("applies colour overrides and theme", () => {
    const chart = ip.plot(ip.fromSpec(rows, { mark: "line", x: "date", y: "value", color: "series", colors: { b: "#ff0000" }, theme: "dark" }));
    expect(chart.scales.color.colorOf("b")).toBe("#ff0000");
    expect(chart.scales.color.colorOf("a")).toBe(ip.themes.dark.categorical[0]);
    expect(chart.theme.name).toBe("dark");
    expect((chart.option.xAxis as any[])[0].name).toBe("date");
  });

  it("carries axis labels through transforms", () => {
    const chart = ip.plot({ marks: [ip.barY(rows, ip.groupX({ y: "sum" }, { x: "region", y: "value" }))] });
    expect((chart.option.xAxis as any[])[0].name).toBe("region");
    expect((chart.option.yAxis as any[])[0].name).toBe("sum of value");
    const smooth = ip.plot({ marks: [ip.lineY(rows, ip.windowY(7, ip.stackY({ x: "date", y: "value", fill: "series" })))] });
    expect((smooth.option.yAxis as any[])[0].name).toBe("value");
  });
});

describe("themes", () => {
  it("resolves, derives and exposes css vars", () => {
    const t = ip.defineTheme("brand", "light", { categorical: ["#111111", "#222222"], accent: "#123456" });
    expect(ip.resolveTheme("brand").accent).toBe("#123456");
    expect(ip.resolveTheme({ mode: "dark", grid: "#000" }).grid).toBe("#000");
    expect(ip.resolveTheme({ mode: "dark", grid: "#000" }).text).toBe(ip.themes.dark.text);
    expect(ip.themeToCSSVars(t)["--ip-c1"]).toBe("#111111");
    expect(() => ip.resolveTheme("nope")).toThrow();
    const chart = ip.plot({ marks: [ip.lineY(rows, { x: "date", y: "value", stroke: "series" })], theme: "brand" });
    expect((chart.option as any).color).toEqual(["#111111", "#222222", "#111111"]);
    expect((chart.option.series as any[])[0].lineStyle.width).toBe(2);
  });
});
