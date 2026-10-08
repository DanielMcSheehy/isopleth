import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const src = (p: string) => fileURLToPath(new URL(`../isopleth/src/${p}`, import.meta.url));

export default defineConfig({
  server: { port: 5173, fs: { allow: [".."] } },
  resolve: {
    alias: [
      { find: "isopleth/wasm", replacement: src("backend/wasm.ts") },
      { find: /^isopleth$/, replacement: src("index.ts") },
    ],
  },
  optimizeDeps: { exclude: ["@isopleth/wasm", "isopleth"] },
  build: { target: "es2022" },
});
