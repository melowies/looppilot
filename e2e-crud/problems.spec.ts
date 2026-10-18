import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";
async function openProblem(page: Page) {
  await page.goto("/coding");
  await page
    .getByRole("button", { name: "Add problem", exact: true })
    .first()
    .click();
  return page.getByRole("dialog", { name: "Add a problem", exact: true });
}
async function centered(page: Page) {
  const box = await page.getByRole("dialog").boundingBox();
  expect(box).not.toBeNull();
  const viewport = page.viewportSize()!;
  expect(Math.abs(box!.x + box!.width / 2 - viewport.width / 2)).toBeLessThan(
    3,
  );
  expect(Math.abs(box!.y + box!.height / 2 - viewport.height / 2)).toBeLessThan(
    3,
  );
  expect(box!.width).toBeLessThanOrEqual(viewport.width - 24);
  expect(box!.height).toBeLessThanOrEqual(viewport.height);
}
test("number-only lookup populates all known examples, allows overrides, and creates no attempt", async ({
  page,
  store,
}) => {
  const dialog = await openProblem(page);
  for (const [number, title, difficulty] of [
    ["1", "Two Sum", "Easy"],
    ["3", "Longest Substring Without Repeating Characters", "Medium"],
    ["128", "Longest Consecutive Sequence", "Medium"],
    ["200", "Number of Islands", "Medium"],
    ["875", "Koko Eating Bananas", "Medium"],
  ]) {
    await dialog.getByLabel("LeetCode problem number").fill(number);
    await expect(
      dialog.getByRole("button", { name: "Save problem", exact: true }),
    ).toBeDisabled();
    await expect(dialog.getByLabel("Problem title")).toHaveValue(title);
    await expect(dialog.getByLabel("Difficulty", { exact: true })).toHaveValue(
      difficulty,
    );
  }
  await expect(dialog.getByLabel("Pattern", { exact: true })).toHaveValue(
    "Binary search",
  );
  await dialog.getByLabel("LeetCode problem number").fill("128");
  await expect(dialog.getByLabel("Problem title")).toHaveValue(
    "Longest Consecutive Sequence",
  );
  await expect(dialog.getByLabel("Pattern", { exact: true })).toHaveValue("");
  await dialog
    .getByLabel("Pattern", { exact: true })
    .selectOption("Arrays & hashing");
  await dialog
    .getByLabel("Problem title")
    .fill("Longest Consecutive Sequence — review");
  await dialog
    .getByRole("button", { name: "Save problem", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  expect(store.problems).toHaveLength(1);
  expect(store.problems[0].leetcode_id).toBe(128);
  expect(store.problems[0].title).toBe("Longest Consecutive Sequence — review");
  expect(store.problems[0].topic_tags).toContain("Hash Table");
  expect(store.attemptWrites).toBe(0);
});
test("unknown IDs and network failures retain manual entry", async ({
  page,
  store,
}) => {
  const dialog = await openProblem(page);
  await dialog.getByLabel("LeetCode problem number").fill("999999");
  await expect(
    dialog.getByText("That number is not in the current catalog.", {
      exact: false,
    }),
  ).toBeVisible();
  await page.route("**/api/leetcode?number=200", (route) =>
    route.abort("failed"),
  );
  await dialog.getByLabel("LeetCode problem number").fill("200");
  await expect(
    dialog.getByText("Lookup is unavailable.", { exact: false }),
  ).toBeVisible();
  await dialog.getByLabel("Problem title").fill("Number of Islands");
  await dialog
    .getByLabel("Problem URL")
    .fill("https://leetcode.com/problems/number-of-islands/");
  await dialog.getByLabel("Pattern", { exact: true }).selectOption("Graphs");
  await dialog
    .getByRole("button", { name: "Save problem", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  expect(store.problems).toHaveLength(1);
  expect(store.attemptWrites).toBe(0);
  const invalid = await page.request.get("/api/leetcode?number=-1");
  expect(invalid.status()).toBe(400);
  const unknown = await page.request.get("/api/leetcode?number=999999");
  expect(unknown.status()).toBe(404);
});
test("legacy URLs and database duplicate errors keep the dialog open", async ({
  page,
  store,
}) => {
  store.problems.push({
    id: crypto.randomUUID(),
    title: "Existing Islands",
    url: "https://leetcode.com/problems/number-of-islands/description/",
    difficulty: "Medium",
    pattern: "Graphs",
    created_at: "2026-10-17",
    leetcode_id: null,
  });
  const dialog = await openProblem(page);
  await dialog.getByLabel("LeetCode problem number").fill("200");
  await expect(dialog.getByLabel("Problem title")).toHaveValue(
    "Number of Islands",
  );
  await expect(
    dialog.getByText("Already in your library:", { exact: false }).first(),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Save problem", exact: true })
    .click();
  await expect(dialog).toBeVisible();
  expect(store.problems).toHaveLength(1);
  await dialog.getByLabel("LeetCode problem number").fill("1");
  await expect(dialog.getByLabel("Problem title")).toHaveValue("Two Sum");
  store.rejectNext = true;
  await dialog
    .getByRole("button", { name: "Save problem", exact: true })
    .click();
  await expect(
    dialog.getByText("This LeetCode problem is already in your library.", {
      exact: false,
    }),
  ).toBeVisible();
  expect(store.problems).toHaveLength(1);
});
test("shared dialogs center on scroll and resize, trap focus, lock scrolling and restore focus", async ({
  page,
  store,
}, testInfo) => {
  void store;
  await page.goto("/coding");
  const opener = page
    .getByRole("button", { name: "Add problem", exact: true })
    .first();
  await expect(opener).toBeEnabled();
  // Font swaps can shift the scroll anchor before the dialog captures it.
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.evaluate(() => {
    document.body.style.minHeight = "2400px";
    window.scrollTo(0, 450);
  });
  await opener.evaluate((el) => {
    if (el instanceof HTMLElement) {
      el.focus({ preventScroll: true });
      el.click();
    }
  });
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await centered(page);
  expect(
    await dialog.evaluate((el) => el.parentElement === document.body),
  ).toBe(true);
  expect(await page.evaluate(() => document.body.style.position)).toBe("fixed");
  await page.mouse.wheel(0, 700);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.setViewportSize(
    testInfo.project.name === "mobile"
      ? { width: 375, height: 667 }
      : { width: 1100, height: 760 },
  );
  await centered(page);
  for (let i = 0; i < 8; i++) await page.keyboard.press("Tab");
  expect(
    await dialog.evaluate((el) => el.contains(document.activeElement)),
  ).toBe(true);
  await page.screenshot({
    path: `artifacts/${testInfo.project.name}-add-problem.png`,
  });
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(opener).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(450);
  await page.goto("/stories");
  const addStory = page.getByRole("button", { name: "Add story", exact: true });
  await addStory.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await centered(page);
  expect(
    await page
      .getByRole("dialog")
      .evaluate((el) => el.scrollHeight > el.clientHeight),
  ).toBe(true);
  await page.getByRole("dialog").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(
    page.getByRole("button", { name: "Save story", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(addStory).toBeFocused();
});
