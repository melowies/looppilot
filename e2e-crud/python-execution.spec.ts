import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const problem = {
  id: "22222222-2222-4222-8222-222222222222",
  title: "Number of Islands",
  leetcode_id: 200,
  url: "https://leetcode.com/problems/number-of-islands/",
  difficulty: "Medium",
  pattern: "Graphs",
  created_at: "2026-10-17T00:00:00Z",
};
const solution = `from typing import List
class Solution:
    def numIslands(self, grid: List[List[str]]) -> int:
        count = 0
        for r in range(len(grid)):
            for c in range(len(grid[0])):
                if grid[r][c] != "1":
                    continue
                count += 1
                stack = [(r, c)]
                grid[r][c] = "0"
                while stack:
                    x, y = stack.pop()
                    for a, b in [(x-1,y),(x+1,y),(x,y-1),(x,y+1)]:
                        if 0 <= a < len(grid) and 0 <= b < len(grid[0]) and grid[a][b] == "1":
                            grid[a][b] = "0"
                            stack.append((a,b))
        print("executed numIslands")
        return count`;

async function writeCode(page: Page, code: string) {
  if (await page.getByRole("tab", { name: "Code", exact: true }).isVisible())
    await page.getByRole("tab", { name: "Code", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Solution code" });
  await expect(editor).toBeVisible();
  await editor.focus();
  await page.keyboard.press("Control+a");
  // Exercise the browser clipboard and Monaco paste handling (typing a multiline
  // string would add automatic indentation on top of its supplied indentation).
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate((text) => navigator.clipboard.writeText(text), code);
  await page.keyboard.press("Control+v");
}
async function run(page: Page) {
  await page.getByRole("button", { name: "Run Code", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Run Code", exact: true }),
  ).toBeEnabled({ timeout: 45000 });
}

test("real Python: unsaved code, actual outputs, errors, timeout, save and reopen", async ({
  page,
  store,
}, info) => {
  test.setTimeout(180000);
  store.problems.push(problem);
  await page.goto(`/coding/${problem.id}/practice`);
  await expect(page.getByLabel("Active practice duration")).toHaveText("00:00");
  await expect(
    page.getByRole("button", { name: "Run Code", exact: true }),
  ).toBeEnabled();
  await writeCode(page, solution);
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await run(page);
  await expect(
    page.locator(".practice-tests strong").filter({ hasText: /^Passed$/ }),
  ).toHaveCount(2);
  expect(store.attempts).toHaveLength(0);
  const results = page.locator(".practice-tests .practice-case");
  await expect(results.nth(0).locator("pre")).toHaveText(["1", "1"]);
  await expect(results.nth(1).locator("pre")).toHaveText(["3", "3"]);
  await page.getByRole("tab", { name: "Console", exact: true }).click();
  await expect(page.getByLabel("Standard output")).toContainText(
    "executed numIslands",
  );
  await page.getByRole("tab", { name: "Test Cases", exact: true }).click();
  await page.getByRole("button", { name: "Add test case" }).click();
  await page.getByLabel("Input 3", { exact: true }).fill('{"grid":[["0"]]}');
  await page.getByLabel("Expected output 3", { exact: true }).fill("0");
  await run(page);
  await expect(
    page.locator(".practice-tests strong").filter({ hasText: /^Passed$/ }),
  ).toHaveCount(3);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const frozen = await page
    .getByLabel("Active practice duration")
    .textContent();
  await page.getByRole("button", { name: "Save attempt", exact: true }).click();
  await expect(
    page.getByText("Attempt saved. Correctness remains self-reported."),
  ).toBeVisible();
  expect(store.attempts).toHaveLength(1);
  expect(store.attempts[0]).toMatchObject({
    correctness: "unverified",
    solution,
  });
  const data = JSON.parse(String(store.attempts[0].test_results));
  expect(data.timing.seconds).toBeGreaterThan(0);
  expect(store.attempts[0].duration_minutes).toBe(
    Math.ceil(data.timing.seconds / 60),
  );
  expect(data.cases).toHaveLength(3);
  await page.reload();
  await expect(page.getByLabel("Active practice duration")).toHaveText(frozen!);
  if (info.project.name === "mobile")
    await page.getByRole("tab", { name: "Code", exact: true }).click();
  await expect(page.locator(".monaco-editor .view-lines")).toContainText(
    "class Solution",
  );
  await expect(
    page.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  await run(page);
  await expect(
    page.locator(".practice-tests strong").filter({ hasText: /^Passed$/ }),
  ).toHaveCount(3);

  await writeCode(
    page,
    "class Solution:\n    def numIslands(self, grid):\n        return 99",
  );
  await run(page);
  await expect(
    page
      .locator(".practice-tests strong")
      .filter({ hasText: /^Wrong Answer$/ }),
  ).toHaveCount(3);
  await writeCode(
    page,
    "class Solution:\n    def numIslands(self, grid):\n        raise ValueError('test failure')",
  );
  await run(page);
  await expect(
    page
      .locator(".practice-tests strong")
      .filter({ hasText: /^Runtime Error$/ }),
  ).toHaveCount(3);
  await expect(page.getByRole("alert").first()).toContainText("test failure");
  await writeCode(
    page,
    "class Solution:\n    def numIslands(self, grid):\n        while True: pass",
  );
  await run(page);
  await expect(
    page
      .locator(".practice-tests strong")
      .filter({ hasText: /^Time Limit Exceeded$/ }),
  ).toHaveCount(3);

  // Loading failure uses the real runner path; neither code nor custom cases is replaced.
  await page.route("**/python/pyodide.asm.wasm", (route) => route.abort());
  await writeCode(page, solution);
  await run(page);
  await expect(page.locator(".coding-practice > .alert.error")).toContainText(
    /runtime.*preserved/i,
  );
  await page.unroute("**/python/pyodide.asm.wasm");
  await run(page);
  await expect(
    page.locator(".practice-tests strong").filter({ hasText: /^Passed$/ }),
  ).toHaveCount(3);
  await page.screenshot({
    path: `artifacts/${info.project.name}-python-execution.png`,
    fullPage: true,
  });
  expect(store.attempts).toHaveLength(1);
  expect(store.attempts[0].solution).toBe(solution);
  await writeCode(
    page,
    "class Solution:\n    def numIslands(self, grid):\n        while True: pass",
  );
  await page.getByRole("button", { name: "Run Code", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Stop execution", exact: true }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "New attempt", exact: true }).click();
  await expect(page.getByLabel("Active practice duration")).toHaveText("00:00");
  await expect(
    page.getByRole("button", { name: "Run Code", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".coding-practice > .alert.error")).toHaveCount(0);
});

test("timer: editing, pause/resume, hidden, idle, refresh and separate attempts", async ({
  page,
  store,
}, info) => {
  store.problems.push(problem);
  await page.goto(`/coding/${problem.id}/practice`);
  await expect(page.getByLabel("Active practice duration")).toHaveText("00:00");
  await expect(
    page.getByRole("textbox", { name: "Solution code" }),
  ).toBeVisible();
  await page.clock.install();
  // Leave headroom between the host timestamp and browser clock installation.
  // Using the host's immediate `new Date()` can already be in the browser's past.
  await page.clock.pauseAt(new Date(Date.now() + 10000));
  const fixMeasures = () => {
    // Playwright's clock stubs Performance measures; Monaco reads their duration.
    const entries = performance.getEntriesByName.bind(performance);
    performance.getEntriesByName = (name, type) =>
      entries(name, type).length
        ? entries(name, type)
        : [{ duration: 0 } as PerformanceEntry];
  };
  await page.addInitScript(fixMeasures);
  await page.evaluate(fixMeasures);
  await writeCode(page, solution);
  await page.clock.runFor(61000);
  await expect(page.getByLabel("Active practice duration")).toHaveText("01:01");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.clock.runFor(20000);
  await expect(page.getByLabel("Active practice duration")).toHaveText("01:01");
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page.clock.runFor(1000);
  await expect(page.getByLabel("Active practice duration")).toHaveText("01:02");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.runFor(30000);
  await expect(page.getByLabel("Active practice duration")).toHaveText("01:02");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page.clock.runFor(301000);
  await expect(page.getByLabel("Active practice duration")).toHaveText("06:02");
  await expect(page.getByLabel("Practice timer")).toContainText("inactive");
  page.once("dialog", (d) => d.accept());
  await page.reload();
  await expect(page.getByLabel("Active practice duration")).toHaveText("06:02");
  await expect(
    page.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save attempt", exact: true }).click();
  await expect(
    page.getByText("No unsaved changes", { exact: true }),
  ).toBeVisible();
  expect(store.attempts[0].duration_minutes).toBe(7);
  expect(store.attempts[0].solution).toBe(solution);
  await page.getByRole("button", { name: "New attempt", exact: true }).click();
  await expect(page.getByLabel("Active practice duration")).toHaveText("00:00");
  await page
    .getByLabel("Attempt", { exact: true })
    .selectOption(String(store.attempts[0].id));
  await expect(page.getByLabel("Active practice duration")).toHaveText("06:02");
  await page.clock.runFor(10000);
  await expect(page.getByLabel("Active practice duration")).toHaveText("06:02");
  expect(store.attempts[0].duration_minutes).toBe(7);
  await page.getByRole("button", { name: "New attempt", exact: true }).click();
  await page.getByRole("button", { name: "Run Code", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Stop execution", exact: true })
    .click();
  await page.screenshot({
    path: `artifacts/${info.project.name}-practice-timer.png`,
    fullPage: true,
  });
  expect(info.project.name).toBeTruthy();
});

test("historical recorded minutes remain unchanged after viewing, running and saving", async ({
  page,
  store,
}) => {
  store.problems.push(problem);
  store.attempts.push({
    id: "33333333-3333-4333-8333-333333333333",
    problem_id: problem.id,
    attempted_on: "2025-04-02",
    duration_minutes: 42,
    language: "Python",
    solution,
    difficulty: "Medium",
    pattern: "Graphs",
    assistance: "hinted",
    hints: 1,
    correctness: "partial",
    test_results: "Historical manual evidence",
    time_complexity: "O(m*n)",
    space_complexity: "O(m*n)",
    confidence: 2,
    notes: "Historical",
  });
  await page.goto(`/coding/${problem.id}/practice`);
  await page
    .getByLabel("Attempt", { exact: true })
    .selectOption(String(store.attempts[0].id));
  await expect(page.getByLabel("Active practice duration")).toHaveText(
    "42 min",
  );
  await run(page);
  await expect(
    page.locator(".practice-tests strong").filter({ hasText: /^Passed$/ }),
  ).toHaveCount(2);
  await expect(page.getByLabel("Active practice duration")).toHaveText(
    "42 min",
  );
  await page.getByRole("button", { name: "Save attempt", exact: true }).click();
  await expect(
    page.getByText("Attempt saved. Correctness remains self-reported."),
  ).toBeVisible();
  expect(store.attempts[0]).toMatchObject({
    duration_minutes: 42,
    attempted_on: "2025-04-02",
    correctness: "partial",
    assistance: "hinted",
  });
  // Running default samples must not add cases or rewrite legacy evidence.
  expect(store.attempts[0].test_results).toBe("Historical manual evidence");
});
