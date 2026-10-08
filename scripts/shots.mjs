// Regenerates docs/img: gallery chart screenshots, the hero image, and the playground GIF.
//   node scripts/shots.mjs [gallery|hero|gif|all]
// Needs playwright (npm i -D playwright && npx playwright install chromium) and ffmpeg for the GIF.
import { chromium } from "playwright";
import { createServer } from "vite";
import { mkdirSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const what = process.argv[2] ?? "all";
const out = "docs/img";
mkdirSync(out, { recursive: true });
const server = await createServer({ root: "packages/demo", server: { port: 5199, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

if (what === "gallery" || what === "all") {
  const page = await browser.newPage({ viewport: { width: 1240, height: 900 }, deviceScaleFactor: 1.5 });
  await page.goto("http://localhost:5199/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const ids = await page.$$eval("section.example", (els) => els.map((e) => e.id));
  for (const id of ids) {
    const el = await page.$(`#${id} .chart`);
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await el.screenshot({ path: `${out}/${id}.png` });
  }
  await page.click("#theme");
  await page.waitForTimeout(1500);
  for (const id of ["auto-insights", "stacked-area"]) {
    const el = await page.$(`#${id} .chart`);
    await el.scrollIntoViewIfNeeded();
    await el.screenshot({ path: `${out}/${id}-light.png` });
  }
  await page.close();
  console.log("gallery done");
}

if (what === "hero" || what === "all") {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 });
  await page.goto("http://localhost:5199/hero.html", { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await (await page.$("#hero")).screenshot({ path: `${out}/hero.png` });
  await page.close();
  console.log("hero done");
}

if (what === "gif" || what === "all") {
  const frames = join(tmpdir(), "isopleth-frames");
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 760 }, deviceScaleFactor: 1 });
  await page.goto("http://localhost:5199/playground.html", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.addStyleTag({ content: "header.top{display:none} .stage .card:nth-child(2){display:none} main.playground{padding-top:16px} #panel{top:16px}" });
  let n = 0;
  const FPS = 12;
  const clip = { x: 0, y: 0, width: 1400, height: 740 };
  const hold = async (ms) => {
    for (let i = 0; i < Math.max(1, Math.round((ms / 1000) * FPS)); i++) await page.screenshot({ path: `${frames}/f${String(n++).padStart(4, "0")}.png`, clip });
  };
  const toggle = async (label, ms = 1600) => { await page.locator(".ip-editor .toggle", { hasText: label }).first().click(); await hold(ms); };
  const mark = async (label, ms = 1600) => { await page.locator(".ip-editor .seg button", { hasText: label }).first().click(); await hold(ms); };
  const select = async (rowLabel, value, ms = 1600) => { await page.locator(".ip-editor .row", { hasText: rowLabel }).first().locator("select").selectOption(value); await hold(ms); };
  const set = async (patch, ms = 1400) => { await page.evaluate((p) => window.editor.setSpec(p), patch); await hold(ms); };
  const dataset = async (name, ms = 400) => { await page.selectOption("#dataset", name); await page.waitForTimeout(ms); };

  await dataset("single");
  await set({ mark: "line", insights: {}, zoom: false }, 1400);
  await toggle("anomalies", 1800);
  await toggle("changepoints", 1800);
  await toggle("forecast", 2000);
  await toggle("trend", 1600);
  await set({ window: 14 }, 1600);
  await set({ window: 0 }, 600);
  await dataset("timeseries");
  await set({ mark: "line", insights: {}, window: 0 }, 1200);
  await mark("area", 1600);
  await set({ gradient: true }, 1200);
  await select("stack", "normalize", 1800);
  await select("stack", "stack", 800);
  await select("facet by", "series", 1800);
  await select("facet by", "", 600);
  await dataset("sales");
  await hold(1400);
  await select("stack", "dodge", 1400);
  await select("stack", "stack", 600);
  await toggle("category outliers", 1800);
  await dataset("fleet", 500);
  await hold(2200);
  await set({ theme: "light" }, 1800);
  await set({ theme: "dark" }, 1600);
  await page.close();
  execSync(`ffmpeg -y -loglevel error -framerate ${FPS} -i ${frames}/f%04d.png -vf "scale=1120:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=160:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" ${out}/playground.gif`);
  execSync(`ffmpeg -y -loglevel error -framerate ${FPS} -i ${frames}/f%04d.png -vf "scale=1120:-2" -c:v libx264 -pix_fmt yuv420p -crf 26 ${out}/playground.mp4`);
  console.log(`gif done (${n} frames)`);
}

await browser.close();
await server.close();
