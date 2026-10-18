import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultPlannerConfig, type DayPlan } from "../src/lib/adaptive-types";
import { generateAdaptiveWeek } from "../src/lib/adaptive-planner";
import { emptyData } from "../src/lib/domain";
import { addDays } from "../src/lib/planner";
let db: PGlite,
  revision = 0,
  days: DayPlan[];
const u1 = "11111111-1111-4111-8111-111111111111",
  u2 = "22222222-2222-4222-8222-222222222222";
const tomorrow = addDays(new Date().toISOString().slice(0, 10), 2);
const config = {
  ...defaultPlannerConfig(),
  timezone: "UTC",
  aiConsent: true,
  weekly: Array.from({ length: 7 }, () => [{ start: "00:00", end: "24:00" }]),
};
async function asUser(id: string) {
  await db.exec(
    `reset role; set role authenticated; select set_config('request.jwt.claim.sub','${id}',false);`,
  );
}
async function state() {
  return (
    await db.query<{
      value: { revision: number; config: unknown; days: DayPlan[] };
    }>("select public.get_planner_state() as value")
  ).rows[0].value;
}
async function commit(p = days, rev = revision) {
  return db.query("select public.commit_planner_week($1,$2::jsonb)", [
    rev,
    JSON.stringify(p),
  ]);
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
}, 30000);
afterAll(async () => {
  await db?.close();
});
describe.sequential(
  "adaptive planner transactional persistence and isolation",
  () => {
    it("creates state and saves validated settings without replacing existing history", async () => {
      expect((await state()).revision).toBe(0);
      await db.query("select public.save_planner_config($1,$2::jsonb)", [
        0,
        JSON.stringify(config),
      ]);
      const s = await state();
      revision = Number(s.revision);
      expect(s.config).toEqual(config);
      await expect(
        db.query("select public.save_planner_config($1,$2::jsonb)", [
          revision,
          JSON.stringify({ ...config, timezone: "Invalid/Zone" }),
        ]),
      ).rejects.toThrow("Invalid timezone");
      expect((await state()).config).toEqual(config);
    });
    it("atomically persists a stable weekly plan twice without duplicates", async () => {
      days = generateAdaptiveWeek(
        emptyData,
        config,
        [],
        `${tomorrow}T00:00:00Z`,
      );
      await commit();
      await commit();
      expect(
        (await db.query("select * from public.study_plans")).rows,
      ).toHaveLength(7);
      expect((await state()).days).toEqual(days);
    });
    it("rejects overlapping, outside-window, unknown-reference and malformed plans atomically", async () => {
      const before = (await state()).days;
      const overlap = structuredClone(days);
      overlap[0].items.push({ ...overlap[0].items[0], key: "overlap" });
      await expect(commit(overlap)).rejects.toThrow("Overlapping");
      const unknown = structuredClone(days);
      unknown[0].items[0].problem_id = u2;
      await expect(commit(unknown)).rejects.toThrow("Unknown problem");
      const bad = structuredClone(days);
      bad[0].items[0].minutes = 91;
      await expect(commit(bad)).rejects.toThrow("Invalid session");
      const missing = structuredClone(days);
      delete (
        missing[0].items[0] as Partial<(typeof missing)[0]["items"][number]>
      ).start;
      await expect(commit(missing)).rejects.toThrow("Invalid session fields");
      const outside = structuredClone(days);
      outside[0].items[0].start = `${tomorrow}T23:50:00Z`;
      outside[0].items[0].end = new Date(
        Date.parse(outside[0].items[0].start) +
          outside[0].items[0].minutes * 60000,
      ).toISOString();
      await expect(commit(outside)).rejects.toThrow("crosses a study day");
      expect((await state()).days).toEqual(before);
    });
    it("preserves completions and pins during regeneration and rejects stale writes", async () => {
      const item = days[0].items[0];
      await db.query("select public.edit_planner_item($1,$2,$3,'complete')", [
        revision,
        days[0].day,
        item.key,
      ]);
      const s = await state();
      revision = Number(s.revision);
      await expect(commit(days, revision - 1)).rejects.toThrow(
        "Planner changed",
      );
      await expect(commit(days)).rejects.toThrow("must be preserved");
      const completed = s.days[0].items[0];
      expect(completed.status).toBe("completed");
      days = s.days;
      const pin = days[0].items.find((i) => i.status === "planned")!;
      await db.query("select public.edit_planner_item($1,$2,$3,'pin')", [
        revision,
        days[0].day,
        pin.key,
      ]);
      const pinned = await state();
      revision = Number(pinned.revision);
      days = pinned.days;
      const removed = structuredClone(days);
      removed[0].items = removed[0].items.filter((i) => i.key !== pin.key);
      await expect(commit(removed)).rejects.toThrow("must be preserved");
      expect((await state()).days[0].items[0]).toEqual(completed);
    });
    it("reschedules only into a free available interval and preserves skipped records", async () => {
      const target = days[1].items.find((i) => i.category === "coding")!;
      await db.query(
        "select public.edit_planner_item($1,$2,$3,'reschedule',$4)",
        [revision, days[1].day, target.key, `${days[1].day}T12:00:00Z`],
      );
      let s = await state();
      revision = Number(s.revision);
      days = s.days;
      expect(days[1].items.find((i) => i.key === target.key)!.pinned).toBe(
        true,
      );
      await db.query("select public.edit_planner_item($1,$2,$3,'skip')", [
        revision,
        days[1].day,
        target.key,
      ]);
      s = await state();
      revision = Number(s.revision);
      days = s.days;
      expect(days[1].items.find((i) => i.key === target.key)!.status).toBe(
        "skipped",
      );
    });
    it("rejects a plan that adds more study than the daily cap", async () => {
      const excessive = structuredClone(days);
      for (const hour of [12, 14]) {
        const original = excessive[4].items.find(
          (i) => i.category === "coding",
        )!;
        excessive[4].items.push({
          ...original,
          key: `extra:${hour}`,
          start: `${excessive[4].day}T${hour}:00:00.000Z`,
          end: `${excessive[4].day}T${hour}:45:00.000Z`,
          minutes: 45,
        });
      }
      await expect(commit(excessive)).rejects.toThrow("daily study cap");
    });
    it("invalidates plans after real evidence changes but does not alter attempts", async () => {
      const before = revision;
      await db.query(
        "insert into public.study_sessions(studied_on,duration_minutes,focus) values($1,30,'Graphs')",
        [tomorrow],
      );
      revision = Number((await state()).revision);
      expect(revision).toBeGreaterThan(before);
      await expect(commit(days, before)).rejects.toThrow("Planner changed");
      expect(
        (await db.query("select * from public.coding_attempts")).rows,
      ).toEqual([]);
    });
    it("moves across days atomically, preserves the source as skipped, and pins the target", async () => {
      const source = days[2].items.find((i) => i.category === "coding")!;
      await db.query(
        "select public.edit_planner_item($1,$2,$3,'reschedule',$4)",
        [revision, days[2].day, source.key, `${days[3].day}T12:00:00Z`],
      );
      const s = await state();
      revision = Number(s.revision);
      days = s.days;
      expect(days[2].items.find((i) => i.key === source.key)!.status).toBe(
        "skipped",
      );
      expect(
        days[3].items.some(
          (i) =>
            i.pinned && i.title === source.title && i.start.includes("12:00"),
        ),
      ).toBe(true);
    });
    it("matches JavaScript DST ambiguity and rejects null revisions", async () => {
      const r = await db.query<{ instant: Date }>(
        "select public.planner_wall_instant('2026-11-01','01:30','America/New_York') as instant",
      );
      expect(new Date(r.rows[0].instant).toISOString()).toBe(
        "2026-11-01T05:30:00.000Z",
      );
      await expect(
        db.query("select public.commit_planner_week(null,$1::jsonb)", [
          JSON.stringify(days),
        ]),
      ).rejects.toThrow("Planner changed");
    });
    it("enforces account isolation, denies direct plan writes and disallows cross-owner controls", async () => {
      await expect(
        db.query("update public.study_plans set payload='{}'::jsonb"),
      ).rejects.toThrow("permission denied");
      await asUser(u2);
      expect((await db.query("select * from public.study_plans")).rows).toEqual(
        [],
      );
      expect((await state()).days).toEqual([]);
      await expect(
        db.query("select public.edit_planner_item(0,$1,$2,'complete')", [
          days[0].day,
          days[0].items[0].key,
        ]),
      ).rejects.toThrow("Only planned");
      await expect(
        db.query("select public.save_planner_config(0,$1::jsonb)", [
          JSON.stringify({ ...config, aiConsent: false }),
        ]),
      ).resolves.toBeDefined();
      await expect(
        db.query("select public.reserve_planner_coach($1)", ["a".repeat(64)]),
      ).rejects.toThrow("consent");
      await asUser(u1);
    });
    it("reserves AI requests durably, caches choices, and rate-limits duplicate/in-flight requests", async () => {
      const reserve = async (key: string) =>
        (
          await db.query<{ v: { status: string } }>(
            "select public.reserve_planner_coach($1) as v",
            [key],
          )
        ).rows[0].v;
      const key = "a".repeat(64);
      expect((await reserve(key)).status).toBe("allowed");
      expect((await reserve(key)).status).toBe("limited");
      expect((await reserve("b".repeat(64))).status).toBe("limited");
      await db.query("select public.finish_planner_coach($1,$2::jsonb)", [
        key,
        JSON.stringify({
          focus_keys: [days[0].items[0].key],
          approach: "independent_first",
          difficulty: "maintain",
          pacing: "steady",
        }),
      ]);
      expect((await reserve(key)).status).toBe("cached");
      await asUser(u2);
      expect(
        (await db.query("select * from public.planner_coach_requests")).rows,
      ).toEqual([]);
      await asUser(u1);
    });
    it("validates availability, unavailable periods and interview blocks in PostgreSQL", async () => {
      await asUser(u2);
      const s = await state(),
        c = {
          ...config,
          interviewTimezone: "UTC",
          aiConsent: false,
          weekly: Array.from({ length: 7 }, () => [
            { start: "18:00", end: "20:00" },
          ]),
          unavailable: [
            { start: `${tomorrow}T18:30:00Z`, end: `${tomorrow}T19:00:00Z` },
          ],
          rounds: [
            {
              id: "r",
              title: "Interview",
              date: tomorrow,
              time: "19:00",
              duration: 60,
              format: "mixed" as const,
            },
          ],
        };
      await db.query("select public.save_planner_config($1,$2::jsonb)", [
        Number(s.revision),
        JSON.stringify(c),
      ]);
      const rev = Number((await state()).revision),
        week = generateAdaptiveWeek(emptyData, c, [], `${tomorrow}T00:00:00Z`);
      const check = async (hour: string, message: string) => {
        const p = structuredClone(week);
        p[0].items[0].start = `${tomorrow}T${hour}:00.000Z`;
        p[0].items[0].end = new Date(
          Date.parse(p[0].items[0].start) + p[0].items[0].minutes * 60000,
        ).toISOString();
        await expect(
          db.query("select public.commit_planner_week($1,$2::jsonb)", [
            rev,
            JSON.stringify(p),
          ]),
        ).rejects.toThrow(message);
      };
      await check("12:00", "outside availability");
      await check("18:40", "unavailable period");
      await check("18:55", "interview");
      expect((await state()).days).toEqual([]);
      await asUser(u1);
    });
  },
);
