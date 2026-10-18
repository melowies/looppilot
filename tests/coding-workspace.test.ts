import { describe, expect, it } from "vitest";
import { newAttempt, readTestEvidence } from "../src/lib/coding-workspace";
import { attemptSchema, type Problem } from "../src/lib/domain";
import { readiness } from "../src/lib/planner";

const problem: Problem = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Example",
  difficulty: "Easy",
  pattern: "Arrays & hashing",
  url: "",
  created_at: "2026-10-17T00:00:00Z",
};
describe("coding workspace persistence", () => {
  it("creates unverified evidence with no invented duration or solve", () => {
    const draft = attemptSchema.parse({
      ...newAttempt(problem, "2026-10-17"),
      solution: "print(1)",
    });
    expect(draft.correctness).toBe("unverified");
    expect(draft.duration_minutes).toBeNull();
    expect(readiness([{ ...draft, id: problem.id }], [])).toBeNull();
  });
  it("preserves legacy test evidence, including JSON that is not our format", () => {
    for (const raw of [
      "Passed three examples; manual check",
      '{"passed":true}',
      "",
    ]) {
      expect(readTestEvidence(raw)).toMatchObject({ cases: [], evidence: raw });
    }
  });
  it("round trips manually supplied cases without claiming execution", () => {
    const value = {
      format: "looppilot-workspace-v1",
      cases: [{ id: "a", input: "[1,2]", expectedOutput: "3" }],
      evidence: "Not run",
    };
    expect(readTestEvidence(JSON.stringify(value))).toEqual(value);
    expect(
      readTestEvidence(JSON.stringify({ ...value, cases: [{}] })).evidence,
    ).toContain('"cases"');
  });
});
