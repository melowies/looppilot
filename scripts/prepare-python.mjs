import { cp, mkdir } from "node:fs/promises";
// Pinned npm runtime, served locally. No CDN or submitted-code server endpoint.
await mkdir("public/python", { recursive: true });
for (const file of [
  "pyodide.js",
  "pyodide.asm.js",
  "pyodide.asm.wasm",
  "python_stdlib.zip",
  "pyodide-lock.json",
]) {
  await cp(`node_modules/pyodide/${file}`, `public/python/${file}`);
}
