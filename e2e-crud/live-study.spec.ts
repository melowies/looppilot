import { test, expect } from "./fixtures";
import { defaultPlannerConfig } from "../src/lib/adaptive-types";
import { generateAdaptiveWeek } from "../src/lib/adaptive-planner";
import { emptyData } from "../src/lib/domain";
const instant = new Date("2026-10-19T08:00:00Z");
const problem = {
  id: "33333333-3333-4333-8333-333333333333",
  title: "Two Sum",
  url: "https://leetcode.com/problems/two-sum/",
  difficulty: "Medium",
  pattern: "Arrays & hashing",
  created_at: "2026-10-17T00:00:00Z",
};
test.setTimeout(60000);
test("canonical task persists through navigation, pause, refresh and unavailable connectivity", async ({
  page,
  store,
}, info) => {
  await page.clock.install({ time: instant });
  store.problems.push(problem);
  store.planner.config = {
    ...defaultPlannerConfig(),
    timezone: "UTC",
    weekly: Array.from({ length: 7 }, () => [{ start: "08:00", end: "11:00" }]),
  };
  await page.goto("/");
  const companion = page.getByRole("complementary", {
    name: "Live study companion",
  });
  await expect(companion).toBeVisible();
  const title = await companion.locator(".companion-toggle strong").innerText();
  await expect(page.getByTestId("canonical-focus")).toContainText(title);
  await companion.locator(".companion-toggle").click();
  await companion.getByRole("button", { name: "Start", exact: true }).click();
  await expect(
    companion.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => store.planner.days[0].items.find((i) => i.live)?.live?.state)
    .toBe("running");
  await page.screenshot({
    path: `artifacts/${info.project.name}-live-study-overview.png`,
    fullPage: false,
  });
  await page.clock.runFor(6000);
  await expect
    .poll(
      () =>
        store.planner.days[0].items.find((i) => i.live)?.live
          ?.elapsed_seconds ?? 0,
    )
    .toBeGreaterThanOrEqual(5);
  await companion.getByRole("link", { name: "Open task", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/coding/${problem.id}/practice`));
  await expect(companion).toContainText(title);
  await expect(
    page.getByRole("button", { name: "Save attempt", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Solution code" })
    .waitFor({ state: "attached" });
  if (
    (await companion
      .locator(".companion-toggle")
      .getAttribute("aria-expanded")) === "false"
  )
    await companion.locator(".companion-toggle").click();
  await companion.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(
    companion.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  const paused = store.planner.days[0].items.find((i) => i.live)!.live!
    .elapsed_seconds;
  const ideBounds = await page.locator(".practice-content").boundingBox(),
    panelBounds = await companion.boundingBox();
  expect(ideBounds!.y + ideBounds!.height).toBeLessThanOrEqual(panelBounds!.y);
  if (info.project.name === "mobile")
    await companion.locator(".companion-toggle").click();
  await page.screenshot({
    path: `artifacts/${info.project.name}-live-study-ide-active.png`,
    fullPage: false,
  });
  await page.goto("/stories");
  await expect(companion).toContainText(title);
  await page.getByRole("button", { name: "Add story", exact: true }).click();
  const storyEditor = page.getByRole("dialog");
  await expect(storyEditor.getByLabel("Current study session")).toContainText(
    title,
  );
  await storyEditor
    .getByLabel("Story title", { exact: true })
    .fill("Draft only; no rehearsal recorded");
  expect(
    store.planner.days[0].items.find((i) => i.title === title)?.status,
  ).toBe("planned");
  await page.screenshot({
    path: `artifacts/${info.project.name}-live-study-story-editor.png`,
    fullPage: false,
  });
  await storyEditor
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await page.goto("/analytics");
  await expect(companion).toContainText(title);
  await page.goto(`/coding/${problem.id}/practice`);
  await page.clock.runFor(60000);
  await page.reload();
  await expect(companion).toContainText(title);
  expect(
    store.planner.days[0].items.find((i) => i.live)!.live!.elapsed_seconds,
  ).toBe(paused);
  await companion.locator(".companion-toggle").click();
  await companion.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(
    companion.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await page.route(
    "https://looppilot-e2e.supabase.co/rest/v1/rpc/live_study_action",
    (route) => route.abort("internetdisconnected"),
  );
  await companion.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(companion.getByRole("alert")).toContainText(
    "last saved session is retained",
  );
  await expect(companion).toContainText(title);
  await page.unroute(
    "https://looppilot-e2e.supabase.co/rest/v1/rpc/live_study_action",
  );
  await companion.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(
    companion.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  await companion.getByRole("button", { name: "Finish", exact: true }).click();
  await expect
    .poll(
      () => store.planner.days[0].items.find((i) => i.title === title)?.status,
    )
    .toBe("completed");
  await page.goto("/plan");
  await expect(companion).toBeVisible();
  const plannedTitle = await companion
    .locator(".companion-toggle strong")
    .innerText();
  await expect(
    page
      .locator(".planner-session")
      .getByRole("heading", { name: plannedTitle, exact: true })
      .first(),
  ).toBeVisible();
  await expect(
    page
      .locator(".planner-session")
      .filter({ hasText: title })
      .getByText("finished", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty(
    "scrollWidth",
    await page.locator("body").evaluate((e) => e.clientWidth),
  );
  const geometry = await companion.boundingBox();
  if (info.project.name === "mobile") {
    const nav =
      (await page
        .getByRole("navigation", { name: "Mobile navigation" })
        .boundingBox()
        .catch(() => null)) ??
      (await page.locator(".bottom-nav").boundingBox());
    expect(geometry!.y + geometry!.height).toBeLessThanOrEqual(nav!.y);
  }
  await page.screenshot({
    path: `artifacts/${info.project.name}-live-study-companion.png`,
    fullPage: true,
  });
  await page.goto("/");
  const current = await companion
    .locator(".companion-toggle strong")
    .innerText();
  await expect(page.getByTestId("canonical-focus")).toContainText(current);
});

test("a saved failed or guided attempt completes practice; unverified drafts do not", async ({
  page,
  store,
}, info) => {
  await page.clock.install({ time: instant });
  // Monaco needs a real measurement entry under the deterministic browser clock.
  await page.addInitScript(() => {
    const measure = performance.measure.bind(performance);
    performance.measure = ((
      name: string,
      options?: PerformanceMeasureOptions,
    ) => {
      try {
        return measure(name, options);
      } catch {
        return {
          name,
          entryType: "measure",
          startTime: 0,
          duration: 0,
          toJSON: () => ({}),
        } as PerformanceMeasure;
      }
    }) as typeof performance.measure;
  });
  store.problems.push(problem);
  store.planner.config = {
    ...defaultPlannerConfig(),
    timezone: "UTC",
    weekly: Array.from({ length: 7 }, () => [{ start: "08:00", end: "11:00" }]),
  };
  await page.goto("/coding");
  const companion = page.getByRole("complementary", {
    name: "Live study companion",
  });
  await expect(companion).toBeVisible();
  await companion.locator(".companion-toggle").click();
  await companion.getByRole("button", { name: "Start", exact: true }).click();
  await expect(
    companion.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  const key = store.planner.days[0].items.find((i) => i.live)!.key;
  await companion.getByRole("link", { name: "Open task", exact: true }).click();
  await page.getByRole("tab", { name: "Reflection", exact: true }).click();
  await page
    .getByLabel("Personal notes")
    .fill("Reviewed edge cases; not classified yet.");
  await page.getByRole("button", { name: "Save attempt", exact: true }).click();
  await expect(
    page.getByText("Attempt saved. Correctness remains self-reported."),
  ).toBeVisible();
  expect(store.planner.days[0].items.find((i) => i.key === key)?.status).toBe(
    "planned",
  );
  await page.getByLabel("Assistance used").selectOption("guided");
  await page.getByLabel("Number of hints").fill("2");
  await page
    .getByLabel("Result (self-reported)")
    .selectOption(info.project.name === "mobile" ? "failed" : "passed");
  await page.getByRole("button", { name: "Save attempt", exact: true }).click();
  await expect
    .poll(() => store.planner.days[0].items.find((i) => i.key === key)?.status)
    .toBe("completed");
  expect(store.attempts).toHaveLength(1);
  expect(
    store.planner.days[0].items.find((i) => i.key === key)?.live?.assistance,
  ).toBe("guided");
  await expect(companion).toContainText("Take a break");
  await page.screenshot({
    path: `artifacts/${info.project.name}-live-study-ide.png`,
    fullPage: true,
  });
});

test("tabs share one timer and reopening a closed app restores paused time", async ({
  page,
  context,
  store,
}) => {
  await page.clock.install({ time: instant });
  store.problems.push(problem);
  store.planner.config = {
    ...defaultPlannerConfig(),
    timezone: "UTC",
    weekly: Array.from({ length: 7 }, () => [{ start: "08:00", end: "11:00" }]),
  };
  await page.goto("/");
  const first = page.getByRole("complementary", {
    name: "Live study companion",
  });
  await expect(first).toBeVisible();
  await first.locator(".companion-toggle").click();
  await first.getByRole("button", { name: "Start", exact: true }).click();
  await expect(
    first.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  const key = store.planner.days[0].items.find((i) => i.live)!.key;
  const other = await context.newPage();
  await other.clock.install({ time: instant });
  await other.goto("/plan");
  const second = other.getByRole("complementary", {
    name: "Live study companion",
  });
  await expect(second).toContainText("Two Sum");
  await second.locator(".companion-toggle").click();
  await expect(
    second.getByText("Running in another tab.", { exact: false }),
  ).toBeVisible();
  await second.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(
    first.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  await second.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(
    second.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  const elapsed = store.planner.days[0].items.find((i) => i.key === key)!.live!
    .elapsed_seconds;
  await other.close();
  await page.close();
  const reopened = await context.newPage();
  await reopened.clock.install({ time: new Date("2026-10-19T09:00:00Z") });
  await reopened.goto("/");
  const restored = reopened.getByRole("complementary", {
    name: "Live study companion",
  });
  await expect(restored).toContainText("Two Sum");
  await restored.locator(".companion-toggle").click();
  await expect(
    restored.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  expect(
    store.planner.days[0].items.find((i) => i.key === key)!.live!
      .elapsed_seconds,
  ).toBe(elapsed);
  await restored.getByRole("button", { name: "Skip", exact: true }).click();
  await expect
    .poll(() => store.planner.days[0].items.find((i) => i.key === key)?.status)
    .toBe("skipped");
  await reopened.close();
});

test("break countdown pauses and only a genuinely elapsed break progresses automatically", async ({
  page,
  store,
}) => {
  await page.clock.install({ time: instant });
  const config = {
    ...defaultPlannerConfig(),
    timezone: "UTC",
    weekly: Array.from({ length: 7 }, () => [{ start: "08:00", end: "11:00" }]),
  };
  store.planner.config = config;
  const days = generateAdaptiveWeek(
    emptyData,
    config,
    [],
    instant.toISOString(),
  );
  const rest = {
    ...days[0].items[0],
    key: "2026-10-19:rest:fixture",
    title: "Take a break",
    category: "break" as const,
    start: instant.toISOString(),
    end: "2026-10-19T08:05:00.000Z",
    minutes: 5,
    pinned: true,
  };
  store.planner.days = days.map((p, i) => ({
    ...p,
    items: i === 0 ? [rest] : [],
    sourceRevision: 0,
    studyMinutes: 0,
  }));
  await page.goto("/");
  const companion = page.getByRole("complementary", {
    name: "Live study companion",
  });
  await expect(companion).toContainText("5:00");
  await companion.locator(".companion-toggle").click();
  await page.clock.runFor(10000);
  expect(store.planner.days[0].items[0].status).toBe("planned");
  await companion.getByRole("button", { name: "Start", exact: true }).click();
  await expect(
    companion.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  for (let n = 0; n < 2; n++) {
    await page.clock.runFor(5000);
    await expect
      .poll(
        () =>
          store.planner.days[0].items.find((i) => i.key === rest.key)!.live!
            .elapsed_seconds,
      )
      .toBeGreaterThanOrEqual((n + 1) * 5);
  }
  await companion.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(
    companion.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  const paused = store.planner.days[0].items.find((i) => i.key === rest.key)!
    .live!.elapsed_seconds;
  await page.clock.runFor(60000);
  expect(
    store.planner.days[0].items.find((i) => i.key === rest.key)!.live!
      .elapsed_seconds,
  ).toBe(paused);
  await companion.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(
    companion.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(
    companion.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  const hiddenSeconds = store.planner.days[0].items.find(
    (i) => i.key === rest.key,
  )!.live!.elapsed_seconds;
  await page.clock.runFor(60000);
  expect(
    store.planner.days[0].items.find((i) => i.key === rest.key)!.live!
      .elapsed_seconds,
  ).toBe(hiddenSeconds);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await companion.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(
    companion.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  // Shorten the remaining fixture time; the real UI still needs acknowledged
  // heartbeats and must make its own automatic break_elapsed request.
  store.planner.days[0].items.find(
    (i) => i.key === rest.key,
  )!.live!.elapsed_seconds = 295;
  await page.clock.runFor(5000);
  await expect
    .poll(
      () =>
        store.planner.days[0].items.find((i) => i.key === rest.key)!.live!
          .elapsed_seconds,
    )
    .toBeGreaterThan(295);
  await page.clock.runFor(6000);
  await expect
    .poll(
      () => store.planner.days[0].items.find((i) => i.key === rest.key)?.status,
    )
    .toBe("completed");
  expect(store.attempts).toHaveLength(0);
});
