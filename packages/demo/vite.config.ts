import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const src = (p: string) => fileURLToPath(new URL(`../isopleth/src/${p}`, import.meta.url));

export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  server: { port: 5173, fs: { allow: [".."] } },
  resolve: {
    alias: [
      { find: "@danielmcsheehy/isopleth/wasm", replacement: src("backend/wasm.ts") },
      { find: "@danielmcsheehy/isopleth/editor", replacement: src("editor/index.ts") },
      { find: /^@danielmcsheehy\/isopleth$/, replacement: src("index.ts") },
    ],
  },
  optimizeDeps: { exclude: ["@danielmcsheehy/isopleth-wasm", "@danielmcsheehy/isopleth"] },
  build: { target: "es2022", rollupOptions: { input: { main: "index.html", playground: "playground.html", hero: "hero.html" } } },
});
