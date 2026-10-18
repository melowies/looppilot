import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { defaultPlannerConfig } from "../src/lib/adaptive-types";

const now = new Date("2026-10-19T08:00:00Z");
const editButton = (page: Page) =>
  page.getByRole("button", { name: "Edit availability", exact: true }).first();
const saveButton = (page: Page) =>
  page.getByRole("button", { name: "Save availability", exact: true });
const tab = (page: Page, name: string) =>
  page.getByRole("tab", { name, exact: true });

async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const dialog = page.getByRole("dialog");
  if (await dialog.isVisible()) {
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    expect(
      await dialog
        .locator(".planner-settings-scroll")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    const covered = await dialog.evaluate((el) =>
      [
        ...el.querySelectorAll(
          '.dialog-header h2, [role="tab"], .planner-settings-footer button',
        ),
      ]
        .filter((n) => {
          const r = n.getBoundingClientRect();
          const hit = document.elementFromPoint(
            r.x + r.width / 2,
            r.y + r.height / 2,
          );
          return n !== hit && !n.contains(hit);
        })
        .map((n) => n.textContent),
    );
    expect(covered).toEqual([]);
  }
}

async function readableControls(dialog: Locator) {
  const result = await dialog.evaluate((el) => {
    const issues: string[] = [];
    const scroll = el
      .querySelector(".planner-settings-scroll")!
      .getBoundingClientRect();
    for (const control of el.querySelectorAll<HTMLElement>(
      "input, select, button",
    )) {
      if (!control.getClientRects().length) continue;
      const r = control.getBoundingClientRect();
      const boundary = control.closest(".planner-settings-scroll")
        ? scroll
        : el.getBoundingClientRect();
      if (r.left < boundary.left - 1 || r.right > boundary.right + 1)
        issues.push(
          `clipped: ${control.getAttribute("aria-label") ?? control.textContent}`,
        );
      if (r.width < 32 || r.height < 32) {
        if (!(
          control instanceof HTMLInputElement && control.type === "checkbox"
        ))
          issues.push("small control");
      }
      const field = control.closest(".field"),
        label = field?.querySelector("span");
      if (label && r.top - label.getBoundingClientRect().bottom < 7)
        issues.push("label touches input");
    }
    return issues;
  });
  expect(result).toEqual([]);
}

