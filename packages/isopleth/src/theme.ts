/**
 * Themes. A theme is a small set of design tokens — surface, ink, grid, font,
 * a categorical palette validated for its surface, sequential/diverging ramps,
 * the insight colours and a few mark specs. The compiler reads nothing else
 * for styling, so a chart is restyled completely by swapping the theme.
 *
 * ```ts
 * plot({ theme: "dark", ... })                             // built-in
 * plot({ theme: { ...themes.dark, categorical: [...] } })  // one-off tweak
 * defineTheme("brand", "light", { categorical: brandColors, font: "Inter" })
 * plot({ theme: "brand", ... })
 * ```
 *
 * The categorical palettes were checked with the dataviz validator (lightness
 * band, chroma floor, adjacent-pair CVD separation, normal-vision floor,
 * contrast vs. the surface) — assign them in order, never cycle.
 */

export interface ThemeInsightColors {
  anomaly: string;
  forecast: string;
  changepoint: string;
  trend: string;
  outlier: string;
  rare: string;
  dominant: string;
  band: string;
  seriesOutlier: string;
  positive: string;
  negative: string;
}

export interface ThemeMarkSpecs {
  /** Line width in px (2 by default: thin, round caps). */
  lineWidth: number;
  /** Opacity of a single (unstacked) area fill — a wash, not a block. */
  areaOpacity: number;
  /** Opacity of stacked area bands. */
  stackOpacity: number;
  /** Corner radius at a bar's data end. */
  barRadius: number;
  /** Maximum bar thickness in px. */
  barMaxWidth: number;
  /** Dot radius in px. */
  dotRadius: number;
  /** Width of the surface-coloured gap between touching marks (stack segments, bars, dot rings). */
  gap: number;
}

export interface Theme {
  name: string;
  mode: "light" | "dark";
  /** Chart surface. Used for gaps/rings even when the chart background is transparent. */
  background: string;
  /** Raised surface (tooltips, panels). */
  surface: string;
  /** Ink. */
  text: string;
  textSecondary: string;
  textMuted: string;
  /** Hairline grid and axis colours. */
  grid: string;
  axis: string;
  /** Accent used for UI chrome (zoom handles, selection). */
  accent: string;
  font: string;
  fontMono: string;
  categorical: string[];
  sequential: string[];
  diverging: string[];
  insight: ThemeInsightColors;
  mark: ThemeMarkSpecs;
}

const FONT = '"Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const MONO = 'ui-monospace, "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace';

export const light: Theme = {
  name: "light",
  mode: "light",
  background: "#fbfbf9",
  surface: "#ffffff",
  text: "#1b1f24",
  textSecondary: "#4f5560",
  textMuted: "#8b919c",
  grid: "#e6e6e1",
  axis: "#c9c9c2",
  accent: "#2a78d6",
  font: FONT,
  fontMono: MONO,
  // Validated on #fbfbf9: adjacent CVD ΔE 9.1, normal-vision 19.6.
  categorical: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
  sequential: ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"],
  diverging: ["#c0392b", "#e8846f", "#f0efec", "#6da7ec", "#1c5cab"],
  insight: {
    anomaly: "#e34948",
    forecast: "#4a3aa7",
    changepoint: "#eb6834",
    trend: "#8b919c",
    outlier: "#e34948",
    rare: "#8b919c",
    dominant: "#eda100",
    band: "#4a3aa7",
    seriesOutlier: "#e34948",
    positive: "#008300",
    negative: "#2a78d6",
  },
  mark: { lineWidth: 2, areaOpacity: 0.12, stackOpacity: 0.9, barRadius: 4, barMaxWidth: 28, dotRadius: 4, gap: 2 },
};

