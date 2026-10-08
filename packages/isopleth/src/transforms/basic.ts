/** Transform plumbing: composition, lazy columns, filter/sort/reverse. */

import type { ChannelSpec, ChannelValue, Facets, MarkOptions, Row, SortOrder, Transform, TransformResult, Value } from "../types.js";
import { ascending, descending, isColor, valueof } from "../channel.js";

/** Compose two transforms; `t1` runs first (it is the inner one). */
export function composeTransform<D>(t1: Transform<D> | undefined, t2: Transform<D> | undefined): Transform<D> | undefined {
  if (!t1) return t2;
  if (!t2) return t1;
  return (data, facets) => {
    const r = t1(data, facets);
    return t2(r.data, r.facets);
  };
}

/**
 * A lazily-filled column: a channel whose values are set by a transform at
 * run time (Plot's `Plot.column`). Returns `[channel, setter]`.
 */
export function column(label?: string): [ChannelSpec, (values: ArrayLike<Value>) => void] {
  let values: ArrayLike<Value> | undefined;
  const spec: ChannelSpec = {
    value: (_d, i) => {
      if (!values) throw new Error("isopleth: column read before its transform ran");
      return values[i];
    },
    label,
  };
  return [spec, (v) => (values = v)];
}

/** True for `sort: {x: "y"}`-style scale-domain sorts (handled by scales, not data). */
export function isDomainSort(sort: unknown): sort is Record<string, unknown> {
  return (
    typeof sort === "object" &&
    sort !== null &&
    typeof sort !== "function" &&
    (sort as Record<string, unknown>).value === undefined &&
    (sort as Record<string, unknown>).channel === undefined
  );
}

function filterTransform<D>(test: ChannelValue<D>): Transform<D> {
  return (data, facets) => {
    const T = valueof(data, test);
    if (!T) return { data, facets };
    return { data, facets: facets.map((I) => I.filter((i) => Boolean(T[i]))) };
  };
}

function sortTransform<D>(sort: SortOrder<D>): Transform<D> {
  if (typeof sort === "function" && sort.length !== 1) {
    const cmp = sort as (a: D, b: D) => number;
    return (data, facets) => ({ data, facets: facets.map((I) => I.slice().sort((i, j) => cmp(data[i], data[j]))) });
  }
  let value: ChannelValue<D>;
  let order: "ascending" | "descending" = "ascending";
  if (typeof sort === "string" || typeof sort === "function") value = sort as ChannelValue<D>;
  else {
    const s = sort as { channel?: string; order?: "ascending" | "descending" };
    let ch = s.channel ?? "";
    if (ch.startsWith("-")) {
      ch = ch.slice(1);
      order = "descending";
    }
    value = ch;
    if (s.order) order = s.order;
  }
  return (data, facets) => {
    const V = valueof(data, value);
    if (!V) return { data, facets };
    const cmp = order === "descending" ? descending : ascending;
    return { data, facets: facets.map((I) => I.slice().sort((i, j) => cmp(V[i], V[j]))) };
  };
}

function reverseTransform<D>(data: readonly D[], facets: Facets): TransformResult<D> {
  return { data, facets: facets.map((I) => I.slice().reverse()) };
}

/**
 * Wrap `transform` around the basic `filter`/`sort`/`reverse` options and
 * return a copy of `options` carrying the composed transform. An explicit
 * `transform` in `options` overrides the basic ones (as in Plot).
 */
export function basic<D = Row>(options: MarkOptions<D> = {}, transform?: Transform<D>): MarkOptions<D> {
  const { filter, sort, reverse, transform: t0, ...rest } = options;
  let t1 = t0 as Transform<D> | undefined;
  if (t1 === undefined) {
    if (filter !== undefined && filter !== null) t1 = filterTransform(filter);
    if (sort !== undefined && sort !== null && !isDomainSort(sort)) t1 = composeTransform(t1, sortTransform(sort));
    if (reverse) t1 = composeTransform(t1, reverseTransform);
  }
  const out: MarkOptions<D> = { ...(rest as MarkOptions<D>) };
  if (sort !== undefined && isDomainSort(sort)) out.sort = sort as SortOrder<D>;
  const composed = composeTransform(t1, transform);
  if (composed) out.transform = composed;
  return out;
}

/** Explicit `filter` transform. */
export function filter<D = Row>(test: ChannelValue<D>, options: MarkOptions<D> = {}): MarkOptions<D> {
  return basic(options, filterTransform(test));
}

/** Explicit `sort` transform (data order, not scale domain). */
export function sort<D = Row>(order: SortOrder<D>, options: MarkOptions<D> = {}): MarkOptions<D> {
  return basic(options, sortTransform(order));
}

export function reverse<D = Row>(options: MarkOptions<D> = {}): MarkOptions<D> {
  return basic(options, reverseTransform);
}

/** Shuffle with a seeded LCG for reproducibility. */
export function shuffle<D = Row>({ seed = 42 }: { seed?: number } = {}, options: MarkOptions<D> = {}): MarkOptions<D> {
  return basic(options, (data, facets) => {
    let s = seed >>> 0;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    return {
      data,
      facets: facets.map((I) => {
        const J = I.slice();
        for (let i = J.length - 1; i > 0; i--) {
          const j = Math.floor(rnd() * (i + 1));
          [J[i], J[j]] = [J[j], J[i]];
        }
        return J;
      }),
    };
  });
}

/** Group facet indices by series (the `z` ?? `fill` ?? `stroke` channel). */
export function seriesOf<D>(data: readonly D[], I: readonly number[], options: MarkOptions<D>): number[][] {
  const zChannel = zOf(options);
  if (zChannel === undefined) return [I.slice()];
  const Z = valueof(data, zChannel);
  if (!Z) return [I.slice()];
  const groups = new Map<unknown, number[]>();
  for (const i of I) {
    const k = Z[i] instanceof Date ? +(Z[i] as Date) : Z[i];
    let g = groups.get(k);
    if (!g) groups.set(k, (g = []));
    g.push(i);
  }
  return [...groups.values()];
}

/** The series channel: `z`, else `fill` or `stroke` when those are data channels. */
export function zOf<D>(options: MarkOptions<D>): ChannelValue<D> | undefined {
  if (options.z !== undefined && options.z !== null) return options.z as ChannelValue<D>;
  if (isDataChannel(options.fill)) return options.fill as ChannelValue<D>;
  if (isDataChannel(options.stroke)) return options.stroke as ChannelValue<D>;
  return undefined;
}

/** True when a `fill`/`stroke` option refers to data rather than a literal color. */
export function isDataChannel(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "function" || Array.isArray(v) || ArrayBuffer.isView(v)) return true;
  if (typeof v === "string") return !isColor(v);
  if (typeof v === "object") return "value" in (v as object);
  return false;
}

/** Helper for transforms that produce one output column per facet index. */
export function facetAll(n: number): Facets {
  return [Array.from({ length: n }, (_, i) => i)];
}
