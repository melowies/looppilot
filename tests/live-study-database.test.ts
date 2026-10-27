import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  defaultPlannerConfig,
  type PlannerState,
} from "../src/lib/adaptive-types";
import { generateAdaptiveWeek } from "../src/lib/adaptive-planner";
import { emptyData } from "../src/lib/domain";
import { serializeEvidence } from "../src/lib/coding-workspace";
let db: PGlite;
const u1 = "11111111-1111-4111-8111-111111111111",
  u2 = "22222222-2222-4222-8222-222222222222";
let problem: string;
const config = {
  ...defaultPlannerConfig(),
  timezone: "UTC",
  weekly: Array.from({ length: 7 }, () => [{ start: "00:00", end: "24:00" }]),
};
async function asUser(id: string) {
  await db.exec(
    `reset role; set role authenticated; select set_config('request.jwt.claim.sub','${id}',false);`,
  );
}
async function state() {
  return (
    await db.query<{ value: PlannerState }>(
      "select public.get_planner_state() as value",
    )
  ).rows[0].value;
}
async function action(kind: string, token = "tab", rev?: number) {
  const s = await state(),
    item = s.days[0].items[0];
  return db.query("select public.live_study_action($1,$2,$3,$4,$5)", [
    rev ?? s.revision,
    s.days[0].day,
    item.key,
    kind,
    token,
  ]);
}
async function seed(category = "coding") {
  await db.exec(
    "reset role; delete from public.study_plans; set role authenticated;",
  );
  const s = await state(),
    now = new Date(),
    start = new Date(Math.floor(now.getTime() / 60000) * 60000).toISOString();
  const p = generateAdaptiveWeek(emptyData, config, [], start)[0];
  p.items = [
    {
      ...p.items[0],
      key: `${p.day}:practice:${crypto.randomUUID()}`,
      category: category as "coding",
      title: "Practice Graphs",
      problem_id: category === "break" ? null : problem,
      start,
      end: new Date(
        Date.parse(start) + (category === "break" ? 5 : 30) * 60000,
      ).toISOString(),
      minutes: category === "break" ? 5 : 30,
    },
  ];
  // Simulates a plan committed just before this minute; subsequent writes use the real RPC.
  await db.exec("reset role");
  await db.query(
    "insert into public.study_plans(user_id,day,payload) values($1,$2,$3::jsonb)",
    [u1, p.day, JSON.stringify(p)],
  );
  await asUser(u1);
  return s;
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
    "202610180002_safe_history_import.sql",
    "202610180003_live_study_companion.sql",
  ])
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await asUser(u1);
  const s = await state();
  await db.query("select public.save_planner_config($1,$2::jsonb)", [
    s.revision,
    JSON.stringify(config),
  ]);
  problem = (
    await db.query<{ id: string }>(
      "insert into public.coding_problems(title,difficulty,pattern) values('Graph','Medium','Graphs') returning id",
    )
  ).rows[0].id;
}, 30000);
afterAll(async () => {
  await db?.close();
});
describe.sequential("live study atomic ownership, timing and evidence", () => {
  it("credits only witnessed seconds and excludes a short closed-app gap", async () => {
    await seed();
    await action("start");
    await db.exec("reset role");
    await db.exec(
      "update public.study_plans set payload=jsonb_set(payload,'{items,0,live,heartbeat_at}',to_jsonb(clock_timestamp()-interval '10 seconds'))",
    );
    await asUser(u1);
    const s = await state(),
      item = s.days[0].items[0];
    await db.query(
      "select public.live_study_action($1,$2,$3,'heartbeat','tab',3)",
      [s.revision, s.days[0].day, item.key],
    );
    expect((await state()).days[0].items[0].live!.elapsed_seconds).toBe(3);
    await action("heartbeat");
    expect((await state()).days[0].items[0].live!.elapsed_seconds).toBe(3);
  });
  it("starts once, rejects stale writes and prevents a second tab owning a running timer", async () => {
    await seed();
    await action("start");
    const s = await state();
    expect(s.days[0].items[0].live?.state).toBe("running");
    await expect(
      action("pause", "tab", Number(s.revision) - 1),
    ).rejects.toThrow("Planner changed");
    await expect(action("resume", "other-tab")).rejects.toThrow("another tab");
    await action("heartbeat", "other-tab");
    expect((await state()).days[0].items[0].live?.owner_token).toBe("tab");
  });
  it("pauses, resumes and finishes idempotently without changing mastery evidence", async () => {
    await action("pause");
    const paused = (await state()).days[0].items[0].live!;
    await action("heartbeat");
    expect((await state()).days[0].items[0].live).toEqual(paused);
    await action("resume");
    await action("finish");
    const s = await state();
    await action("finish", "tab", 0);
    expect((await state()).revision).toBe(s.revision);
    expect(s.days[0].items[0].completed_at).toBeTruthy();
    expect(
      (await db.query("select * from public.coding_attempts")).rows,
    ).toHaveLength(0);
  });
  it("expires a closed or hidden tab lease without adding unobserved seconds", async () => {
    await seed();
    await action("start");
    await db.exec("reset role");
    await db.exec(
      "update public.study_plans set payload=jsonb_set(payload,'{items,0,live,heartbeat_at}',to_jsonb(clock_timestamp()-interval '1 hour'))",
    );
    await asUser(u1);
    const item = (await state()).days[0].items[0];
    expect(item.live?.state).toBe("paused");
    expect(item.live?.elapsed_seconds).toBe(0);
  });
  it("requires a genuinely started and elapsed break, excluding paused time", async () => {
    await seed("break");
    await action("break_elapsed");
    expect((await state()).days[0].items[0].status).toBe("planned");
    await action("start");
    await action("break_elapsed");
    expect((await state()).days[0].items[0].status).toBe("planned");
    await action("pause");
    await db.exec("reset role");
    await db.exec(
      "update public.study_plans set payload=jsonb_set(payload,'{items,0,live,elapsed_seconds}','300')",
    );
    await asUser(u1);
    await action("break_elapsed");
    expect((await state()).days[0].items[0].status).toBe("planned");
    await action("resume");
    await action("break_elapsed");
    expect((await state()).days[0].items[0].status).toBe("completed");
    const s = await state();
    await action("break_elapsed");
    expect((await state()).revision).toBe(s.revision);
  });
  it.each(["failed", "partial", "passed"])(
    "completes a new linked %s attempt, retaining assistance and duration",
    async (correctness) => {
      await seed();
      await action("start");
      const s = await state(),
        item = s.days[0].items[0];
      const link = {
        day: s.days[0].day,
        key: item.key,
        startedAt: item.live!.started_at,
      };
      const id = crypto.randomUUID();
      await db.query(
        "insert into public.coding_attempts(id,problem_id,attempted_on,language,difficulty,pattern,assistance,hints,correctness,confidence,duration_minutes,test_results) values($1,$2,current_date,'Python','Medium','Graphs','guided',2,$3,2,19,$4)",
        [id, problem, correctness, serializeEvidence([], "", undefined, link)],
      );
      const done = (await state()).days[0].items[0];
      expect(done.status).toBe("completed");
      expect(done.live).toMatchObject({
        attempt_id: id,
        outcome: correctness,
        assistance: "guided",
        duration_minutes: 19,
      });
      const rev = (await state()).revision;
      await db.query(
        "update public.coding_attempts set notes='A reflection' where id=$1",
        [id],
      );
      expect((await state()).days[0].items[0]).toEqual(done);
      expect(Number((await state()).revision)).toBe(Number(rev) + 1);
    },
  );
  it("does not complete unverified drafts, unrelated attempts or newly linked historical edits", async () => {
    await seed();
    await action("start");
    const s = await state(),
      item = s.days[0].items[0];
    const link = {
        day: s.days[0].day,
        key: item.key,
        startedAt: item.live!.started_at,
      },
      id = crypto.randomUUID();
    const insert =
      "insert into public.coding_attempts(id,problem_id,attempted_on,language,difficulty,pattern,assistance,hints,correctness,confidence,test_results) values($1,$2,current_date,'Python','Medium','Graphs','independent',0,$3,3,$4)";
    await db.query(insert, [
      id,
      problem,
      "unverified",
      serializeEvidence([], "", undefined, link),
    ]);
    expect((await state()).days[0].items[0].status).toBe("planned");
    const historical = crypto.randomUUID();
    await db.query(insert, [historical, problem, "passed", ""]);
    await db.query(
      "update public.coding_attempts set test_results=$1 where id=$2",
      [serializeEvidence([], "", undefined, link), historical],
    );
    expect((await state()).days[0].items[0].status).toBe("planned");
    await db.query(
      "update public.coding_attempts set correctness='failed' where id=$1",
      [id],
    );
    expect((await state()).days[0].items[0].status).toBe("completed");
  });
  it("skips exactly once and rejects cross-account controls and direct metadata writes", async () => {
    await seed();
    await action("start");
    const s = await state(),
      item = s.days[0].items[0];
    await asUser(u2);
    expect((await state()).days).toEqual([]);
    await expect(
      db.query("select public.live_study_action($1,$2,$3,'finish','tab')", [
        s.revision,
        s.days[0].day,
        item.key,
      ]),
    ).rejects.toThrow("Unknown study session");
    await expect(
      db.exec("update public.study_plans set payload='{}'::jsonb"),
    ).rejects.toThrow("permission denied");
    await asUser(u1);
    await action("skip");
    const after = await state();
    await action("skip", "tab", 0);
    expect((await state()).revision).toBe(after.revision);
    expect(after.days[0].items[0].live?.state).toBe("skipped");
  });
  it("merges a concurrent heartbeat without resetting timing or adding overlapping work", async () => {
    await seed();
    await action("start");
    const stale = await state();
    await action("heartbeat");
    const latest = (await state()).days[0].items[0].live!;
    const proposed = generateAdaptiveWeek(
      emptyData,
      config,
      stale.days,
      new Date().toISOString(),
    );
    await db.query("select public.commit_planner_week($1,$2::jsonb)", [
      stale.revision,
      JSON.stringify(proposed),
    ]);
    expect((await state()).days[0].items[0].live).toEqual(latest);
    expect(
      (await state()).days[0].items.filter((i) => i.status === "planned"),
    ).toHaveLength(1);
  });
  it("replans after actual early/late completions using atomic availability and overlap validation", async () => {
    for (const late of [false, true]) {
      await seed();
      await action("start");
      if (late) {
        await db.exec("reset role");
        await db.exec(
          `update public.study_plans set payload=jsonb_set(jsonb_set(jsonb_set(jsonb_set(payload,'{items,0,start}',to_jsonb(clock_timestamp()-interval '65 minutes')),'{items,0,end}',to_jsonb(clock_timestamp()-interval '35 minutes')),'{items,0,live,started_at}',to_jsonb(clock_timestamp()-interval '65 minutes')),'{items,0,live,elapsed_seconds}','3900')`,
        );
        await asUser(u1);
      }
      await action("finish");
      const s = await state(),
        completed = s.days[0].items[0];
      const proposed = generateAdaptiveWeek(
        emptyData,
        config,
        s.days,
        new Date().toISOString(),
      );
      await db.query("select public.commit_planner_week($1,$2::jsonb)", [
        s.revision,
        JSON.stringify(proposed),
      ]);
      const saved = await state();
      expect(saved.days[0].items).toContainEqual(completed);
      for (const item of saved.days[0].items.filter(
        (i) => i.status === "planned" && i.category !== "break",
      ))
        expect(Date.parse(item.start)).toBeGreaterThanOrEqual(
          Date.parse(completed.completed_at!) + config.breakMinutes * 60000,
        );
    }
  });
  it("rejects forged new live metadata and movement of active sessions", async () => {
    await seed();
    await action("start");
    const s = await state(),
      item = s.days[0].items[0];
    await expect(
      db.query("select public.edit_planner_item($1,$2,$3,'pin')", [
        s.revision,
        s.days[0].day,
        item.key,
      ]),
    ).rejects.toThrow("active session");
    const proposed = structuredClone(s.days),
      extra = {
        ...item,
        key: "forged",
        start: new Date(Date.now() + 7200000).toISOString(),
        end: new Date(Date.now() + 9000000).toISOString(),
      };
    proposed[0].items.push(extra);
    await expect(
      db.query("select public.commit_planner_week($1,$2::jsonb)", [
        s.revision,
        JSON.stringify(proposed),
      ]),
    ).rejects.toThrow("Live session metadata");
  });
});
