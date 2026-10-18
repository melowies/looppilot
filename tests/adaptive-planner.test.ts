import { describe, expect, it, vi } from "vitest";
import {
  emptyData,
  type Attempt,
  type Data,
  type Problem,
  type Story,
  localDate,
} from "../src/lib/domain";
import {
  adaptiveReviews,
  analyzePatterns,
  generateAdaptiveWeek,
} from "../src/lib/adaptive-planner";
import {
  defaultPlannerConfig,
  plannerConfigSchema,
  type DayPlan,
  type PlannerConfig,
} from "../src/lib/adaptive-types";
import {
  availableIntervals,
  intervalMinutes,
  zonedInstant,
} from "../src/lib/study-time";
import {
  coachingSummary,
  requestCoach,
  validateCoachChoice,
} from "../src/lib/planner-coach";
import { serializeEvidence } from "../src/lib/coding-workspace";

const now = "2026-10-19T08:00:00Z",
  day = "2026-10-19";
const problem = (
  id = "p1",
  pattern: Problem["pattern"] = "Graphs",
): Problem => ({
  id,
  title: id,
  url: "",
  difficulty: "Medium",
  pattern,
  created_at: "2026-10-01T00:00:00Z",
});
const attempt = (v: Partial<Attempt> = {}): Attempt => ({
  id: "a1",
  problem_id: "p1",
  attempted_on: "2026-10-16",
  duration_minutes: null,
  language: "Python",
  solution: "",
  difficulty: "Medium",
  pattern: "Graphs",
  assistance: "independent",
  hints: 0,
  correctness: "passed",
  test_results: "",
  time_complexity: "",
  space_complexity: "",
  confidence: 3,
  notes: "",
  ...v,
});
const story: Story = {
  id: "s1",
  title: "Incident",
  principles: ["Ownership"],
  situation: "S",
  task: "T",
  action: "A",
  result: "R",
  evidence: "",
  follow_up_questions: "",
  confidence: 2,
  status: "practicing",
  updated_at: "2026-10-18T00:00:00Z",
};
const data = (v: Partial<Data> = {}): Data => ({
  ...structuredClone(emptyData),
  ...v,
});
const config = (hours = 2) => ({
  ...defaultPlannerConfig(),
  dailyMinutes: hours * 60,
  weekly: Array.from({ length: 7 }, () => [
    { start: "18:00", end: hours === 6 ? "24:00" : "20:00" },
  ]),
});
const active = (p: DayPlan) =>
  p.items.filter((i) => i.status !== "skipped" && i.status !== "missed");
