import type { Problem } from "./domain";
import type { PythonTestCase } from "./coding-workspace";

// Curated sample data: https://leetcode.com/problems/number-of-islands/description/
export function pythonProblem(problem: Problem) {
  const islands =
    problem.leetcode_id === 200 ||
    /^https?:\/\/(?:www\.)?leetcode\.com\/problems\/number-of-islands(?:\/|$)/i.test(
      problem.url,
    );
  if (!islands) return null;
  return {
    method: "numIslands" as const,
    signature: "Solution().numIslands(grid)",
    starter:
      "from typing import List\n\nclass Solution:\n    def numIslands(self, grid: List[List[str]]) -> int:\n        pass\n",
    cases: [
      {
        id: "islands-sample-1",
        input: JSON.stringify({
          grid: [
            ["1", "1", "1", "1", "0"],
            ["1", "1", "0", "1", "0"],
            ["1", "1", "0", "0", "0"],
            ["0", "0", "0", "0", "0"],
          ],
        }),
        expectedOutput: "1",
        origin: "curated",
      },
      {
        id: "islands-sample-2",
        input: JSON.stringify({
          grid: [
            ["1", "1", "0", "0", "0"],
            ["1", "1", "0", "0", "0"],
            ["0", "0", "1", "0", "0"],
            ["0", "0", "0", "1", "1"],
          ],
        }),
        expectedOutput: "3",
        origin: "curated",
      },
    ] satisfies PythonTestCase[],
  };
}
