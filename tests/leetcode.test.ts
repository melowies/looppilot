import { describe, expect, it } from "vitest";
import {
  lookupLeetcodeProblem,
  lookupLeetcodeSlug,
} from "../src/lib/leetcode-catalog";
import {
  duplicateProblem,
  fetchLeetcodeMetadata,
  parseLeetcodeNumber,
  suggestPatterns,
} from "../src/lib/leetcode";
import type { Problem } from "../src/lib/domain";

describe("displayed LeetCode problem numbers", () => {
  it("verifies source URLs by their canonical slug without using file-local IDs", () => {
    expect(lookupLeetcodeSlug("number-of-islands")?.number).toBe(200);
    expect(lookupLeetcodeSlug("not-a-real-source-problem")).toBeNull();
    expect(() => lookupLeetcodeSlug("../private")).toThrow();
  });
  it.each([
    [1, "Two Sum", "Easy"],
    [3, "Longest Substring Without Repeating Characters", "Medium"],
    [128, "Longest Consecutive Sequence", "Medium"],
    [200, "Number of Islands", "Medium"],
    [875, "Koko Eating Bananas", "Medium"],
  ])("resolves %s to %s", (number, title, difficulty) => {
    const p = lookupLeetcodeProblem(String(number));
    expect(p?.title).toBe(title);
    expect(p?.difficulty).toBe(difficulty);
    expect(p?.number).toBe(number);
    expect(p?.tags.length).toBeGreaterThan(0);
    expect(p?.slug).toMatch(/^[a-z0-9-]+$/);
  });
  it.each(["", "0", "-1", "1.5", "abc", "1e3", "2147483648"])(
    "rejects invalid ID %s",
    (id) => expect(() => parseLeetcodeNumber(id)).toThrow(),
  );
  it("normalizes leading zeros and handles unknown IDs", () => {
    expect(parseLeetcodeNumber("0001")).toBe(1);
    expect(lookupLeetcodeProblem("999999")).toBeNull();
  });
  it("maps meaningful tags and retains genuine ambiguity", () => {
    expect(suggestPatterns(["Array", "Binary Search"])).toEqual([
      "Binary search",
    ]);
    expect(suggestPatterns(["Hash Table", "String", "Sliding Window"])).toEqual(
      ["Sliding window"],
    );
    expect(suggestPatterns(["Array", "Matrix", "Depth-First Search"])).toEqual([
      "Graphs",
    ]);
    expect(suggestPatterns(["Union Find", "Array", "Hash Table"])).toHaveLength(
      2,
    );
    expect(suggestPatterns(["Math"])).toEqual([]);
  });
  it("detects duplicates by number and legacy LeetCode URL, allowing self-edits", () => {
    const p: Problem = {
      id: "p1",
      title: "Two Sum",
      url: "https://leetcode.com/problems/two-sum/description/?env=test",
      difficulty: "Easy",
      pattern: "Arrays & hashing",
      created_at: "2026-10-17",
    };
    expect(
      duplicateProblem([p], {
        leetcode_id: 1,
        url: "https://leetcode.com/problems/two-sum/",
      }),
    ).toBe(p);
    const numbered = { ...p, leetcode_id: 1 };
    expect(duplicateProblem([numbered], { leetcode_id: 1, url: "" })).toBe(
      numbered,
    );
    expect(
      duplicateProblem([numbered], { leetcode_id: 1, url: p.url }, p.id),
    ).toBeUndefined();
    expect(
      duplicateProblem([p], { url: "https://example.com/problems/two-sum/" }),
    ).toBeUndefined();
  });
});
describe("lookup transport failures", () => {
  const fetcher = (response: Response) =>
    (async () => response) as typeof fetch;
  it("accepts known metadata", async () => {
    expect(
      (
        await fetchLeetcodeMetadata(
          "200",
          undefined,
          fetcher(Response.json(lookupLeetcodeProblem("200"))),
        )
      ).title,
    ).toBe("Number of Islands");
  });
  it("handles a network outage with manual-entry guidance", async () => {
    await expect(
      fetchLeetcodeMetadata("1", undefined, (async () => {
        throw new TypeError("network error");
      }) as typeof fetch),
    ).rejects.toThrow("manually");
  });
  it.each([404, 429, 500, 503])("handles lookup status %s", async (status) => {
    await expect(
      fetchLeetcodeMetadata(
        "1",
        undefined,
        fetcher(new Response("", { status })),
      ),
    ).rejects.toThrow("manually");
  });
  it("rejects malformed or mismatched source metadata", async () => {
    await expect(
      fetchLeetcodeMetadata(
        "1",
        undefined,
        fetcher(Response.json({ title: "Bad" })),
      ),
    ).rejects.toThrow("manually");
    await expect(
      fetchLeetcodeMetadata(
        "1",
        undefined,
        fetcher(Response.json(lookupLeetcodeProblem("200"))),
      ),
    ).rejects.toThrow("different problem");
  });
});
