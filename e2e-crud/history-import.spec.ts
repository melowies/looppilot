import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { test, expect } from "./fixtures";

// Synthetic evidence only. The supplied private package stays outside tests/git.
const payload = {
  version: 1,
  problems: [
    {
      source_id: "islands",
      title: "Number of Islands",
      url: "https://leetcode.com/problems/number-of-islands/",
      difficulty: "Medium",
      pattern: "Graphs",
    },
  ],
  attempts: [
    {
      problem_source_id: "islands",
      data: {
        attempted_on: "2026-10-06",
        duration_minutes: null,
        language: "Python",
        solution: "# Historical draft",
        difficulty: "Medium",
        pattern: "Graphs",
        assistance: "guided",
        hints: null,
        correctness: "partial",
        test_results: "No judge result supplied",
        time_complexity: "",
        space_complexity: "",
        confidence: null,
        notes: "Original historical notes",
      },
    },
  ],
  stories: [
    {
      title: "Historical story",
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

test("private account export, safe preview/import, repeats, and unknown historical fields", async ({
  page,
  store,
}, info) => {
  const db = new PGlite();
  try {
    const uid = "11111111-1111-4111-8111-111111111111";
    await db.exec(
      `create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth,public to authenticated; grant execute on function auth.uid() to authenticated; insert into auth.users values('${uid}');`,
    );
    for (const file of readdirSync("supabase/migrations")
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
    await db.exec(
      `set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false); insert into public.coding_problems(title,url,difficulty,pattern,leetcode_id) values('Number of Islands','','Medium','Graphs',200);`,
    );
    const records = async (table: string) =>
      (
        await db.query<{ value: Record<string, unknown> }>(
          `select to_jsonb(p) as value from public.${table} p`,
        )
      ).rows.map((r) => r.value);
    store.problems = await records("coding_problems");
    let missingMigration = true,
      failCommit = true;
    await page.route("**/rest/v1/rpc/import_history_safe", async (route) => {
      if (missingMigration) {
        await route.fulfill({
          status: 404,
          json: { code: "PGRST202", message: "Function unavailable" },
        });
        return;
      }
      const value = route.request().postDataJSON();
      if (!value.dry_run && failCommit) {
        failCommit = false;
        await route.fulfill({
          status: 500,
          json: { message: "Temporary import failure. Retry safely." },
        });
        return;
      }
      const result = await db.query<{ report: unknown }>(
        "select public.import_history_safe($1::jsonb,$2) as report",
        [JSON.stringify(value.payload), value.dry_run],
      );
      if (!value.dry_run) {
        store.problems = await records("coding_problems");
        store.attempts = await records("coding_attempts");
        store.stories = await records("behavioral_stories");
        store.planner.revision++;
      }
      await route.fulfill({ json: result.rows[0].report });
    });
    await page.goto("/settings");
    await expect(
      page.getByRole("heading", { name: "Settings & data", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Export current workspace",
        exact: true,
      }),
    ).toBeEnabled();
    const sourceFile = info.outputPath("history.json");
    writeFileSync(sourceFile, JSON.stringify(payload));
    await page
      .getByLabel("Load a JSON source file", { exact: true })
      .setInputFiles(sourceFile);
    const validate = page.getByRole("button", {
      name: "Validate & preview",
      exact: true,
    });
    await validate.click();
    await expect(
      page.locator(".import-panel").getByRole("alert"),
    ).toContainText("202610180002_safe_history_import.sql");
    missingMigration = false;
    await validate.click();
    const preview = page.locator(".import-preview");
    await expect(preview).toContainText(
      "0 new problems · 1 existing problems linked",
    );
    await expect(preview).toContainText(
      "1 new attempts · 0 repeated attempts skipped",
    );
    expect(store.attempts).toHaveLength(0);
    const commit = page.getByRole("button", {
      name: "Import validated records",
      exact: true,
    });
    await expect(commit).toBeDisabled();
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Export current workspace", exact: true })
      .click();
    const backup = await download;
    expect(backup.suggestedFilename()).toMatch(/^looppilot-backup-/);
    await backup.saveAs(
      `artifacts/history-import/${info.project.name}-synthetic-backup.json`,
    );
    await expect(commit).toBeEnabled();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: `artifacts/history-import/${info.project.name}-preview.png`,
      fullPage: true,
    });
    await commit.click();
    await expect(
      page.getByText("Temporary import failure. Retry safely.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(commit).toBeEnabled();
    await expect(
      page.getByLabel("Import JSON", { exact: true }),
    ).not.toHaveValue("");
    await commit.click();
    await expect(
      page.getByText("History imported atomically.", { exact: false }),
    ).toBeVisible();
    expect(store.problems).toHaveLength(1);
    expect(store.attempts).toHaveLength(1);
    expect(store.stories).toHaveLength(1);
    expect(store.attempts[0]).toMatchObject({
      confidence: null,
      hints: null,
      duration_minutes: null,
      attempted_on: "2026-10-06",
    });
    await page
      .getByLabel("Load a JSON source file", { exact: true })
      .setInputFiles(sourceFile);
    await validate.click();
    await expect(preview).toContainText(
      "0 new attempts · 1 repeated attempts skipped",
    );
    await expect(preview).toContainText(
      "0 new stories · 1 repeated stories skipped",
    );
    await commit.click();
    await expect(page.getByLabel("Import JSON", { exact: true })).toHaveValue(
      "",
    );
    expect(store.attempts).toHaveLength(1);
    await page.goto("/stories");
    await expect(
      page.getByText("Confidence unassessed", { exact: true }),
    ).toBeVisible();
    await page.goto(`/coding/${store.problems[0].id}/practice`);
    await page
      .getByLabel("Attempt", { exact: true })
      .selectOption(store.attempts[0].id as string);
    await page.getByRole("tab", { name: "Reflection", exact: true }).click();
    await expect(page.getByLabel("Confidence", { exact: true })).toHaveValue(
      "",
    );
    await expect(
      page.getByLabel("Number of hints", { exact: true }),
    ).toHaveValue("");
    await page
      .getByLabel("Personal notes", { exact: true })
      .fill("A later reflection");
    await page
      .getByRole("button", { name: "Save attempt", exact: true })
      .click();
    await expect(
      page.getByText("Attempt saved", { exact: false }),
    ).toBeVisible();
    expect(store.attempts[0]).toMatchObject({
      confidence: null,
      hints: null,
      duration_minutes: null,
      attempted_on: "2026-10-06",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `artifacts/history-import/${info.project.name}-reflection.png`,
      fullPage: true,
    });
  } finally {
    await db.close();
  }
});
