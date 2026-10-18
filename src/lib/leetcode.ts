import { z } from "zod";
import { patterns, type Problem, problemSchema } from "./domain";

export const leetcodeNumberSchema = z.number().int().min(1).max(2147483647);
export function parseLeetcodeNumber(raw: string) {
  if (!/^\d{1,10}$/.test(raw.trim()))
    throw new Error("Enter a positive LeetCode problem number, such as 200.");
  const parsed = leetcodeNumberSchema.safeParse(Number(raw.trim()));
  if (!parsed.success)
    throw new Error("Enter a positive LeetCode problem number, such as 200.");
  return parsed.data;
}
export const problemFormSchema = problemSchema.extend({
  leetcode_id: leetcodeNumberSchema.nullable().optional(),
  topic_tags: z.array(z.string().max(100)).max(50).optional(),
});
export const metadataSchema = z.object({
  number: leetcodeNumberSchema,
  title: z.string().min(1).max(200),
  difficulty: z.enum(["Easy", "Medium", "Hard"]),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  tags: z.array(z.string().max(100)).max(50),
});
export type LeetcodeMetadata = z.infer<typeof metadataSchema>;
const tagPatterns: Record<string, (typeof patterns)[number]> = {
  Array: "Arrays & hashing",
  "Hash Table": "Arrays & hashing",
  "Two Pointers": "Two pointers",
  "Sliding Window": "Sliding window",
  Stack: "Stack",
  "Monotonic Stack": "Stack",
  "Binary Search": "Binary search",
  "Linked List": "Linked lists",
  Tree: "Trees",
  "Binary Tree": "Trees",
  "Binary Search Tree": "Trees",
  Graph: "Graphs",
  "Union Find": "Graphs",
  "Heap (Priority Queue)": "Heaps",
  Backtracking: "Backtracking",
  "Dynamic Programming": "Dynamic programming",
};
export function suggestPatterns(tags: string[]) {
  let candidates = [
    ...new Set(tags.map((t) => tagPatterns[t]).filter(Boolean)),
  ];
  if (
    !candidates.includes("Trees") &&
    tags.some((t) =>
      ["Depth-First Search", "Breadth-First Search"].includes(t),
    ) &&
    !candidates.includes("Graphs")
  )
    candidates.push("Graphs");
  // Array/hash tags often describe implementation details rather than the main pattern.
  if (
    candidates.length > 1 &&
    (!tags.includes("Hash Table") ||
      candidates.some((p) => p !== "Arrays & hashing" && p !== "Graphs"))
  )
    candidates = candidates.filter((p) => p !== "Arrays & hashing");
  return candidates;
}
export function leetcodeSlug(url: string) {
  try {
    const u = new URL(url);
    if (!["leetcode.com", "www.leetcode.com"].includes(u.hostname)) return null;
    return u.pathname.match(/^\/problems\/([a-z0-9-]+)(?:\/|$)/)?.[1] ?? null;
  } catch {
    return null;
  }
}
export function duplicateProblem(
  problems: Problem[],
  value: { leetcode_id?: number | null; url: string },
  excludeId?: string,
) {
  const slug = leetcodeSlug(value.url);
  return problems.find(
    (p) =>
      p.id !== excludeId &&
      ((value.leetcode_id != null && p.leetcode_id === value.leetcode_id) ||
        (slug !== null && leetcodeSlug(p.url) === slug)),
  );
}
export async function fetchLeetcodeMetadata(
  raw: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
) {
  const number = parseLeetcodeNumber(raw);
  try {
    const response = await fetcher(`/api/leetcode?number=${number}`, {
      signal: AbortSignal.any([
        ...(signal ? [signal] : []),
        AbortSignal.timeout(8000),
      ]),
    });
    if (!response.ok) {
      if (response.status === 404)
        throw new Error(
          "That number is not in the current catalog. You can enter the details manually.",
        );
      throw new Error(
        "Lookup is unavailable. Enter the problem details manually or try again.",
      );
    }
    const result = metadataSchema.parse(await response.json());
    if (result.number !== number)
      throw new Error(
        "Lookup returned a different problem. Enter the details manually.",
      );
    return result;
  } catch (error) {
    if (error instanceof Error && error.message.includes("manually"))
      throw error;
    throw new Error(
      "Lookup is unavailable. Enter the problem details manually or try again.",
    );
  }
}
