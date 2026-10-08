/** Synthetic datasets for the gallery (deterministic). */

export function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function gaussian(r: () => number) {
  return () => Array.from({ length: 12 }, () => r()).reduce((a, b) => a + b, 0) - 6;
}

export interface Tick {
  date: Date;
  series: string;
  value: number | null;
}

/** Daily series with weekly seasonality, a level shift, a spike, and some gaps. */
export function timeseries(days = 240, seriesNames = ["web", "mobile", "api"]): Tick[] {
  const r = rng(7);
  const g = gaussian(r);
  const out: Tick[] = [];
  seriesNames.forEach((name, k) => {
    for (let i = 0; i < days; i++) {
      const date = new Date(Date.UTC(2024, 0, 1 + i));
      let v = 120 + k * 40 + i * (0.25 + k * 0.1) + 15 * Math.sin((2 * Math.PI * i) / 7) + g() * 4;
      if (k === 0 && i >= 150) v += 45; // level shift
      if (k === 0 && i === 90) v += 110; // spike
      if (k === 1 && i === 200) v -= 70; // dip
      out.push({ date, series: name, value: v });
    }
  });
  return out;
}

export function single(days = 240): Tick[] {
  return timeseries(days, ["web"]);
}

export interface Penguin {
  species: string;
  island: string;
  bill: number;
  flipper: number;
  mass: number;
  sex: string;
}

export function penguins(n = 300): Penguin[] {
  const r = rng(3);
  const g = gaussian(r);
  const species = ["Adelie", "Chinstrap", "Gentoo"];
  const islands = ["Biscoe", "Dream", "Torgersen"];
  const base = { Adelie: [39, 190, 3700], Chinstrap: [49, 196, 3730], Gentoo: [47, 217, 5070] } as Record<string, number[]>;
  return Array.from({ length: n }, (_, i) => {
    const sp = species[i % 3 === 0 ? 0 : i % 7 === 0 ? 1 : i % 2 ? 2 : 0];
    const b = base[sp];
    return { species: sp, island: islands[(i * 7) % 3], bill: b[0] + g() * 2.5, flipper: b[1] + g() * 6, mass: b[2] + g() * 350, sex: i % 2 ? "female" : "male" };
  });
}

export interface Sale {
  region: string;
  product: string;
  month: Date;
  revenue: number;
  units: number;
}

export function sales(): Sale[] {
  const r = rng(21);
  const regions = ["North", "South", "East", "West", "Central", "Islands"];
  const products = ["Widget", "Gadget", "Gizmo", "Doohickey"];
  const out: Sale[] = [];
  for (let m = 0; m < 24; m++) {
    for (const region of regions) {
      for (const product of products) {
        const seasonal = 1 + 0.3 * Math.sin((2 * Math.PI * m) / 12);
        const regionFactor = region === "Islands" ? 0.08 : region === "West" ? 1.6 : 1;
        const units = Math.round((40 + r() * 30) * seasonal * regionFactor * (product === "Gizmo" ? 2.2 : 1));
        out.push({ region, product, month: new Date(Date.UTC(2023, m, 1)), revenue: units * (12 + r() * 8), units });
      }
    }
  }
  return out;
}

/** Many similar series with one that drifts away. */
export function fleet(n = 12, len = 96): { t: number; host: string; cpu: number }[] {
  const r = rng(99);
  const g = gaussian(r);
  const out: { t: number; host: string; cpu: number }[] = [];
  for (let k = 0; k < n; k++) {
    const host = `host-${String(k + 1).padStart(2, "0")}`;
    for (let t = 0; t < len; t++) {
      let cpu = 40 + 12 * Math.sin((2 * Math.PI * t) / 24 + k * 0.1) + g() * 2;
      if (k === 7 && t > 50) cpu += 35;
      out.push({ t, host, cpu });
    }
  }
  return out;
}

export function categoryCounts(): { kind: string }[] {
  const counts: Record<string, number> = { "200": 520, "301": 60, "302": 55, "304": 48, "400": 42, "401": 38, "403": 44, "404": 61, "418": 2, "500": 47, "502": 3, "503": 50 };
  return Object.entries(counts).flatMap(([kind, n]) => Array.from({ length: n }, () => ({ kind })));
}