test("planner screenshots, honest calendar labels, and separated empty actions", async ({
  page,
  store,
}, testInfo) => {
  await page.clock.install({ time: now });
  await page.goto("/plan");
  await expect(editButton(page)).toBeEnabled();
  await page.evaluate(() => document.fonts.ready);
  const empty = page.locator(".planner-schedule .empty");
  const description = await empty.locator("p").boundingBox();
  const action = await empty
    .getByRole("button", { name: "Edit availability" })
    .boundingBox();
  expect(
    action!.y - (description!.y + description!.height),
  ).toBeGreaterThanOrEqual(16);
  await noOverflow(page);
  await page.screenshot({
    path: `artifacts/planner-ux/after-${testInfo.project.name}-empty.png`,
    fullPage: true,
  });
  await editButton(page).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await readableControls(dialog);
  await noOverflow(page);
  await page.screenshot({
    path: `artifacts/planner-ux/after-${testInfo.project.name}-availability.png`,
  });
  const footer = dialog.locator(".planner-settings-footer");
  const before = await footer.boundingBox();
  const scroller = dialog.locator(".planner-settings-scroll");
  await scroller.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  const after = await footer.boundingBox();
  expect(Math.abs(before!.y - after!.y)).toBeLessThan(1);
  await expect(saveButton(page)).toBeInViewport();
  await expect(
    dialog.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeInViewport();
  await expect(tab(page, "Study schedule")).toBeInViewport();
  const sunday = dialog.getByRole("group", { name: "Sunday", exact: true });
  await expect(sunday).toBeInViewport();
  const unavailable = await sunday
    .getByText("Unavailable", { exact: true })
    .boundingBox();
  const add = await sunday
    .getByRole("button", { name: "Add time window" })
    .boundingBox();
  expect(
    add!.y - (unavailable!.y + unavailable!.height),
  ).toBeGreaterThanOrEqual(10);
  await page.screenshot({
    path: `artifacts/planner-ux/after-${testInfo.project.name}-availability-bottom.png`,
  });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  store.planner.config = {
    ...defaultPlannerConfig(),
    weekly: [
      [],
      [{ start: "18:00", end: "20:00" }],
      [],
      [{ start: "18:00", end: "18:45" }],
      [{ start: "18:00", end: "22:00" }],
      [],
      [],
    ],
  };
  store.planner.revision++;
  await page.reload();
  await expect(
    page.getByRole("heading", { name: /Baseline assessment:/ }),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const monday = page.locator(".planner-week-day").filter({ hasText: "Mon" });
  await expect(monday).toContainText("120 min available");
  await expect(monday).toContainText("70 min planned");
  await expect(monday).toContainText("70 min remaining");
  await expect(
    page.locator(".planner-week-day").filter({ hasText: "Tue" }),
  ).toContainText("No availability");
  await expect(
    page.locator(".planner-week-day").filter({ hasText: "Thu" }),
  ).toContainText("240 min available");
  await expect(
    page.getByRole("heading", { name: "Today's priorities", exact: true }),
  ).toBeVisible();
  await noOverflow(page);
  await page.screenshot({
    path: `artifacts/planner-ux/after-${testInfo.project.name}-plan.png`,
    fullPage: true,
  });
  const baseline = page
    .locator(".planner-session")
    .filter({ hasText: "Baseline assessment" });
  await baseline.getByRole("button", { name: "Complete", exact: true }).click();
  await expect(monday).toContainText("1 completed");
  await expect(monday).toContainText("25 min remaining");
  await expect(baseline).toHaveClass(/planner-session-completed/);
  expect(store.attempts).toHaveLength(0);
  for (const detail of await page.locator(".planner-reasoning summary").all())
    await detail.click();
  for (const explanation of store.planner.days.find(
    (d) => d.day === "2026-10-19",
  )!.explanation) {
    await expect(
      page
        .locator(".planner-reasoning")
        .getByText(explanation, { exact: true }),
    ).toBeVisible();
  }
  await noOverflow(page);
  await page.screenshot({
    path: `artifacts/planner-ux/after-${testInfo.project.name}-completed.png`,
    fullPage: true,
  });
  await page.locator(".planner-week-day").filter({ hasText: "Tue" }).click();
  await expect(
    page.getByRole("heading", { name: "No sessions scheduled" }),
  ).toBeVisible();
});

test("all five settings sections preserve drafts, save, reopen, remove, and cancel", async ({
  page,
  store,
}, testInfo) => {
  await page.clock.install({ time: now });
  await page.goto("/plan");
  await expect(editButton(page)).toBeEnabled();
  await editButton(page).click();
  const dialog = page.getByRole("dialog");
  await page.evaluate(() => document.fonts.ready);
  const monday = dialog.getByRole("group", { name: "Monday", exact: true });
  await monday.getByRole("button", { name: "Add time window" }).click();
  await dialog.getByLabel("Monday start 1", { exact: true }).fill("18:30");
  await dialog
    .getByLabel("Daily study limit (hours)", { exact: true })
    .fill("3");
  await tab(page, "Interview rounds").click();
  await dialog
    .getByLabel("Interview timezone", { exact: true })
    .fill("Europe/London");
  await dialog
    .getByRole("button", { name: "Add interview round", exact: true })
    .click();
  await dialog
    .getByLabel("Round 1 title", { exact: true })
    .fill("Technical interview");
  await dialog
    .getByLabel("Round 1 format", { exact: true })
    .selectOption("coding");
  await dialog.getByLabel("Round 1 date", { exact: true }).fill("2026-11-25");
  await dialog.getByLabel("Round 1 time", { exact: true }).fill("13:00");
  await dialog
    .getByLabel("Round 1 duration minutes", { exact: true })
    .fill("45");
  await readableControls(dialog);
  await noOverflow(page);
  await page.screenshot({
    path: `artifacts/planner-ux/after-${testInfo.project.name}-interviews.png`,
  });
  await tab(page, "Days off & exceptions").click();
  await dialog
    .getByRole("button", { name: "Add date override", exact: true })
    .click();
  await dialog
    .getByLabel("Override 1 date", { exact: true })
    .fill("2026-10-21");
  await dialog
    .getByLabel("Unavailable start", { exact: true })
    .fill("2026-10-22T10:00");
  await dialog
    .getByLabel("Unavailable end", { exact: true })
    .fill("2026-10-22T11:00");
  await dialog
    .getByRole("button", { name: "Add unavailable period", exact: true })
    .click();
  await readableControls(dialog);
  await noOverflow(page);
  await tab(page, "Advanced settings").click();
  await dialog
    .getByLabel("Maximum session minutes", { exact: true })
    .fill("40");
  await dialog.getByLabel("Break minutes", { exact: true }).fill("15");
  await dialog.getByLabel("Begin focused practice", { exact: true }).fill("25");
  await readableControls(dialog);
  await tab(page, "AI coaching").click();
  const consent = dialog.getByRole("checkbox");
  await expect(consent).not.toBeChecked();
  await consent.check();
  await tab(page, "Study schedule").click();
  await expect(
    dialog.getByLabel("Monday start 1", { exact: true }),
  ).toHaveValue("18:30");
  await tab(page, "AI coaching").click();
  await expect(consent).toBeChecked();
  await consent.uncheck(); // Never send a live coaching request.
  await saveButton(page).click();
  await expect(dialog).not.toBeVisible();
  expect(store.planner.config.dailyMinutes).toBe(180);
  expect(store.planner.config.rounds?.[0]).toMatchObject({
    title: "Technical interview",
    format: "coding",
    date: "2026-11-25",
    time: "13:00",
    duration: 45,
  });
  expect(store.planner.config.overrides).toEqual([
    { date: "2026-10-21", windows: [] },
  ]);
  expect(store.planner.config.unavailable).toHaveLength(1);
  expect(store.planner.config.sessionMinutes).toBe(40);
  expect(store.planner.config.breakMinutes).toBe(15);
  expect(store.planner.config.phaseDays?.foundations).toBe(25);
  const saved = structuredClone(store.planner.config);
  await editButton(page).click();
  await dialog
    .getByLabel("Daily study limit (hours)", { exact: true })
    .fill("1");
  await monday.getByRole("button", { name: "Remove Monday window 1" }).click();
  await tab(page, "Interview rounds").click();
  await expect(dialog.getByLabel("Round 1 title", { exact: true })).toHaveValue(
    "Technical interview",
  );
  await dialog
    .getByRole("button", { name: "Remove round 1", exact: true })
    .click();
  await tab(page, "Days off & exceptions").click();
  await dialog
    .getByRole("button", { name: "Remove override", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Remove period 1", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(store.planner.config).toEqual(saved);
  await expect(editButton(page)).toBeFocused();
  await editButton(page).click();
  await expect(
    dialog.getByLabel("Daily study limit (hours)", { exact: true }),
  ).toHaveValue("3");
  await expect(
    dialog.getByLabel("Monday start 1", { exact: true }),
  ).toHaveValue("18:30");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await noOverflow(page);
});

test("keyboard tabs, hidden-field validation, and save failures stay accessible", async ({
  page,
  store,
}, testInfo) => {
  await page.clock.install({ time: now });
  await page.goto("/plan");
  await expect(editButton(page)).toBeEnabled();
  await editButton(page).click();
  const dialog = page.getByRole("dialog");
  await tab(page, "Study schedule").focus();
  await page.keyboard.press("ArrowRight");
  await expect(tab(page, "Interview rounds")).toBeFocused();
  await page.keyboard.press("End");
  await expect(tab(page, "AI coaching")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("Home");
  await expect(tab(page, "Study schedule")).toBeFocused();
  await tab(page, "Interview rounds").click();
  await dialog
    .getByRole("button", { name: "Add interview round", exact: true })
    .click();
  await tab(page, "Advanced settings").click();
  await saveButton(page).click();
  await expect(tab(page, "Interview rounds")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    dialog.getByLabel("Round 1 date", { exact: true }),
  ).toBeFocused();
  await dialog
    .getByRole("button", { name: "Remove round 1", exact: true })
    .click();
  await tab(page, "Study schedule").click();
  await dialog
    .getByLabel("Study timezone", { exact: true })
    .fill("Invalid/Timezone");
  await tab(page, "AI coaching").click();
  await saveButton(page).click();
  await expect(tab(page, "Study schedule")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(dialog.getByRole("alert")).toContainText("Use an IANA timezone");
  await dialog
    .getByLabel("Study timezone", { exact: true })
    .fill("Europe/Istanbul");
  await page.route("**/rest/v1/rpc/save_planner_config", (route) =>
    route.fulfill({
      status: 500,
      json: { message: "Availability save failed. Please retry." },
    }),
  );
  await saveButton(page).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Availability save failed",
  );
  await expect(dialog).toBeVisible();
  await expect(saveButton(page)).toBeInViewport();
  await saveButton(page).focus();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "Close dialog" }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(saveButton(page)).toBeFocused();
  await noOverflow(page);
  await page.screenshot({
    path: `artifacts/planner-ux/after-${testInfo.project.name}-save-error.png`,
  });
  await page.unroute("**/rest/v1/rpc/save_planner_config");
  await saveButton(page).click();
  await expect(dialog).not.toBeVisible();
  expect(store.planner.config.timezone).toBe("Europe/Istanbul");
});
