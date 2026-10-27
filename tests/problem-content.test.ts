import { describe, expect, it } from "vitest";
import { pythonProblem } from "../src/lib/python-problems";
import { interviewCountdown } from "../src/lib/interview-countdown";
import { defaultPlannerConfig } from "../src/lib/adaptive-types";
import type { Problem } from "../src/lib/domain";

const problem: Problem = {
  id: "p",
  title: "User title",
  difficulty: "Easy",
  pattern: "Linked lists",
  created_at: "2026-10-18T00:00:00Z",
  url: "https://leetcode.com/problems/reverse-linked-list/",
};
describe("curated problem identity", () => {
  it("maps legacy canonical URLs and recorded frontend IDs without using titles", () => {
    expect(pythonProblem(problem)?.method).toBe("reverseList");
    expect(
      pythonProblem({ ...problem, url: "", leetcode_id: 206 })?.cases,
    ).toHaveLength(3);
    expect(
      pythonProblem({
        ...problem,
        url: "https://www.leetcode.com/problems/reverse-linked-list/description/?x=1",
      })?.leetcodeId,
    ).toBe(206);
    expect(pythonProblem({ ...problem, leetcode_id: 200 })?.method).toBe(
      "numIslands",
    );
    expect(pythonProblem({ ...problem, leetcode_id: 999 })).toBeNull();
    expect(
      pythonProblem({
        ...problem,
        title: "Reverse Linked List",
        url: "https://example.com/problems/reverse-linked-list/",
      }),
    ).toBeNull();
  });
  it("provides a non-solving starter, array cases and problem-specific instructions", () => {
    const content = pythonProblem(problem)!;
    expect(content.starter).toContain("head: Optional[ListNode]");
    expect(content.starter).toContain("pass");
    expect(content.input).not.toContain("grid");
    expect(content.cases.map((c) => JSON.parse(c.expectedOutput))).toEqual([
      [5, 4, 3, 2, 1],
      [2, 1],
      [],
    ]);
  });
});
describe("interview countdown", () => {
  const now = Date.parse("2026-10-19T08:00:00Z");
  const config = {
    ...defaultPlannerConfig(),
    interviewTimezone: "Europe/Istanbul",
    rounds: [
      {
        id: "later",
        title: "Coding",
        date: "2026-10-22",
        time: "11:00",
        duration: 60,
        format: "coding" as const,
      },
      {
        id: "next",
        title: "Behavioral",
        date: "2026-10-20",
        time: "11:00",
        duration: 60,
        format: "behavioral" as const,
      },
    ],
  };
  it("prefers the nearest unended round and agrees with planner day counts", () => {
    expect(
      interviewCountdown(config, "2027-01-01", now, "2026-10-19"),
    ).toMatchObject({
      date: "2026-10-20",
      days: 1,
      title: "Behavioral",
      fromRound: true,
    });
    expect(
      interviewCountdown(config, null, now + 86400000 + 1, "2026-10-20")?.days,
    ).toBe(0);
  });
  it("does not restore a profile date after configured rounds have ended", () => {
    expect(
      interviewCountdown(
        config,
        "2027-01-01",
        now + 10 * 86400000,
        "2026-10-29",
      ),
    ).toBeNull();
    expect(
      interviewCountdown(
        defaultPlannerConfig(),
        "2026-10-21",
        now,
        "2026-10-19",
      )?.days,
    ).toBe(2);
    expect(
      interviewCountdown(defaultPlannerConfig(), null, now, "2026-10-19"),
    ).toBeNull();
  });
  it("uses the study timezone for profile-date fallback near midnight", () => {
    expect(
      interviewCountdown(
        { ...defaultPlannerConfig(), timezone: "UTC" },
        "2026-10-21",
        Date.parse("2026-10-19T22:30:00Z"),
        "2026-10-20",
      )?.days,
    ).toBe(2);
  });
});
