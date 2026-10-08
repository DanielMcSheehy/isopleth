/** Channel resolution and type inference. */

import type { ChannelSpec, ChannelValue, Row, ScaleType, Value } from "./types.js";

/** Use the datum itself as the channel value (Plot's `Plot.identity`). */
export const identity: unique symbol = Symbol("isopleth.identity");
/** Use the datum's index as the channel value (Plot's `Plot.indexOf`). */
export const indexOf: unique symbol = Symbol("isopleth.indexOf");

const NAMED_COLORS = new Set([
  "black", "silver", "gray", "grey", "white", "maroon", "red", "purple", "fuchsia", "green", "lime", "olive", "yellow", "navy",
  "blue", "teal", "aqua", "orange", "aliceblue", "antiquewhite", "aquamarine", "azure", "beige", "bisque", "blanchedalmond",
  "blueviolet", "brown", "burlywood", "cadetblue", "chartreuse", "chocolate", "coral", "cornflowerblue", "cornsilk", "crimson",
  "cyan", "darkblue", "darkcyan", "darkgoldenrod", "darkgray", "darkgreen", "darkgrey", "darkkhaki", "darkmagenta",
  "darkolivegreen", "darkorange", "darkorchid", "darkred", "darksalmon", "darkseagreen", "darkslateblue", "darkslategray",
  "darkslategrey", "darkturquoise", "darkviolet", "deeppink", "deepskyblue", "dimgray", "dimgrey", "dodgerblue", "firebrick",
  "floralwhite", "forestgreen", "gainsboro", "ghostwhite", "gold", "goldenrod", "greenyellow", "honeydew", "hotpink",
  "indianred", "indigo", "ivory", "khaki", "lavender", "lavenderblush", "lawngreen", "lemonchiffon", "lightblue",
  "lightcoral", "lightcyan", "lightgoldenrodyellow", "lightgray", "lightgreen", "lightgrey", "lightpink", "lightsalmon",
  "lightseagreen", "lightskyblue", "lightslategray", "lightslategrey", "lightsteelblue", "lightyellow", "limegreen", "linen",
  "magenta", "mediumaquamarine", "mediumblue", "mediumorchid", "mediumpurple", "mediumseagreen", "mediumslateblue",
  "mediumspringgreen", "mediumturquoise", "mediumvioletred", "midnightblue", "mintcream", "mistyrose", "moccasin",
  "navajowhite", "oldlace", "olivedrab", "orangered", "orchid", "palegoldenrod", "palegreen", "paleturquoise",
  "palevioletred", "papayawhip", "peachpuff", "peru", "pink", "plum", "powderblue", "rosybrown", "royalblue", "saddlebrown",
  "salmon", "sandybrown", "seagreen", "seashell", "sienna", "skyblue", "slateblue", "slategray", "slategrey", "snow",
  "springgreen", "steelblue", "tan", "thistle", "tomato", "turquoise", "violet", "wheat", "whitesmoke", "yellowgreen",
  "rebeccapurple", "transparent", "currentcolor", "none",
]);

/** True when `v` is a CSS color string (so `fill: "red"` is a constant, not a field). */
export function isColor(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const s = v.trim().toLowerCase();
  return s.startsWith("#") || s.startsWith("rgb") || s.startsWith("hsl") || s.startsWith("var(") || NAMED_COLORS.has(s);
}

export function isGradient(v: unknown): v is { type: string; colorStops: unknown[] } {
  return typeof v === "object" && v !== null && "colorStops" in v;
}

export function isChannelSpec(v: unknown): v is ChannelSpec {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date) && !ArrayBuffer.isView(v) && "value" in v;
}

function isArrayLike(v: unknown): v is ArrayLike<Value> {
  return (Array.isArray(v) || ArrayBuffer.isView(v)) && typeof v !== "string";
}

/**
 * Resolve a channel definition against `data`. Returns `undefined` for an
 * undefined channel, otherwise an array of the same length as `data`.
 */
