/**
 * Fallback types for the optional `@danielmcsheehy/isopleth-wasm` package so the library
 * typechecks before the wasm build exists. When the package is installed its
 * own generated declarations take precedence.
 */
declare module "@danielmcsheehy/isopleth-wasm" {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const init: (opts?: unknown) => Promise<unknown>;
  export default init;
  export function version(): string;
  export const initSync: (opts: unknown) => unknown;
}
