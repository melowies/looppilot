import type { Problem } from "./domain";
import type {
  PythonTestCase,
  PythonExecutionRequest,
} from "./coding-workspace";

export interface PythonProblemContent {
  leetcodeId: number;
  title: string;
  url: string;
  description: string;
  input: string;
  output: string;
  constraints: string[];
  method: PythonExecutionRequest["method"];
  signature: string;
  starter: string;
  cases: PythonTestCase[];
}

// Original summaries and curated examples verified against the linked sources.
// Never use a title (which the user can edit) as problem identity. A recorded
// frontend ID is authoritative; canonical URLs support older imported records.
function identity(problem: Problem) {
  if (problem.leetcode_id != null) return problem.leetcode_id;
  try {
    const url = new URL(problem.url);
    if (
      !/^https?:$/.test(url.protocol) ||
      !/^(www\.)?leetcode\.com$/i.test(url.hostname)
    )
      return null;
    const slug = url.pathname.match(
      /^\/problems\/([^/]+)\/?(?:description\/?)?$/,
    )?.[1];
    return slug === "reverse-linked-list"
      ? 206
      : slug === "number-of-islands"
        ? 200
        : null;
  } catch {
    return null;
  }
}

const reverseList: PythonProblemContent = {
  leetcodeId: 206,
  title: "Reverse Linked List",
  url: "https://leetcode.com/problems/reverse-linked-list/description/",
  description:
    "Reorder a singly linked list so its nodes appear in reverse order. Return the new head; an empty list stays empty.",
  input:
    'A JSON array of integer node values, or {"head": [...]}. The harness builds ListNode objects and passes the head (None for []).',
  output:
    "Return a ListNode head or None. The harness converts the returned chain to a JSON array; expected output is an integer array.",
  constraints: ["0–5000 nodes.", "Each node value is between -5000 and 5000."],
  method: "reverseList",
  signature: "Solution().reverseList(head)",
  starter:
    "from typing import Optional\n\n# ListNode(val=0, next=None) is provided by the harness.\nclass Solution:\n    def reverseList(self, head: Optional[ListNode]) -> Optional[ListNode]:\n        pass\n",
  cases: [
    {
      id: "reverse-sample-1",
      input: "[1,2,3,4,5]",
      expectedOutput: "[5,4,3,2,1]",
      origin: "curated",
    },
    {
      id: "reverse-sample-2",
      input: "[1,2]",
      expectedOutput: "[2,1]",
      origin: "curated",
    },
    {
      id: "reverse-sample-3",
      input: "[]",
      expectedOutput: "[]",
      origin: "curated",
    },
  ],
};

// Curated sample data: https://leetcode.com/problems/number-of-islands/description/
export function pythonProblem(problem: Problem): PythonProblemContent | null {
  const id = identity(problem);
  if (id === 206) return reverseList;
  if (id !== 200) return null;
  return {
    leetcodeId: 200,
    title: "Number of Islands",
    url: "https://leetcode.com/problems/number-of-islands/description/",
    description:
      "Count connected groups of land cells in a rectangular map. Land connects horizontally or vertically; diagonal contact does not connect groups. The map boundary borders water.",
    input:
      'A rectangular JSON grid of strings "0" and "1", or {"grid": [...]}.',
    output:
      "Return the integer number of land groups. Expected output is a JSON integer.",
    constraints: ["1–300 rows and columns.", 'Cells contain "0" or "1".'],
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
