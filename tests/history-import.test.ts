import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  attemptSchema,
  importSchema,
  emptyData,
  type Attempt,
  type Problem,
} from "../src/lib/domain";
import {
  adaptiveReviews,
  generateAdaptiveWeek,
} from "../src/lib/adaptive-planner";
import { defaultPlannerConfig } from "../src/lib/adaptive-types";

let db: PGlite;
const u1 = "11111111-1111-4111-8111-111111111111",
  u2 = "22222222-2222-4222-8222-222222222222";
const problem = {
  source_id: "islands",
  title: "Number of Islands",
  url: "https://leetcode.com/problems/number-of-islands/",
  leetcode_id: 200,
  difficulty: "Medium",
  pattern: "Graphs",
};
const attempt = {
  attempted_on: "2026-10-06",
  duration_minutes: null,
  language: "Python",
  solution: "",
  difficulty: "Medium",
  pattern: "Graphs",
  assistance: "independent",
  hints: 0,
  correctness: "passed",
  test_results: "Self-reported historical solve, not an official judge result.",
  time_complexity: "",
  space_complexity: "",
  confidence: null,
  notes: "",
};
const payload = {
  version: 1,
  problems: [
    problem,
    {
      ...problem,
      source_id: "substring",
      title: "Longest Substring Without Repeating Characters",
      url: "https://leetcode.com/problems/longest-substring-without-repeating-characters/",
      leetcode_id: 3,
      pattern: "Sliding window",
    },
  ],
  attempts: [
    { problem_source_id: "islands", data: attempt },
    {
      problem_source_id: "islands",
      data: { ...attempt, attempted_on: "2026-10-11" },
    },
    {
      problem_source_id: "substring",
      data: {
        ...attempt,
        assistance: "hinted",
        hints: null,
        pattern: "Sliding window",
      },
    },
  ],
  stories: [
    {
      title: "Fixture story",
      principles: ["Ownership"],
      situation: "S",
      task: "T",
      action: "A",
      result: "R",
      evidence: "",
      follow_up_questions: "",
      confidence: null,
      status: "practicing",
    },
  ],
};
async function asUser(id: string) {
  await db.exec(
    `reset role; set role authenticated; select set_config('request.jwt.claim.sub','${id}',false);`,
  );
}
async function run(value: unknown = payload, dry = true) {
  return (
    await db.query<{
      report: {
        committed: boolean;
        problems: { inserted: number; linked: number };
        attempts: { inserted: number; skipped: number };
        stories: { inserted: number; skipped: number };
        warnings: string[];
        conflicts: string[];
      };
    }>("select public.import_history_safe($1::jsonb,$2) as report", [
      JSON.stringify(value),
      dry,
    ])
  ).rows[0].report;
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth,public to authenticated; grant execute on function auth.uid() to authenticated; insert into auth.users values('${u1}'),('${u2}');`,
  );
  for (const file of [
    "202610170001_initial.sql",
    "202610170002_leetcode_identity.sql",
    "202610180001_adaptive_planner.sql",
  ])
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await asUser(u1);
  await db.exec(
    "insert into public.coding_problems(title,url,difficulty,pattern,leetcode_id) values('Number of Islands','','Medium','Graphs',200)",
  );
  const before = (await db.query("select * from public.coding_problems")).rows;
  await db.exec("reset role");
  await db.exec(
    readFileSync(
      "supabase/migrations/202610180002_safe_history_import.sql",
      "utf8",
    ),
  );
  await asUser(u1);
  expect(
    (
      await db.query(
        "select id,user_id,title,url,difficulty,pattern,created_at,leetcode_id,topic_tags from public.coding_problems",
      )
    ).rows,
  ).toEqual(before);
}, 30000);
afterAll(async () => {
  await db?.close();
});

describe.sequential("safe historical import under owner RLS", () => {
  it("validates nullable history without inventing assessments", () => {
    const parsed = importSchema.parse(payload);
    expect(parsed.attempts[0].data.confidence).toBeNull();
    expect(parsed.attempts[2].data.hints).toBeNull();
    expect(parsed.stories[0].confidence).toBeNull();
    expect(
      importSchema.safeParse({
        ...payload,
        attempts: [
          { problem_source_id: "islands", data: { ...attempt, hints: null } },
        ],
      }).success,
    ).toBe(false);
  });
  it("previews all rows with actual constraints and rolls back data and revisions", async () => {
    const revision = (
      await db.query("select public.get_planner_state() as value")
    ).rows;
    expect(await run()).toMatchObject({
      committed: false,
      problems: { inserted: 1, linked: 1 },
      attempts: { inserted: 3, skipped: 0 },
      stories: { inserted: 1, skipped: 0 },
      conflicts: [],
    });
    expect(
      (await db.query("select * from public.coding_problems")).rows,
    ).toHaveLength(1);
    expect(
      (await db.query("select * from public.coding_attempts")).rows,
    ).toHaveLength(0);
    expect(
      (await db.query("select public.get_planner_state() as value")).rows,
    ).toEqual(revision);
  });
  it("links existing #200 and preserves both dated attempts with unknown values", async () => {
    const existing = (
      await db.query(
        "select * from public.coding_problems where leetcode_id=200",
      )
    ).rows;
    expect((await run(payload, false)).committed).toBe(true);
    expect(
      (
        await db.query(
          "select * from public.coding_problems where leetcode_id=200",
        )
      ).rows,
    ).toEqual(existing);
    expect(
      (
        await db.query(
          "select attempted_on::text as day, confidence, duration_minutes from public.coding_attempts where pattern='Graphs' order by attempted_on",
        )
      ).rows,
    ).toEqual([
      { day: "2026-10-06", confidence: null, duration_minutes: null },
      { day: "2026-10-11", confidence: null, duration_minutes: null },
    ]);
    expect(
      (
        await db.query(
          "select hints,confidence from public.coding_attempts where assistance='hinted'",
        )
      ).rows,
    ).toEqual([{ hints: null, confidence: null }]);
  });
  it("repeated uploads and edited imported records never create duplicates or overwrite edits", async () => {
    await db.exec(
      "update public.coding_attempts set notes='A later user correction' where attempted_on='2026-10-11'",
    );
    const next = structuredClone(payload);
    next.problems[0].source_id = "renamed-local-source";
    next.attempts
      .slice(0, 2)
      .forEach((a) => (a.problem_source_id = "renamed-local-source"));
    expect(await run(next, false)).toMatchObject({
      problems: { inserted: 0, linked: 2 },
      attempts: { inserted: 0, skipped: 3 },
      stories: { inserted: 0, skipped: 1 },
    });
    expect(
      (
        await db.query<{ notes: string }>(
          "select notes from public.coding_attempts where attempted_on='2026-10-11'",
        )
      ).rows[0].notes,
    ).toBe("A later user correction");
  });
  it("reports metadata differences without replacing existing problem metadata", async () => {
    const next = structuredClone(payload);
    next.problems[0].pattern = "Trees";
    expect((await run(next)).warnings).toHaveLength(1);
    expect(
      (
        await db.query<{ pattern: string }>(
          "select pattern from public.coding_problems where leetcode_id=200",
        )
      ).rows[0].pattern,
    ).toBe("Graphs");
  });
  it("rolls back every row on invalid history and enforces known zero for independent attempts", async () => {
    const before = (
      await db.query("select * from public.coding_attempts order by id")
    ).rows;
    const next = structuredClone(payload);
    next.problems.push({
      ...problem,
      source_id: "rollback-only",
      title: "Rollback-only problem",
      url: "",
      leetcode_id: 99999,
    });
    next.attempts[0].data.hints = null as unknown as number;
    await expect(run(next, false)).rejects.toThrow();
    next.attempts[0].data.hints = 0;
    next.attempts[0].problem_source_id = "missing";
    await expect(run(next, false)).rejects.toThrow("Unknown problem source");
    expect(
      (await db.query("select * from public.coding_attempts order by id")).rows,
    ).toEqual(before);
    expect(
      (
        await db.query(
          "select id from public.coding_problems where title='Rollback-only problem'",
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("deduplicates manual imported problems without guessing existing title identities", async () => {
    const value = {
      version: 1,
      problems: [
        {
          source_id: "manual",
          title: "Source-only exercise",
          url: "",
          difficulty: "Medium",
          pattern: "Graphs",
        },
      ],
      attempts: [],
      stories: [],
    };
    expect((await run(value, false)).problems).toEqual({
      inserted: 1,
      linked: 0,
    });
    expect((await run(value, false)).problems).toEqual({
      inserted: 0,
      linked: 1,
    });
    await db.exec(
      "insert into public.coding_problems(title,url,difficulty,pattern) values('Unverified identity','','Medium','Graphs')",
    );
    value.problems[0].title = "Unverified identity";
    const report = await run(value, false);
    expect(report.committed).toBe(false);
    expect(report.conflicts[0]).toContain("without a verified shared identity");
  });
  it("separates accounts and links canonical legacy URLs", async () => {
    await asUser(u2);
    await db.exec(
      "insert into public.coding_problems(title,url,difficulty,pattern) values('Number of Islands','https://www.leetcode.com/problems/number-of-islands/description/?x=1','Medium','Graphs')",
    );
    expect(await run(payload, false)).toMatchObject({
      problems: { linked: 1, inserted: 1 },
      attempts: { inserted: 3, skipped: 0 },
      stories: { inserted: 1, skipped: 0 },
    });
    expect(
      (await db.query("select distinct user_id from public.coding_attempts"))
        .rows,
    ).toEqual([{ user_id: u2 }]);
    await asUser(u1);
    expect(
      (await db.query("select * from public.coding_attempts")).rows,
    ).toHaveLength(3);
  });
  it("rolls back conflicting identities and refuses unauthenticated import", async () => {
    await db.exec(
      "insert into public.coding_problems(title,url,difficulty,pattern) values('Duplicate legacy','https://leetcode.com/problems/number-of-islands/','Medium','Graphs')",
    );
    const count = (await db.query("select * from public.coding_attempts")).rows
      .length;
    const report = await run(payload, false);
    expect(report.committed).toBe(false);
    expect(report.conflicts).toHaveLength(1);
    expect(
      (await db.query("select * from public.coding_attempts")).rows,
    ).toHaveLength(count);
    await asUser("");
    await expect(run(payload, false)).rejects.toThrow(
      "Authentication required",
    );
  });
});

it("unassessed confidence is not scored as low confidence or rendered as null/5", () => {
  const p: Problem = {
    ...problem,
    id: "11111111-1111-4111-8111-111111111111",
    created_at: "2026-10-01T00:00:00Z",
    difficulty: "Medium",
    pattern: "Graphs",
  };
  const a = attemptSchema.parse({ ...attempt, problem_id: p.id });
  const history: Attempt = { ...a, id: "a" };
  const data = { ...emptyData, problems: [p], attempts: [history] };
  const unknown = adaptiveReviews(data, "2026-10-18")[0];
  const assessed = adaptiveReviews(
    { ...data, attempts: [{ ...history, confidence: 5 }] },
    "2026-10-18",
  )[0];
  expect(unknown.priority).toBe(assessed.priority);
  expect(unknown.reason).toContain("confidence unassessed");
  const days = generateAdaptiveWeek(
    data,
    defaultPlannerConfig(),
    [],
    "2026-10-18T08:00:00Z",
  );
  expect(JSON.stringify(days)).not.toContain("null/5");
});
