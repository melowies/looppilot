// Extract factual metadata only; never bundle statements, solutions, or code.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const source =
  "https://raw.githubusercontent.com/doocs/leetcode/main/solution/result.json";
const input = process.argv[2];
const response = input
  ? null
  : await fetch(source, { signal: AbortSignal.timeout(60000) });
if (response && !response.ok)
  throw new Error(`Dataset download failed: ${response.status}`);
const raw = input ? await readFile(input, "utf8") : await response.text();
const rows = JSON.parse(raw);
const seen = new Set();
const problems = rows
  .flatMap((p) => {
    const number = Number(p.frontend_question_id);
    if (
      !Number.isSafeInteger(number) ||
      number < 1 ||
      seen.has(number) ||
      !["Easy", "Medium", "Hard"].includes(p.difficulty_en) ||
      !p.title_en ||
      !/^[a-z0-9-]+$/.test(p.question_title_slug)
    )
      return [];
    seen.add(number);
    return [
      {
        number,
        title: p.title_en,
        difficulty: p.difficulty_en,
        slug: p.question_title_slug,
        tags: Array.isArray(p.tags_en) ? p.tags_en : [],
      },
    ];
  })
  .sort((a, b) => a.number - b.number);
if (problems.length < 3000)
  throw new Error(
    "Dataset is unexpectedly incomplete; existing snapshot was not changed.",
  );
await mkdir("data", { recursive: true });
await writeFile(
  "data/leetcode.json",
  JSON.stringify({
    source,
    retrieved_on: new Date().toISOString().slice(0, 10),
    source_sha256: createHash("sha256").update(raw).digest("hex"),
    problems,
  }) + "\n",
);
console.log(`Saved ${problems.length} problem metadata records.`);
