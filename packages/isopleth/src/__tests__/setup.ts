/**
 * Test setup: with `ISOPLETH_BACKEND=wasm` the whole suite runs against the
 * WebAssembly build of isopleth-core (expected at packages/wasm/pkg), which
 * doubles as a parity test between the Rust kernels and the JS port.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { useBackend } from "../backend/index.js";
import { wrapWasm } from "../backend/wasm-wrap.js";

if (process.env.ISOPLETH_BACKEND === "wasm") {
  const dir = fileURLToPath(new URL("../../../wasm/pkg/", import.meta.url));
  const js = `${dir}isopleth_wasm.js`;
  if (!existsSync(js)) throw new Error(`ISOPLETH_BACKEND=wasm but ${js} is missing; run npm run build:wasm`);
  const bindings = await import(/* @vite-ignore */ js);
  await bindings.default({ module_or_path: readFileSync(`${dir}isopleth_wasm_bg.wasm`) });
  useBackend(wrapWasm(bindings));
  console.log(`[isopleth tests] using the wasm backend (${bindings.version()})`);
}
