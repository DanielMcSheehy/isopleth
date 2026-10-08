/**
 * Intervals: `floor`/`offset`/`range` over numbers or UTC time (ms). Mirrors
 * Plot's `interval` option: a number, a name like `"day"` or `"3 months"`, or
 * any object with `floor` and `offset`.
 */

import type { Interval, IntervalLike } from "./types.js";

const UNIT_MS: Record<string, number> = {
  millisecond: 1,
  second: 1e3,
  minute: 60e3,
  hour: 3600e3,
  day: 86400e3,
  week: 7 * 86400e3,
};

export function numberInterval(step: number): IntervalLike {
  if (!(step > 0) && !(step < 0)) throw new Error(`invalid number interval: ${step}`);
  // Negative n means 1/-n (Plot convention).
  const s = step < 0 ? 1 / -step : step;
  return {
    kind: "number",
    name: String(s),
    floor: (v) => Math.floor(v / s) * s,
    offset: (v, k = 1) => v + k * s,
    range: (start, stop) => {
      const out: number[] = [];
      for (let v = Math.ceil(start / s) * s; v < stop; v += s) out.push(v);
      return out;
    },
  };
}

function floorUTC(ms: number, unit: string, count: number): number {
  const d = new Date(ms);
  switch (unit) {
    case "year": {
      const y = Math.floor(d.getUTCFullYear() / count) * count;
      return Date.UTC(y, 0, 1);
    }
    case "quarter": {
      const q = Math.floor(d.getUTCMonth() / 3) * 3;
      return Date.UTC(d.getUTCFullYear(), q, 1);
    }
    case "month": {
      const m = Math.floor(d.getUTCMonth() / count) * count;
      return Date.UTC(d.getUTCFullYear(), m, 1);
    }
    case "week": {
      // ISO-ish weeks starting Monday; `count` weeks are anchored on the epoch Monday (1970-01-05).
      const anchor = Date.UTC(1970, 0, 5);
      const w = UNIT_MS.week * count;
      return Math.floor((ms - anchor) / w) * w + anchor;
    }
    default: {
      const step = UNIT_MS[unit] * count;
      return Math.floor(ms / step) * step;
    }
  }
}

function offsetUTC(ms: number, unit: string, count: number, k: number): number {
  const d = new Date(ms);
  switch (unit) {
    case "year":
      return Date.UTC(d.getUTCFullYear() + count * k, d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
    case "quarter":
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3 * count * k, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
    case "month":
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + count * k, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
    default:
      return ms + UNIT_MS[unit] * count * k;
  }
}

/** A UTC time interval such as `utcInterval("day")` or `utcInterval("3 months")`. */
export function utcInterval(spec: string): IntervalLike {
  const m = /^\s*(?:(\d+)\s+)?(millisecond|second|minute|hour|day|week|month|quarter|year)s?\s*$/i.exec(spec);
  if (!m) throw new Error(`unknown interval: ${JSON.stringify(spec)}`);
  const count = m[1] ? Number(m[1]) : 1;
  const unit = m[2].toLowerCase();
  return {
    kind: "time",
    name: count === 1 ? unit : `${count} ${unit}s`,
    floor: (v) => floorUTC(v, unit, count),
    offset: (v, k = 1) => offsetUTC(v, unit, count, k),
    range: (start, stop) => {
      const out: number[] = [];
      let v = floorUTC(start, unit, count);
      if (v < start) v = offsetUTC(v, unit, count, 1);
      let guard = 0;
      while (v < stop && guard++ < 1e6) {
        out.push(v);
        v = offsetUTC(v, unit, count, 1);
      }
      return out;
    },
  };
}

/** Normalise any `Interval` option into an `IntervalLike`. */
export function maybeInterval(interval: Interval | undefined | null): IntervalLike | undefined {
  if (interval === undefined || interval === null) return undefined;
  if (typeof interval === "number") return numberInterval(interval);
  if (typeof interval === "string") return utcInterval(interval);
  if (typeof interval.floor === "function" && typeof interval.offset === "function") {
    if (!interval.range) {
      const i = interval;
      return {
        ...i,
        range: (start, stop) => {
          const out: number[] = [];
          let v = i.floor(start);
          if (v < start) v = i.offset(v, 1);
          let guard = 0;
          while (v < stop && guard++ < 1e6) {
            out.push(v);
            v = i.offset(v, 1);
          }
          return out;
        },
      };
    }
    return interval;
  }
  throw new Error("invalid interval");
}

/** Median positive spacing between consecutive sorted numbers; NaN if unknown. */
export function medianStep(sortedX: ArrayLike<number>): number {
  const diffs: number[] = [];
  for (let i = 1; i < sortedX.length; i++) {
    const d = sortedX[i] - sortedX[i - 1];
    if (d > 0 && Number.isFinite(d)) diffs.push(d);
  }
  if (diffs.length === 0) return NaN;
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)];
}

/**
 * Guess a calendar interval for a time series from its median spacing, so
 * forecasts extend by whole days/months rather than by a mean number of ms.
 */
export function guessTimeInterval(stepMs: number): IntervalLike {
  const day = UNIT_MS.day;
  if (stepMs >= 360 * day) return utcInterval("year");
  if (stepMs >= 85 * day) return utcInterval("quarter");
  if (stepMs >= 27 * day) return utcInterval("month");
  if (stepMs >= 6.5 * day) return utcInterval("week");
  if (stepMs >= 0.95 * day) return utcInterval("day");
  if (stepMs >= 0.95 * UNIT_MS.hour) return utcInterval(`${Math.round(stepMs / UNIT_MS.hour)} hours`);
  if (stepMs >= 0.95 * UNIT_MS.minute) return utcInterval(`${Math.round(stepMs / UNIT_MS.minute)} minutes`);
  if (stepMs >= 0.95 * UNIT_MS.second) return utcInterval(`${Math.round(stepMs / UNIT_MS.second)} seconds`);
  return numberInterval(stepMs);
}