function valid(p: DayPlan) {
  const items = active(p);
  for (let i = 1; i < items.length; i++)
    expect(Date.parse(items[i].start)).toBeGreaterThanOrEqual(
      Date.parse(items[i - 1].end),
    );
  for (const i of items) {
    expect(i.minutes).toBeLessThanOrEqual(45);
    expect(localDate(new Date(i.start), p.timezone)).toBe(p.day);
  }
}
describe("adaptive availability scheduler", () => {
  it.each([2, 6])(
    "fits sessions and breaks into %i available hours",
    (hours) => {
      const d = data({
        problems: Array.from({ length: 8 }, (_, i) => problem(`p${i}`)),
        stories: [story],
        attempts: [attempt({ problem_id: "old", correctness: "failed" })],
      });
      const p = generateAdaptiveWeek(d, config(hours), [], now)[0];
      expect(p.availableMinutes).toBe(hours * 60);
      expect(p.items.length).toBeGreaterThan(2);
      expect(p.studyMinutes).toBeLessThanOrEqual(hours * 60);
      valid(p);
      for (const item of p.items)
        expect(
          new Date(item.start).toLocaleTimeString("en-GB", {
            timeZone: p.timezone,
            hour: "2-digit",
            minute: "2-digit",
          }) >= "18:00",
        ).toBe(true);
    },
  );
  it("never assumes availability", () => {
    const p = generateAdaptiveWeek(data(), defaultPlannerConfig(), [], now)[0];
    expect(p.items).toEqual([]);
    expect(p.availableMinutes).toBe(0);
  });
  it("uses a short window without exceeding it", () => {
    const c = {
      ...config(),
      weekly: Array.from({ length: 7 }, () => [
        { start: "18:00", end: "18:20" },
      ]),
    };
    const p = generateAdaptiveWeek(data(), c, [], now)[0];
    expect(p.items).toHaveLength(1);
    expect(p.items[0].minutes).toBe(20);
    expect(p.items[0].reason).toContain("continue later");
  });
  it("honors overrides, days off, unavailable periods and nonoverlapping split windows", () => {
    const c: PlannerConfig = {
      ...config(),
      overrides: [{ date: day, windows: [] }],
    };
    expect(generateAdaptiveWeek(data(), c, [], now)[0].items).toEqual([]);
    c.overrides = [
      {
        date: day,
        windows: [
          { start: "12:00", end: "13:00" },
          { start: "18:00", end: "19:00" },
        ],
      },
    ];
    const blocked = {
      ...c,
      unavailable: [
        { start: "2026-10-19T09:15:00Z", end: "2026-10-19T09:45:00Z" },
      ],
    };
    const p = generateAdaptiveWeek(data(), blocked, [], now)[0];
    valid(p);
    expect(
      p.items.every(
        (i) =>
          Date.parse(i.end) <= Date.parse(blocked.unavailable[0].start) ||
          Date.parse(i.start) >= Date.parse(blocked.unavailable[0].end),
      ),
    ).toBe(true);
  });
  it("tapers for tomorrow's interview, reserves its exact time, then adapts when postponed", () => {
    const c = {
      ...config(6),
      rounds: [
        {
          id: "r1",
          title: "Coding",
          date: "2026-10-20",
          time: "19:00",
          duration: 60,
          format: "coding" as const,
        },
      ],
    };
    const w = generateAdaptiveWeek(
      data({ problems: [problem()], attempts: [attempt()] }),
      c,
      [],
      now,
    );
    expect(w[0].phase).toBe("Light review");
    expect(w[0].studyMinutes).toBeLessThanOrEqual(90);
    expect(w[0].items.some((i) => i.category === "coding")).toBe(false);
    expect(
      w[1].items.every(
        (i) => Date.parse(i.end) <= Date.parse("2026-10-20T16:00:00Z"),
      ),
    ).toBe(true);
    c.rounds[0].date = "2026-12-01";
    expect(generateAdaptiveWeek(data(), c, w, now)[0].phase).toBe(
      "Foundations",
    );
  });
  it("introduces self-directed rehearsal near a mixed interview", () => {
    const c = {
      ...config(6),
      rounds: [
        {
          id: "r",
          title: "Loop",
          date: "2026-10-24",
          time: "13:00",
          duration: 60,
          format: "mixed" as const,
        },
      ],
    };
    const p = generateAdaptiveWeek(
      data({ attempts: [attempt()], problems: [problem()] }),
      c,
      [],
      now,
    )[0];
    expect(p.phase).toBe("Interview rehearsal");
    expect(p.items.some((i) => i.category === "mock")).toBe(true);
  });
  it("preserves completed, skipped and pinned items and flags availability conflicts", () => {
    const first = generateAdaptiveWeek(data(), config(), [], now)[0];
    const completed = {
      ...first.items[0],
      status: "completed" as const,
      completed_at: "2026-10-19T15:20:00Z",
    };
    const pinned = {
      ...first.items.find((i) => i.category === "behavioral")!,
      pinned: true,
    };
    const old = { ...first, items: [completed, pinned] };
    const p = generateAdaptiveWeek(
      data(),
      { ...config(), weekly: Array.from({ length: 7 }, () => []) },
      [old],
      "2026-10-19T15:21:00Z",
    )[0];
    expect(p.items).toContainEqual(completed);
    expect(p.items).toContainEqual(pinned);
    expect(p.warnings.join()).toContain("Pinned session");
  });
  it("reclaims remaining time after early completion without changing the completed item", () => {
    const d = data({
      problems: [problem("p1"), problem("p2"), problem("p3")],
      stories: [story],
    });
    const old = generateAdaptiveWeek(d, config(), [], now)[0];
    const item = old.items[0],
      completed = {
        ...item,
        status: "completed" as const,
        completed_at: new Date(
          Date.parse(item.start) + 10 * 60000,
        ).toISOString(),
      };
    const p = generateAdaptiveWeek(
      d,
      config(),
      [{ ...old, items: [completed] }],
      new Date(Date.parse(item.start) + 11 * 60000).toISOString(),
    )[0];
    expect(p.items).toContainEqual(completed);
    expect(
      p.items.some(
        (i) =>
          i.status === "planned" && Date.parse(i.start) < Date.parse(item.end),
      ),
    ).toBe(true);
  });
  it("does not regenerate a skipped recommendation or treat a completion as a solve", () => {
    const d = data();
    const old = generateAdaptiveWeek(d, config(), [], now)[0];
    old.items[0].status = "skipped";
    const p = generateAdaptiveWeek(d, config(), [old], now)[0];
    expect(p.items.filter((i) => i.key === old.items[0].key)).toHaveLength(1);
    expect(p.baseline).toBe(true);
    expect(d.attempts).toEqual([]);
  });
  it("marks elapsed sessions missed and uses stable identifiers on repeated generation", () => {
    const a = generateAdaptiveWeek(data(), config(), [], now),
      b = generateAdaptiveWeek(data(), config(), [], now);
    expect(a).toEqual(b);
    const p = generateAdaptiveWeek(
      data(),
      config(),
      a,
      "2026-10-19T17:30:00Z",
    )[0];
    expect(p.items.filter((i) => i.status === "missed").length).toBeGreaterThan(
      0,
    );
  });
  it("respects recorded active seconds and session logs without inventing missing durations", () => {
    const a = attempt({
      attempted_on: day,
      test_results: serializeEvidence([], "", {
        seconds: 7200,
        source: "measured",
      }),
    });
    expect(
      generateAdaptiveWeek(data({ attempts: [a] }), config(), [], now)[0].items,
    ).toEqual([]);
    expect(
      generateAdaptiveWeek(
        {
          ...data(),
          sessions: [
            { studied_on: day, duration_minutes: 120, focus: "Graphs" },
          ],
        },
        config(),
        [],
        now,
      )[0].items,
    ).toEqual([]);
    expect(
      generateAdaptiveWeek(
        data({ attempts: [attempt({ attempted_on: day })] }),
        config(),
        [],
        now,
      )[0].items.length,
    ).toBeGreaterThan(0);
  });
  it("labels a baseline honestly and allocates behavioral coverage", () => {
    const p = generateAdaptiveWeek(data(), config(), [], now)[0];
    expect(p.baseline).toBe(true);
    expect(p.items.some((i) => i.title.includes("Baseline"))).toBe(true);
    expect(p.items.some((i) => i.category === "behavioral")).toBe(true);
  });
  it("explains the selected library problem's actual pattern", () => {
    const d = data({
      problems: [problem("unseen-tree", "Trees")],
      attempts: [attempt({ correctness: "failed" })],
    });
    const coding = generateAdaptiveWeek(d, config(), [], now)[0].items.find(
      (i) => i.category === "coding",
    )!;
    expect(coding.problem_id).toBe("unseen-tree");
    expect(coding.reason).toContain("Trees: 0 distinct recorded problems");
  });
  it("uses local day boundaries and survives DST gaps and folds", () => {
    const c = {
      ...config(),
      timezone: "America/New_York",
      weekly: Array.from({ length: 7 }, () => [
        { start: "01:00", end: "04:00" },
      ]),
    };
    expect(intervalMinutes(availableIntervals(c, "2026-03-08"))).toBe(120);
    expect(intervalMinutes(availableIntervals(c, "2026-11-01"))).toBe(240);
    expect(zonedInstant("2026-03-08", "02:30", c.timezone)).toBeNull();
    expect(
      generateAdaptiveWeek(data(), config(), [], "2026-10-18T22:00:00Z")[0].day,
    ).toBe("2026-10-19");
  });
  it("rejects invalid settings and nonexistent interview times", () => {
    expect(
      plannerConfigSchema.safeParse({ ...config(), timezone: "Unknown/Zone" })
        .success,
    ).toBe(false);
    expect(
      plannerConfigSchema.safeParse({
        ...config(),
        weekly: [[{ start: "20:00", end: "18:00" }], [], [], [], [], [], []],
      }).success,
    ).toBe(false);
    const c = {
      ...config(),
      interviewTimezone: "America/New_York",
      rounds: [
        {
          id: "r",
          title: "r",
          date: "2027-03-14",
          time: "02:30",
          duration: 60,
          format: "coding" as const,
        },
      ],
    };
    expect(() => generateAdaptiveWeek(data(), c, [], now)).toThrow(
      "does not exist",
    );
  });
});
describe("evidence and adaptive repetition", () => {
  it("prioritizes worsening results and repeated hints, while independent improvement reduces weakness", () => {
    const good = [attempt()],
      bad = [attempt({ correctness: "failed" })];
    expect(
      analyzePatterns(good).find((p) => p.pattern === "Graphs")!.strength,
    ).toBeGreaterThan(
      analyzePatterns(bad).find((p) => p.pattern === "Graphs")!.strength!,
    );
    const d = data({ problems: [problem()], attempts: bad });
    expect(adaptiveReviews(d, day)[0].priority).toBeGreaterThan(
      adaptiveReviews({ ...d, attempts: good }, day)[0].priority,
    );
    const hints = Array.from({ length: 3 }, (_, i) =>
      attempt({
        id: `a${i}`,
        attempted_on: `2026-10-${16 + i}`,
        assistance: "hinted",
        hints: 2,
      }),
    );
    const p = generateAdaptiveWeek(
      data({ attempts: hints, problems: [problem()] }),
      config(6),
      [],
      now,
    )[0];
    expect(p.explanation.join()).toContain("Shorter sessions");
    expect(p.items.every((i) => i.minutes <= 30)).toBe(true);
  });
  it("failed reviews do not advance repetition and overdue reviews gain priority", () => {
    const d = data({
      problems: [problem()],
      attempts: [
        attempt({ attempted_on: "2026-10-10" }),
        attempt({
          id: "a2",
          attempted_on: "2026-10-11",
          correctness: "failed",
        }),
      ],
    });
    expect(adaptiveReviews(d, day)[0].key).toContain(":0:");
    expect(adaptiveReviews(d, day)[0].priority).toBeGreaterThan(
      adaptiveReviews(d, "2026-10-12")[0].priority,
    );
    d.attempts.push(attempt({ id: "a3", attempted_on: "2026-10-13" }));
    expect(adaptiveReviews(d, day)[0].key).toContain(":1:");
  });
  it("waits until another day after a late successful review", () => {
    const d = data({
      problems: [problem()],
      attempts: [
        attempt({ attempted_on: "2026-10-01" }),
        attempt({ id: "a2", attempted_on: day }),
      ],
    });
    expect(adaptiveReviews(d, day)).toEqual([]);
    expect(adaptiveReviews(d, "2026-10-20")[0].key).toContain(":1:");
  });
  it("never treats hints, sample tests or viewed solutions as independent mastery", () => {
    for (const a of [
      attempt({ assistance: "solution-viewed" }),
      attempt({ hints: 1 }),
      attempt({
        correctness: "unverified",
        test_results: "All samples passed",
      }),
    ])
      expect(
        analyzePatterns([a]).find((p) => p.pattern === "Graphs")!.strength,
      ).toBe(0);
    const first = analyzePatterns([attempt()]).find(
      (p) => p.pattern === "Graphs",
    )!.strength!;
    const repeated = analyzePatterns([
      attempt(),
      attempt({ id: "a2", attempted_on: "2026-10-17" }),
    ]).find((p) => p.pattern === "Graphs")!.strength!;
    expect(first).toBeGreaterThan(repeated);
  });
});
describe("optional constrained coaching", () => {
  const p = generateAdaptiveWeek(data(), config(), [], now)[0],
    summary = coachingSummary(data(), p);
  const choice = {
    focus_keys: [summary.sessions[0].key],
    approach: "independent_first",
    difficulty: "maintain",
    pacing: "steady",
  };
  it("rejects invented references, unsupported weaknesses and additional claims", () => {
    expect(() =>
      validateCoachChoice({ ...choice, focus_keys: ["imaginary"] }, summary),
    ).toThrow();
    expect(() =>
      validateCoachChoice({ ...choice, approach: "revisit_errors" }, summary),
    ).toThrow();
    expect(() =>
      validateCoachChoice({ ...choice, note: "you mastered graphs" }, summary),
    ).toThrow();
  });
  it("handles API failures, refusals and malformed output without changing schedules", async () => {
    const before = structuredClone(p);
    for (const body of [
      { status: "failed", output: [] },
      { status: "completed", output: [{ content: [{ type: "refusal" }] }] },
      {
        status: "completed",
        output: [{ content: [{ type: "output_text", text: "{}" }] }],
      },
    ]) {
      const fetcher = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
      await expect(
        requestCoach(summary, { apiKey: "test", model: "test", fetcher }),
      ).rejects.toThrow();
    }
    await expect(
      requestCoach(summary, {
        apiKey: "test",
        model: "test",
        fetcher: vi.fn().mockRejectedValue(new Error("network")),
      }),
    ).rejects.toThrow();
    expect(p).toEqual(before);
  });
  it("uses structured output, excludes source text, and accepts supported choices", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "completed",
          output: [
            {
              content: [{ type: "output_text", text: JSON.stringify(choice) }],
            },
          ],
        }),
      ),
    );
    expect(
      await requestCoach(summary, { apiKey: "test", model: "test", fetcher }),
    ).toMatchObject(choice);
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.store).toBe(false);
    expect(body.text.format.strict).toBe(true);
    expect(body.input).not.toContain("solution");
  });
});
