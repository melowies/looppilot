import { test, expect } from "./fixtures";
import { defaultPlannerConfig } from "../src/lib/adaptive-types";
const now = new Date("2026-10-19T08:00:00Z");
test("availability creates a timed baseline and preserves completed and pinned sessions", async ({
  page,
  store,
}, testInfo) => {
  await page.clock.install({ time: now });
  await page.goto("/plan");
  await expect(
    page.getByRole("heading", { name: "Your study plan" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("button", { name: "Edit availability", exact: true })
      .first(),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Edit availability", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const monday = dialog.getByRole("group", { name: "Monday", exact: true });
  await monday.getByRole("button", { name: "Add time window" }).click();
  await dialog.getByLabel("Monday start 1", { exact: true }).fill("18:00");
  await dialog.getByLabel("Monday end 1", { exact: true }).fill("20:00");
  await dialog
    .getByRole("tab", { name: "Interview rounds", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Add interview round" }).click();
  await dialog.getByLabel("Round 1 date", { exact: true }).fill("2026-11-25");
  await dialog.getByLabel("Round 1 time", { exact: true }).fill("13:00");
  await dialog
    .getByRole("button", { name: "Save availability", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByText("120 min", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Baseline assessment:/ }),
  ).toBeVisible();
  const first = page
    .locator(".planner-session")
    .filter({ hasText: "Baseline assessment" });
  await first.getByRole("button", { name: "Complete", exact: true }).click();
  await expect(first.getByText("completed", { exact: true })).toBeVisible();
  const completed = structuredClone(
    store.planner.days[0].items.find((i) => i.status === "completed"),
  );
  const behavior = page
    .locator(".planner-session")
    .filter({ hasText: "Develop a story:" });
  await behavior.getByRole("button", { name: /^Pin / }).click();
  await expect(behavior.getByRole("button", { name: /^Unpin / })).toBeEnabled();
  await page.getByRole("button", { name: "Regenerate remaining plan" }).click();
  await expect(behavior.getByRole("button", { name: /^Unpin / })).toBeEnabled();
  expect(
    store.planner.days[0].items.find((i) => i.status === "completed"),
  ).toEqual(completed);
  expect(store.attempts).toHaveLength(0);
  await expect(
    page.getByText("OpenAI coaching is off.", { exact: false }),
  ).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty(
    "scrollWidth",
    await page.locator("body").evaluate((e) => e.clientWidth),
  );
  await page.screenshot({
    path: `artifacts/${testInfo.project.name}-adaptive-plan.png`,
    fullPage: true,
  });
});
test("skips, reschedules, and adapts to stored failures without duplicating generation", async ({
  page,
  store,
}) => {
  await page.clock.install({ time: now });
  store.planner.config = {
    ...defaultPlannerConfig(),
    weekly: Array.from({ length: 7 }, () => [{ start: "18:00", end: "22:00" }]),
    dailyMinutes: 180,
  };
  await page.goto("/plan");
  const first = page
    .locator(".planner-session")
    .filter({ hasText: "Baseline assessment" });
  await expect(first).toBeVisible();
  await first.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(first.getByText("skipped", { exact: true })).toBeVisible();
  const behavior = page
    .locator(".planner-session")
    .filter({ hasText: "Develop a story:" });
  await behavior
    .getByRole("button", { name: "Reschedule", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("New start time", { exact: true }).fill("21:00");
  await dialog.getByRole("button", { name: "Reschedule", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(behavior.getByText("21:00", { exact: true })).toBeVisible();
  const day = store.planner.days.find((p) => p.day === "2026-10-19")!;
  expect(new Set(day.items.map((i) => i.key)).size).toBe(day.items.length);
  store.attempts.push({
    id: "22222222-2222-4222-8222-222222222222",
    problem_id: "33333333-3333-4333-8333-333333333333",
    attempted_on: "2026-10-18",
    duration_minutes: null,
    language: "Python",
    solution: "",
    difficulty: "Medium",
    pattern: "Graphs",
    assistance: "hinted",
    hints: 2,
    correctness: "failed",
    test_results: "",
    time_complexity: "",
    space_complexity: "",
    confidence: 1,
    notes: "",
  });
  store.planner.revision++;
  await page.getByRole("button", { name: "Regenerate remaining plan" }).click();
  await expect(
    page.getByRole("heading", { name: "Practice graphs" }),
  ).toBeVisible();
  expect(
    store.planner.days
      .find((p) => p.day === "2026-10-19")!
      .items.some((i) => i.status === "skipped"),
  ).toBe(true);
  await behavior
    .getByRole("button", { name: "Reschedule", exact: true })
    .click();
  await dialog.getByLabel("New date", { exact: true }).fill("2026-10-20");
  await dialog.getByLabel("New start time", { exact: true }).fill("21:00");
  await dialog.getByRole("button", { name: "Reschedule", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.locator(".planner-week-day").filter({ hasText: "Tue" }).click();
  await expect(behavior.getByText("21:00", { exact: true })).toBeVisible();
  expect(
    store.planner.days
      .find((p) => p.day === "2026-10-20")!
      .items.some((i) => i.pinned && i.category === "behavioral"),
  ).toBe(true);
});
test("AI failure leaves scheduling usable and a new local day extends the week", async ({
  page,
  store,
}) => {
  await page.clock.install({ time: now });
  store.planner.config = {
    ...defaultPlannerConfig(),
    aiConsent: true,
    weekly: Array.from({ length: 7 }, () => [{ start: "18:00", end: "20:00" }]),
  };
  let coachCalls = 0;
  await page.route("**/api/planner/coach", async (route) => {
    coachCalls++;
    await route.fulfill({
      status: 503,
      json: {
        error:
          "OpenAI coaching is unavailable: OPENAI_API_KEY is not configured. Your deterministic schedule is ready.",
      },
    });
  });
  await page.goto("/plan");
  await expect(
    page.getByRole("heading", { name: /Baseline assessment:/ }),
  ).toBeVisible();
  await expect(
    page.getByText("OpenAI coaching is unavailable:", { exact: false }),
  ).toBeVisible();
  expect(coachCalls).toBe(1);
  const old = structuredClone(
    store.planner.days.find((d) => d.day === "2026-10-19"),
  );
  await page.clock.setSystemTime(new Date("2026-10-20T08:00:00Z"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect
    .poll(() => store.planner.days.some((d) => d.day === "2026-10-26"))
    .toBe(true);
  expect(store.planner.days.find((d) => d.day === "2026-10-19")).toEqual(old);
  expect(store.attempts).toHaveLength(0);
});
