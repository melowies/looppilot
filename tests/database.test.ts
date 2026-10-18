import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { durationMinutes } from "../src/lib/practice-timer";
import {
  readTestEvidence,
  serializeEvidence,
} from "../src/lib/coding-workspace";

let db: PGlite;
const u1 = "11111111-1111-4111-8111-111111111111",
  u2 = "22222222-2222-4222-8222-222222222222";
let problemId: string, attemptId: string;
async function asUser(id: string) {
  await db.exec(
    `reset role; set role authenticated; select set_config('request.jwt.claim.sub','${id}',false);`,
  );
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth, public to authenticated; grant execute on function auth.uid() to authenticated; insert into auth.users values('${u1}'),('${u2}');`,
  );
  await db.exec(
    readFileSync("supabase/migrations/202610170001_initial.sql", "utf8"),
  );
});
afterAll(async () => {
  await db?.close();
});
describe.sequential(
  "PostgreSQL migration, CRUD, ownership and atomic imports",
  () => {
    it("creates and reads a problem as its owner", async () => {
      await asUser(u1);
      const r = await db.query<{ id: string }>(
        "insert into public.coding_problems(title,difficulty,pattern) values('Two Sum','Easy','Arrays & hashing') returning id",
      );
      problemId = r.rows[0].id;
      expect(
        (await db.query("select * from public.coding_problems")).rows,
      ).toHaveLength(1);
    });
    it("creates, edits, and reads an attempt", async () => {
      const r = await db.query<{ id: string }>(
        `insert into public.coding_attempts(problem_id,attempted_on,language,difficulty,pattern,assistance,correctness,confidence) values('${problemId}','2026-10-17','Python','Easy','Arrays & hashing','guided','passed',2) returning id`,
      );
      attemptId = r.rows[0].id;
      await db.query(
        "update public.coding_attempts set solution=$1 where id=$2",
        ["return [0, 1]", attemptId],
      );
      expect(
        (
          await db.query<{ solution: string }>(
            "select solution from public.coding_attempts",
          )
        ).rows[0].solution,
      ).toBe("return [0, 1]");
    });
    it("stores rounded minutes and exact active seconds without changing correctness", async () => {
      const timing = { seconds: 61.25, source: "measured" as const };
      await db.query(
        "update public.coding_attempts set duration_minutes=$1,test_results=$2 where id=$3",
        [
          durationMinutes(timing.seconds),
          serializeEvidence([], "Manual evidence", timing),
          attemptId,
        ],
      );
      const stored = (
        await db.query<{
          duration_minutes: number;
          test_results: string;
          correctness: string;
        }>(
          "select duration_minutes,test_results,correctness from public.coding_attempts where id=$1",
          [attemptId],
        )
      ).rows[0];
      expect(stored.duration_minutes).toBe(2);
      expect(readTestEvidence(stored.test_results)).toMatchObject({
        evidence: "Manual evidence",
        timing,
      });
      expect(stored.correctness).toBe("passed");
    });
    it("rejects independent attempts with hints in PostgreSQL", async () => {
      await expect(
        db.query(
          `update public.coding_attempts set assistance='independent',hints=1 where id='${attemptId}'`,
        ),
      ).rejects.toThrow();
    });
    it("hides another user’s data and rejects cross-owner relations", async () => {
      await asUser(u2);
      expect(
        (await db.query("select * from public.coding_problems")).rows,
      ).toHaveLength(0);
      expect(
        (await db.query("select * from public.coding_attempts")).rows,
      ).toHaveLength(0);
      await expect(
        db.query(
          `insert into public.coding_attempts(problem_id,attempted_on,language,difficulty,pattern,assistance,correctness,confidence) values('${problemId}','2026-10-17','Python','Easy','Arrays & hashing','guided','passed',2)`,
        ),
      ).rejects.toThrow();
      expect(
        (
          await db.query(
            `update public.coding_problems set title='Stolen' where id='${problemId}' returning id`,
          )
        ).rows,
      ).toHaveLength(0);
    });
    it("rejects spoofed ownership and profile writes", async () => {
      await expect(
        db.query(
          `insert into public.coding_problems(user_id,title,difficulty,pattern) values('${u1}','Spoofed','Easy','Graphs')`,
        ),
      ).rejects.toThrow();
      await expect(
        db.query(`insert into public.profiles(id) values('${u1}')`),
      ).rejects.toThrow();
    });
    it("creates, edits, and deletes a STAR story", async () => {
      await asUser(u1);
      const r = await db.query<{ id: string }>(
        "insert into public.behavioral_stories(title,principles,confidence,status) values('Incident',array['Ownership'],3,'draft') returning id",
      );
      const id = r.rows[0].id;
      await expect(
        db.query(
          `update public.behavioral_stories set status='ready' where id='${id}'`,
        ),
      ).rejects.toThrow();
      await db.query(
        `update public.behavioral_stories set situation='S',task='T',action='A',result='R',status='ready' where id='${id}'`,
      );
      expect(
        (await db.query("select * from public.behavioral_stories")).rows,
      ).toHaveLength(1);
      await asUser(u2);
      expect(
        (await db.query("select * from public.behavioral_stories")).rows,
      ).toHaveLength(0);
      await asUser(u1);
      await db.query("delete from public.behavioral_stories where id=$1", [id]);
    });
    it("imports real records atomically and rolls back a broken import", async () => {
      const payload = {
        version: 1,
        problems: [
          {
            source_id: "two",
            title: "Imported",
            url: "",
            difficulty: "Medium",
            pattern: "Graphs",
          },
        ],
        attempts: [
          {
            problem_source_id: "two",
            data: {
              attempted_on: "2026-10-12",
              duration_minutes: null,
              language: "Python",
              difficulty: "Medium",
              pattern: "Graphs",
              assistance: "solution-viewed",
              hints: 0,
              correctness: "unverified",
              confidence: 1,
            },
          },
        ],
        stories: [],
      };
      await db.query("select public.import_history($1::jsonb)", [
        JSON.stringify(payload),
      ]);
      expect(
        (
          await db.query(
            "select * from public.coding_problems where title='Imported'",
          )
        ).rows,
      ).toHaveLength(1);
      payload.attempts[0].problem_source_id = "missing";
      await expect(
        db.query("select public.import_history($1::jsonb)", [
          JSON.stringify(payload),
        ]),
      ).rejects.toThrow();
      expect(
        (
          await db.query(
            "select * from public.coding_problems where title='Imported'",
          )
        ).rows,
      ).toHaveLength(1);
    });
    it("protects tasks, sessions and snapshots and enforces task completion state", async () => {
      await asUser(u1);
      await db.query(
        "insert into public.daily_study_tasks(title,reason,due_on,recommendation_key) values('Review','Low confidence','2026-10-17','review:test')",
      );
      await expect(
        db.query(
          "update public.daily_study_tasks set status='completed' where recommendation_key='review:test'",
        ),
      ).rejects.toThrow();
      await db.query(
        "update public.daily_study_tasks set status='completed',completed_at=now() where recommendation_key='review:test'",
      );
      await db.query(
        "insert into public.study_sessions(studied_on,duration_minutes,focus) values('2026-10-17',30,'Graphs')",
      );
      await db.query(
        "insert into public.readiness_snapshots(score,evidence) values(50,'{}')",
      );
      await asUser(u2);
      for (const table of [
        "daily_study_tasks",
        "study_sessions",
        "readiness_snapshots",
      ]) {
        expect(
          (await db.query(`select * from public.${table}`)).rows,
        ).toHaveLength(0);
        expect(
          (await db.query(`delete from public.${table} returning id`)).rows,
        ).toHaveLength(0);
      }
      await asUser(u1);
    });
    it("rejects invalid direct import RPC payloads", async () => {
      await expect(
        db.query("select public.import_history('{}'::jsonb)"),
      ).rejects.toThrow("Unsupported version");
      await expect(
        db.query(`select public.import_history('{"version":1}'::jsonb)`),
      ).rejects.toThrow("Expected problems");
    });
    it("deletes attempts with their parent problem", async () => {
      await db.query("delete from public.coding_problems where id=$1", [
        problemId,
      ]);
      expect(
        (
          await db.query("select * from public.coding_attempts where id=$1", [
            attemptId,
          ])
        ).rows,
      ).toHaveLength(0);
    });
    it("adds LeetCode identity without changing existing problems or attempts", async () => {
      await db.exec("reset role");
      const before = await db.query(
        "select id,title,url from public.coding_problems order by id",
      );
      const attemptsBefore = await db.query(
        "select * from public.coding_attempts order by id",
      );
      await db.exec(
        readFileSync(
          "supabase/migrations/202610170002_leetcode_identity.sql",
          "utf8",
        ),
      );
      expect(
        (
          await db.query(
            "select id,title,url from public.coding_problems order by id",
          )
        ).rows,
      ).toEqual(before.rows);
      expect(
        (await db.query("select * from public.coding_attempts order by id"))
          .rows,
      ).toEqual(attemptsBefore.rows);
      expect(
        (
          await db.query<{ leetcode_id: number | null }>(
            "select leetcode_id from public.coding_problems",
          )
        ).rows.every((r) => r.leetcode_id === null),
      ).toBe(true);
    });
    it("rejects duplicate frontend numbers per account, permits other users and manual entries", async () => {
      await asUser(u1);
      await db.query(
        "insert into public.coding_problems(title,difficulty,pattern,leetcode_id) values('Two Sum','Easy','Arrays & hashing',1)",
      );
      await expect(
        db.query(
          "insert into public.coding_problems(title,difficulty,pattern,leetcode_id) values('Different title','Medium','Graphs',1)",
        ),
      ).rejects.toThrow();
      await db.query(
        "insert into public.coding_problems(title,difficulty,pattern) values('Manual','Easy','Graphs'),('Manual again','Easy','Graphs')",
      );
      await asUser(u2);
      await db.query(
        "insert into public.coding_problems(title,difficulty,pattern,leetcode_id) values('Two Sum','Easy','Arrays & hashing',1)",
      );
      expect(
        (await db.query("select * from public.coding_attempts")).rows,
      ).toHaveLength(0);
      await expect(
        db.query(
          "insert into public.coding_problems(title,difficulty,pattern,leetcode_id) values('Invalid','Easy','Graphs',0)",
        ),
      ).rejects.toThrow();
    });
  },
);
