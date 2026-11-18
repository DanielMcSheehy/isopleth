/**
 * Self-contained browser build: one ES module with ECharts, zrender and tslib
 * bundled in and `process.env.NODE_ENV` replaced, so a page can load it with a
 * plain `<script type="module">` (no import map, no bundler).
 */
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/isopleth.browser.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  sourcemap: true,
  legalComments: "linked",
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});
