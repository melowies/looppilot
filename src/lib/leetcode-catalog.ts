// Imported only by the server route. This snapshot is never sent in its entirety.
import catalog from "../../data/leetcode.json";
import { metadataSchema, parseLeetcodeNumber } from "./leetcode";
export function lookupLeetcodeProblem(raw: string) {
  const number = parseLeetcodeNumber(raw);
  const row = catalog.problems.find((p) => p.number === number);
  return row ? metadataSchema.parse(row) : null;
}
export function lookupLeetcodeSlug(slug: string) {
  if (!/^[a-z0-9-]{1,200}$/.test(slug))
    throw new Error("Invalid LeetCode slug.");
  const row = catalog.problems.find((p) => p.slug === slug);
  return row ? metadataSchema.parse(row) : null;
}