export const dark: Theme = {
  name: "dark",
  mode: "dark",
  background: "#0e1222",
  surface: "#161b2e",
  text: "#eef1f8",
  textSecondary: "#aab3c8",
  textMuted: "#6f7891",
  grid: "#1f2640",
  axis: "#2f375a",
  accent: "#4a7df0",
  font: FONT,
  fontMono: MONO,
  // Cool-first palette validated on #0e1222: adjacent CVD ΔE 14.3, normal-vision 21.0, all ≥ 3:1.
  categorical: ["#4a7df0", "#0baa92", "#a86bfd", "#eb5f3d", "#0da2c6", "#b57400", "#c23a82", "#6a9a08"],
  sequential: ["#13203f", "#1f3b7a", "#2b5ab4", "#3f7de8", "#5aa1f5", "#8ac6fb", "#c6e6ff"],
  diverging: ["#eb5f3d", "#b06a5e", "#3a3f55", "#4a7df0", "#8ac6fb"],
  insight: {
    anomaly: "#ff5c7a",
    forecast: "#a86bfd",
    changepoint: "#f5b545",
    trend: "#8b93a8",
    outlier: "#ff5c7a",
    rare: "#6f7891",
    dominant: "#f5b545",
    band: "#4a7df0",
    seriesOutlier: "#ff5c7a",
    positive: "#2ec27e",
    negative: "#4a7df0",
  },
  mark: { lineWidth: 2, areaOpacity: 0.16, stackOpacity: 0.9, barRadius: 4, barMaxWidth: 28, dotRadius: 4, gap: 2 },
};

/** Neutral high-contrast theme for print / reports. */
export const ink: Theme = {
  ...light,
  name: "ink",
  background: "#ffffff",
  surface: "#ffffff",
  text: "#000000",
  textSecondary: "#333333",
  textMuted: "#777777",
  grid: "#e2e2e2",
  axis: "#000000",
  accent: "#000000",
  categorical: ["#1f3a93", "#c0392b", "#1e8449", "#b9770e", "#7d3c98", "#117a8b", "#5d6d7e", "#000000"],
};

export const themes: Record<string, Theme> = { light, dark, ink };

/** Register (or replace) a named theme derived from a base theme. */
export function defineTheme(name: string, base: string | Theme = "light", overrides: Partial<Theme> = {}): Theme {
  const b = typeof base === "string" ? resolveTheme(base) : base;
  const t: Theme = { ...b, ...overrides, name, insight: { ...b.insight, ...(overrides.insight ?? {}) }, mark: { ...b.mark, ...(overrides.mark ?? {}) } };
  themes[name] = t;
  return t;
}

/** Resolve a `theme` option: a name, a full theme, or a partial over `light`/`dark` (picked by `mode`). */
export function resolveTheme(theme: string | Partial<Theme> | undefined): Theme {
  if (!theme) return themes.light;
  if (typeof theme === "string") {
    const t = themes[theme];
    if (!t) throw new Error(`unknown theme "${theme}" (known: ${Object.keys(themes).join(", ")})`);
    return t;
  }
  const base = themes[theme.name ?? ""] ?? (theme.mode === "dark" ? themes.dark : themes.light);
  return { ...base, ...theme, name: theme.name ?? base.name, insight: { ...base.insight, ...(theme.insight ?? {}) }, mark: { ...base.mark, ...(theme.mark ?? {}) } };
}

/** CSS custom properties for a theme (handy for the host page around a chart). */
export function themeToCSSVars(t: Theme, prefix = "--ip"): Record<string, string> {
  const vars: Record<string, string> = {
    [`${prefix}-bg`]: t.background,
    [`${prefix}-surface`]: t.surface,
    [`${prefix}-text`]: t.text,
    [`${prefix}-text-2`]: t.textSecondary,
    [`${prefix}-text-3`]: t.textMuted,
    [`${prefix}-grid`]: t.grid,
    [`${prefix}-axis`]: t.axis,
    [`${prefix}-accent`]: t.accent,
    [`${prefix}-font`]: t.font,
    [`${prefix}-mono`]: t.fontMono,
  };
  t.categorical.forEach((c, i) => (vars[`${prefix}-c${i + 1}`] = c));
  return vars;
}