export function valueof<D = Row>(data: readonly D[], value: ChannelValue<D> | typeof identity | typeof indexOf | undefined): Value[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (value === identity) return data as unknown as Value[];
  if (value === indexOf) return data.map((_, i) => i);
  if (isChannelSpec(value)) return valueof(data, value.value as ChannelValue<D>);
  if (typeof value === "function") return data.map((d, i) => (value as (d: D, i: number, data: readonly D[]) => Value)(d, i, data));
  if (typeof value === "string") return data.map((d) => (d as Record<string, Value> | null)?.[value]);
  if (isArrayLike(value)) {
    if (value.length !== data.length) throw new Error(`channel array length ${value.length} does not match data length ${data.length}`);
    return Array.from(value as ArrayLike<Value>);
  }
  // Constant (number, Date, boolean).
  return data.map(() => value as Value);
}

/** Field name/label for a channel definition, if it has an obvious one. */
export function labelof(value: unknown, fallback?: string): string | undefined {
  if (typeof value === "string") return value;
  if (isChannelSpec(value)) return value.label ?? labelof(value.value);
  return fallback;
}

/** Infer the scale type from the first non-missing value. */
export function inferType(values: readonly Value[] | undefined): ScaleType | undefined {
  if (!values) return undefined;
  for (const v of values) {
    if (v === null || v === undefined) continue;
    if (typeof v === "number") {
      if (Number.isNaN(v)) continue;
      return "quantitative";
    }
    if (v instanceof Date) return Number.isNaN(+v) ? undefined : "temporal";
    if (typeof v === "string" || typeof v === "boolean") return "ordinal";
    if (typeof v === "bigint") return "quantitative";
  }
  return undefined;
}

export function isMissing(v: Value): boolean {
  return v === null || v === undefined || (typeof v === "number" && Number.isNaN(v)) || (v instanceof Date && Number.isNaN(+v));
}

/** Convert continuous values to numbers (dates → epoch ms); missing → NaN. */
export function toNumbers(values: readonly Value[]): Float64Array {
  const out = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = toNumber(values[i]);
  return out;
}

export function toNumber(v: Value): number {
  if (typeof v === "number") return v;
  if (v instanceof Date) return +v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string" && v !== "" && !Number.isNaN(Number(v))) return Number(v);
  return NaN;
}

/** Key used to group ordinal values (`Date` → ms, else primitive). */
export function keyof(v: Value): string | number | boolean | null {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return +v;
  if (typeof v === "number" && Number.isNaN(v)) return null;
  return v as string | number | boolean;
}

/** Encode values as integer codes over their distinct (first-seen) order. */
export function encode(values: readonly Value[], domain?: readonly Value[]): { codes: Int32Array; domain: Value[] } {
  const index = new Map<string | number | boolean, number>();
  const dom: Value[] = [];
  if (domain) {
    for (const d of domain) {
      const k = keyof(d);
      if (k !== null && !index.has(k)) {
        index.set(k, dom.length);
        dom.push(d);
      }
    }
  }
  const codes = new Int32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const k = keyof(values[i]);
    if (k === null) {
      codes[i] = -1;
      continue;
    }
    let c = index.get(k);
    if (c === undefined) {
      if (domain) {
        codes[i] = -1;
        continue;
      }
      c = dom.length;
      index.set(k, c);
      dom.push(values[i]);
    }
    codes[i] = c;
  }
  return { codes, domain: dom };
}

/** Ascending comparator for mixed values (numbers, dates, strings). */
export function ascending(a: Value, b: Value): number {
  if (isMissing(a)) return isMissing(b) ? 0 : 1;
  if (isMissing(b)) return -1;
  if (a instanceof Date || b instanceof Date) return toNumber(a) - toNumber(b);
  if (typeof a === "number" && typeof b === "number") return a - b;
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

export function descending(a: Value, b: Value): number {
  return ascending(b, a);
}

/** Format a value for labels/tooltips/summaries. */
export function formatValue(v: Value, type?: ScaleType): string {
  if (isMissing(v)) return "";
  if (v instanceof Date || type === "temporal") {
    const d = v instanceof Date ? v : new Date(toNumber(v));
    const hasTime = d.getUTCHours() || d.getUTCMinutes() || d.getUTCSeconds();
    return hasTime ? d.toISOString().replace("T", " ").replace(/:\d\d\.\d{3}Z$/, "") : d.toISOString().slice(0, 10);
  }
  if (typeof v === "number") {
    if (Number.isInteger(v)) return String(v);
    const a = Math.abs(v);
    if (a >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
    if (a >= 10) return v.toLocaleString(undefined, { maximumFractionDigits: 1 });
    return v.toLocaleString(undefined, { maximumSignificantDigits: 3 });
  }
  return String(v);
}
