/**
 * Backend selection. The JS backend is the default; call `init()` (or
 * `useBackend()`) to switch to the WebAssembly build of `isopleth-core`.
 *
 * ```ts
 * import * as ip from "isopleth";
 * import { loadWasm } from "isopleth/wasm";
 * await ip.init(loadWasm());   // optional, once
 * ```
 */

import type { Backend } from "./types.js";
import { jsBackend } from "./js/index.js";

let current: Backend = jsBackend;

/** The backend used by all transforms and insights. */
export function getBackend(): Backend {
  return current;
}

/** Replace the active backend. Returns the previous one. */
export function useBackend(backend: Backend): Backend {
  const prev = current;
  current = backend;
  return prev;
}

/**
 * Install a backend from a promise (typically `loadWasm()`), falling back to
 * the JS backend if loading fails. Resolves with the backend in use.
 */
export async function init(backend?: Backend | Promise<Backend>): Promise<Backend> {
  if (!backend) return current;
  try {
    const b = await backend;
    useBackend(b);
    return b;
  } catch (err) {
    if (typeof console !== "undefined") console.warn("[isopleth] backend failed to load, using the JS backend:", err);
    return current;
  }
}

export { jsBackend };
export type { Backend } from "./types.js";
