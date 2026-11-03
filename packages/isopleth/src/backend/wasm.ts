/**
 * WebAssembly backend: wraps the wasm-bindgen output of `crates/isopleth-wasm`
 * (published as `@danielmcsheehy/isopleth-wasm`) behind the `Backend` interface.
 *
 * ```ts
 * import * as ip from "@danielmcsheehy/isopleth";
 * import { loadWasm } from "@danielmcsheehy/isopleth/wasm";
 * await ip.init(loadWasm());
 * ```
 *
 * The import is dynamic so that apps that never call `loadWasm()` do not ship
 * the `.wasm` file.
 */

import type { Backend } from "./types.js";
import * as bundled from "@danielmcsheehy/isopleth-wasm";
import { wrapWasm, type WasmModule } from "./wasm-wrap.js";

export { wrapWasm };
export type { WasmModule };

export interface LoadWasmOptions {
  /** URL / Response / bytes / compiled module for the `.wasm` file (passed to wasm-bindgen's `init`). */
  module?: unknown;
  /** Supply an already-imported `@danielmcsheehy/isopleth-wasm` module (e.g. from a custom path or `initSync`). */
  bindings?: WasmModule;
}

/**
 * Load and initialise the WebAssembly backend. Importing `@danielmcsheehy/isopleth/wasm`
 * statically pulls in `@danielmcsheehy/isopleth-wasm`, so keep the import behind a dynamic
 * `import("@danielmcsheehy/isopleth/wasm")` if you want it code-split.
 */
export async function loadWasm(options: LoadWasmOptions = {}): Promise<Backend> {
  const mod: WasmModule = options.bindings ?? (bundled as unknown as WasmModule);
  if (typeof mod.default === "function") {
    await mod.default(options.module === undefined ? undefined : { module_or_path: options.module });
  }
  return wrapWasm(mod);
}

