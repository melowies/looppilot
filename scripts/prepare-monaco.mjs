import { cp, mkdir } from "node:fs/promises";
// Self-host editor assets; no CDN requests or code uploads from the editor.
await mkdir("public/monaco", { recursive: true });
await cp("node_modules/monaco-editor/min/vs", "public/monaco/vs", {
  recursive: true,
});
await cp("node_modules/monaco-editor/LICENSE", "public/monaco/LICENSE");
