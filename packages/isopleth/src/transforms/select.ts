/** `select*` transforms: keep one row per series (first, last, min/max of a channel). */

import type { ChannelValue, MarkOptions, Row, Transform } from "../types.js";
import { toNumber, valueof } from "../channel.js";
import { basic, seriesOf } from "./basic.js";

type Selector = (series: number[], values: number[] | undefined) => number[];

function selectn<D extends object>(channel: "x" | "y" | undefined, selector: Selector, options: MarkOptions<D>): MarkOptions<D> {
  const transform: Transform<D> = (data, facets) => {
    const V = channel ? valueof(data, (options as Record<string, unknown>)[channel] as ChannelValue<D>) : undefined;
    const nums = V ? V.map(toNumber) : undefined;
    return {
      data,
      facets: facets.map((I) => {
        const out: number[] = [];
        for (const s of seriesOf(data, I, options)) out.push(...selector(s, nums));
        return out;
      }),
    };
  };
  return basic(options, transform);
}

export function selectFirst<D extends object = Row>(options: MarkOptions<D> = {}): MarkOptions<D> {
  return selectn(undefined, (s) => (s.length ? [s[0]] : []), options);
}
export function selectLast<D extends object = Row>(options: MarkOptions<D> = {}): MarkOptions<D> {
  return selectn(undefined, (s) => (s.length ? [s[s.length - 1]] : []), options);
}
const extreme = (sign: 1 | -1): Selector => (s, v) => {
  if (!v) return s.length ? [s[0]] : [];
  let best = -1;
  for (const i of s) {
    if (!Number.isFinite(v[i])) continue;
    if (best < 0 || sign * (v[i] - v[best]) > 0) best = i;
  }
  return best < 0 ? [] : [best];
};
export function selectMinY<D extends object = Row>(options: MarkOptions<D> = {}): MarkOptions<D> {
  return selectn("y", extreme(-1), options);
}
export function selectMaxY<D extends object = Row>(options: MarkOptions<D> = {}): MarkOptions<D> {
  return selectn("y", extreme(1), options);
}
export function selectMinX<D extends object = Row>(options: MarkOptions<D> = {}): MarkOptions<D> {
  return selectn("x", extreme(-1), options);
}
export function selectMaxX<D extends object = Row>(options: MarkOptions<D> = {}): MarkOptions<D> {
  return selectn("x", extreme(1), options);
}
