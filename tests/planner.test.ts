import { describe, expect, it } from "vitest";
import {
  addDays,
  patternPerformance,
  plan,
  readiness,
} from "../src/lib/planner";
import {
  attemptSchema,
  importSchema,
  localDate,
  storySchema,
  type Attempt,
  type Problem,
  type Story,
} from "../src/lib/domain";

const problem = (
  id = "p1",
  pattern: Problem["pattern"] = "Arrays & hashing",
): Problem => ({
  id,
  title: id,
  url: "",
  difficulty: "Medium",
  pattern,
  created_at: "2026-10-01T00:00:00Z",
});
const attempt = (overrides: Partial<Attempt> = {}): Attempt => ({
  id: "a1",
  problem_id: "p1",
  attempted_on: "2026-10-01",
  duration_minutes: null,
  language: "Python",
  solution: "",
  difficulty: "Medium",
  pattern: "Arrays & hashing",
  assistance: "independent",
  hints: 0,
  correctness: "passed",
  test_results: "",
  time_complexity: "",
  space_complexity: "",
  confidence: 3,
  notes: "",
  ...overrides,
});
const story = (status: Story["status"] = "ready"): Story => ({
  id: "s1",
  title: "Incident",
  principles: ["Ownership"],
  situation: "S",
  task: "T",
  action: "A",
  result: "R",
  evidence: "",
  follow_up_questions: "",
  confidence: 3,
  status,
  updated_at: "2026-10-01T00:00:00Z",
});
describe("review scheduling", () => {
  it("is deterministic and recommends an honest baseline for no history", () => {
    expect(plan([], [], "2026-10-01")).toEqual(plan([], [], "2026-10-01"));
    expect(plan([], [], "2026-10-01")[0].reason).toContain("baseline");
  });
  it("does not review before D+1", () => {
    expect(
      plan([problem()], [attempt()], "2026-10-01").filter((r) => r.problem_id),
    ).toHaveLength(0);
  });
  it("schedules at D+1, D+3 and D+7 from the first attempt", () => {
    const p = [problem()];
    const a = [attempt()];
    expect(plan(p, a, "2026-10-02")[0].due_on).toBe("2026-10-02");
    a.push(attempt({ id: "a2", attempted_on: "2026-10-02" }));
    expect(plan(p, a, "2026-10-04")[0].due_on).toBe("2026-10-04");
    a.push(attempt({ id: "a3", attempted_on: "2026-10-04" }));
    expect(plan(p, a, "2026-10-08")[0].due_on).toBe("2026-10-08");
    a.push(attempt({ id: "a4", attempted_on: "2026-10-08" }));
    expect(plan(p, a, "2026-10-09").filter((r) => r.problem_id)).toHaveLength(
      0,
    );
  });
  it("does not count retries on the same day as spaced reviews", () => {
    expect(
      plan([problem()], [attempt(), attempt({ id: "a2" })], "2026-10-04")[0]
        .due_on,
    ).toBe("2026-10-02");
  });
  it("prioritizes overdue reviews and caps material at five", () => {
    const ps = Array.from({ length: 8 }, (_, i) => problem("p" + i));
    const as = ps.map((p, i) => attempt({ id: "a" + i, problem_id: p.id }));
    const result = plan(ps, as, "2026-10-05");
    expect(result).toHaveLength(5);
    expect(
      result.every((r) => r.problem_id && r.reason.includes("overdue")),
    ).toBe(true);
  });
  it("gives low confidence guided attempts higher priority", () => {
    const ps = [problem("p1"), problem("p2")];
    const result = plan(
      ps,
      [
        attempt({ confidence: 5 }),
        attempt({
          id: "a2",
          problem_id: "p2",
          confidence: 1,
          assistance: "guided",
        }),
      ],
      "2026-10-02",
    );
    expect(result[0].problem_id).toBe("p2");
    expect(result[0].reason).toContain("guided");
  });
  it("recommends weakest observed pattern", () => {
    const a = [
      attempt(),
      attempt({
        id: "a2",
        problem_id: "p2",
        pattern: "Graphs",
        assistance: "solution-viewed",
      }),
    ];
    expect(
      plan([], a, "2026-10-01").find((r) => !r.problem_id)?.title,
    ).toContain("graphs");
  });
  it("excludes future attempts from planning", () => {
    expect(
      plan(
        [problem()],
        [attempt({ attempted_on: "2026-12-01" })],
        "2026-10-01",
      )[0].problem_id,
    ).toBeNull();
  });
  it("handles month boundaries", () =>
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01"));
});
describe("evidence-based analytics", () => {
  it("never counts viewed, guided, hinted or failed attempts as independent passes", () => {
    const a = [
      attempt({ assistance: "solution-viewed" }),
      attempt({ assistance: "guided" }),
      attempt({ assistance: "hinted", hints: 1 }),
      attempt({ correctness: "failed" }),
    ];
    expect(patternPerformance(a)[0].independent).toBe(0);
  });
  it("withholds scores when evidence is insufficient", () => {
    expect(readiness([], [])).toBeNull();
    expect(readiness([attempt()], [story(), story()])).toBeNull();
  });
  it("counts distinct problems, never inflated repeat attempts", () => {
    const a = Array.from({ length: 5 }, (_, i) =>
      attempt({
        id: "a" + i,
        problem_id: "p" + i,
        pattern: i === 0 ? "Graphs" : i === 1 ? "Trees" : "Arrays & hashing",
      }),
    );
    const result = readiness([...a, a[0], a[0]], [story(), story("draft")]);
    expect(result?.score).toBe(85);
    expect(result?.problems).toBe(5);
  });
});
describe("validation and import safety", () => {
  it("rejects independent attempts with hints", () =>
    expect(
      attemptSchema.safeParse({
        ...attempt(),
        problem_id: "11111111-1111-4111-8111-111111111111",
        hints: 1,
      }).success,
    ).toBe(false));
  it("allows unknown durations but rejects missing dates", () => {
    const a = {
      ...attempt(),
      problem_id: "11111111-1111-4111-8111-111111111111",
    };
    expect(attemptSchema.parse(a).duration_minutes).toBeNull();
    expect(attemptSchema.safeParse({ ...a, attempted_on: "" }).success).toBe(
      false,
    );
  });
  it("requires all STAR sections for ready status", () =>
    expect(storySchema.safeParse({ ...story(), result: "" }).success).toBe(
      false,
    ));
  it("validates the minimal empty import", () =>
    expect(
      importSchema.parse({
        version: 1,
        problems: [],
        attempts: [],
        stories: [],
      }).version,
    ).toBe(1));
  it("rejects broken references and duplicate source IDs", () => {
    const p = { ...problem(), source_id: "p1" };
    const a = { ...attempt(), problem_id: undefined };
    expect(
      importSchema.safeParse({
        version: 1,
        problems: [p, p],
        attempts: [],
        stories: [],
      }).success,
    ).toBe(false);
    expect(
      importSchema.safeParse({
        version: 1,
        problems: [],
        attempts: [{ problem_source_id: "missing", data: a }],
        stories: [],
      }).success,
    ).toBe(false);
  });
  it("preserves assistance validation on imported attempts", () => {
    expect(
      importSchema.safeParse({
        version: 1,
        problems: [{ ...problem(), source_id: "p1" }],
        attempts: [{ problem_source_id: "p1", data: attempt({ hints: 2 }) }],
        stories: [],
      }).success,
    ).toBe(false);
  });
  it("uses the user timezone across UTC midnight", () =>
    expect(localDate(new Date("2026-10-17T22:00:00Z"), "Europe/Istanbul")).toBe(
      "2026-10-18",
    ));
});
