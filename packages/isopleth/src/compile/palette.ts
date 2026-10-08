/** Color schemes. Categorical palettes are arrays; continuous ones are stop lists interpolated by ECharts' visualMap. */

export const SCHEMES: Record<string, string[]> = {
  // Categorical
  observable10: ["#4269d0", "#efb118", "#ff725c", "#6cc5b0", "#3ca951", "#ff8ab7", "#a463f2", "#97bbf5", "#9c6b4e", "#9498a0"],
  echarts: ["#5070dd", "#b6d634", "#505372", "#ff994d", "#0ca8df", "#ffd10a", "#fb628b", "#785db0", "#3fbe95"],
  tableau10: ["#4e79a7", "#f28e2c", "#e15759", "#76b7b2", "#59a14f", "#edc949", "#af7aa1", "#ff9da7", "#9c755f", "#bab0ab"],
  category10: ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf"],
  pastel: ["#8dd3c7", "#bebada", "#fb8072", "#80b1d3", "#fdb462", "#b3de69", "#fccde5", "#d9d9d9", "#bc80bd", "#ccebc5"],
  dark2: ["#1b9e77", "#d95f02", "#7570b3", "#e7298a", "#66a61e", "#e6ab02", "#a6761d", "#666666"],
  // Sequential
  blues: ["#f7fbff", "#c6dbef", "#6baed6", "#2171b5", "#08306b"],
  greens: ["#f7fcf5", "#c7e9c0", "#74c476", "#238b45", "#00441b"],
  reds: ["#fff5f0", "#fcbba1", "#fb6a4a", "#cb181d", "#67000d"],
  oranges: ["#fff5eb", "#fdd0a2", "#fd8d3c", "#d94801", "#7f2704"],
  purples: ["#fcfbfd", "#dadaeb", "#9e9ac8", "#6a51a3", "#3f007d"],
  greys: ["#ffffff", "#d9d9d9", "#969696", "#525252", "#000000"],
  viridis: ["#440154", "#414487", "#2a788e", "#22a884", "#7ad151", "#fde725"],
  magma: ["#000004", "#3b0f70", "#8c2981", "#de4968", "#fe9f6d", "#fcfdbf"],
  inferno: ["#000004", "#420a68", "#932667", "#dd513a", "#fca50a", "#fcffa4"],
  plasma: ["#0d0887", "#6a00a8", "#b12a90", "#e16462", "#fca636", "#f0f921"],
  turbo: ["#23171b", "#4a58dd", "#2fd8ca", "#a3fd3d", "#fa8a24", "#900c00"],
  ylgnbu: ["#ffffd9", "#c7e9b4", "#41b6c4", "#225ea8", "#081d58"],
  ylorrd: ["#ffffb2", "#fecc5c", "#fd8d3c", "#f03b20", "#bd0026"],
  // Diverging
  rdbu: ["#67001f", "#d6604d", "#f7f7f7", "#4393c3", "#053061"],
  burd: ["#053061", "#4393c3", "#f7f7f7", "#d6604d", "#67001f"],
  brbg: ["#543005", "#bf812d", "#f5f5f5", "#35978f", "#003c30"],
  piyg: ["#8e0152", "#de77ae", "#f7f7f7", "#7fbc41", "#276419"],
  spectral: ["#9e0142", "#f46d43", "#ffffbf", "#66c2a5", "#5e4fa2"],
  rdylgn: ["#a50026", "#f46d43", "#ffffbf", "#66bd63", "#006837"],
};

export const DEFAULT_CATEGORICAL = "observable10";
export const DEFAULT_SEQUENTIAL = "viridis";
export const DEFAULT_DIVERGING = "rdbu";

/** Colors used by insight marks. */
export const INSIGHT_COLORS = {
  anomaly: "#e4572e",
  forecast: "#785db0",
  changepoint: "#ff994d",
  trend: "#9498a0",
  outlier: "#e4572e",
  rare: "#9498a0",
  dominant: "#efb118",
  band: "#785db0",
  seriesOutlier: "#e4572e",
  positive: "#3ca951",
  negative: "#4269d0",
};

export function scheme(name: string | undefined, fallback: string): string[] {
  if (!name) return SCHEMES[fallback];
  const s = SCHEMES[name.toLowerCase()];
  if (!s) throw new Error(`unknown color scheme: ${name}`);
  return s;
}

/** Parse a hex/rgb color into [r, g, b, a]. */
export function parseColor(c: string): [number, number, number, number] | null {
  const s = c.trim();
  const hex = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((ch) => ch + ch).join("");
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return [r, g, b, a];
  }
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : Number(rgb[4])];
  return null;
}

/** Relative luminance (0..1) of a hex/rgb colour; 0.5 when unparseable. */
export function luminance(color: string): number {
  const p = parseColor(color);
  if (!p) return 0.5;
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(p[0]) + 0.7152 * lin(p[1]) + 0.0722 * lin(p[2]);
}

/** Black or white ink for text placed on `fill`. */
export function inkOn(fill: string): string {
  return luminance(fill) > 0.42 ? "#111318" : "#ffffff";
}

/** `color` with its alpha multiplied by `opacity` (falls back to the color itself if unparseable). */
export function withOpacity(color: string, opacity: number): string {
  const p = parseColor(color);
  if (!p) return color;
  return `rgba(${p[0]},${p[1]},${p[2]},${(p[3] * opacity).toFixed(3)})`;
}

/** Vertical ECharts linear gradient from `color` to transparent (the classic area fade). */
export function fadeGradient(color: string, top = 0.6, bottom = 0.02): { type: "linear"; x: number; y: number; x2: number; y2: number; colorStops: { offset: number; color: string }[] } {
  return { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: withOpacity(color, top) }, { offset: 1, color: withOpacity(color, bottom) }] };
}
