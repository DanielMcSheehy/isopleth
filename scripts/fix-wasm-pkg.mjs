// wasm-pack writes its own package.json into the out-dir; we keep ours one level up
// and only need the generated JS/TS/WASM files. Remove the generated manifest and
// .gitignore so the pkg folder is a plain asset directory.
import { rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const pkg = resolve("packages/wasm/pkg");
for (const f of ["package.json", ".gitignore", "README.md"]) {
  const p = resolve(pkg, f);
  if (existsSync(p)) rmSync(p);
}
console.log("wasm package ready at packages/wasm/pkg");
