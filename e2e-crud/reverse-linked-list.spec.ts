import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import { defaultPlannerConfig } from "../src/lib/adaptive-types";
import { newAttempt, serializeEvidence } from "../src/lib/coding-workspace";
import type { Problem } from "../src/lib/domain";

const instant = new Date("2026-10-19T08:00:00Z");
const problem: Problem = {
  id: "66666666-6666-4666-8666-666666666666",
  title: "Reverse Linked List",
  url: "https://leetcode.com/problems/reverse-linked-list/",
  difficulty: "Easy",
  pattern: "Linked lists",
  created_at: "2026-10-18T00:00:00Z",
};
const solution = `class Solution:
    def reverseList(self, head: Optional[ListNode]) -> Optional[ListNode]:
        previous = None
        while head is not None:
            following = head.next
            head.next = previous
            previous = head
            head = following
        return previous`;

async function write(page: Page, source: string) {
  const codeTab = page.getByRole("tab", { name: "Code", exact: true });
  if (await codeTab.isVisible()) await codeTab.click();
  const editor = page.getByRole("textbox", { name: "Solution code" });
  await expect(editor).toBeVisible();
  await editor.focus();
  await page.keyboard.press("Control+a");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate((text) => navigator.clipboard.writeText(text), source);
  await page.keyboard.press("Control+v");
}
async function run(page: Page) {
  await page.getByRole("button", { name: "Run Code", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Run Code", exact: true }),
  ).toBeEnabled({ timeout: 45000 });
}
async function minimize(page: Page) {
  const toggle = page.locator(".companion-toggle");
  if ((await toggle.getAttribute("aria-expanded")) === "true")
    await toggle.click();
}
test("scheduled Reverse Linked List: real Python, one session clock, evidence and preserved history", async ({
  page,
  store,
}, info) => {
  test.setTimeout(180000);
  await page.clock.install({ time: instant });
  await page.addInitScript(() => {
    const entries = performance.getEntriesByName.bind(performance);
    performance.getEntriesByName = (name, type) =>
      entries(name, type).length
        ? entries(name, type)
        : [{ duration: 0 } as PerformanceEntry];
    const measure = performance.measure.bind(performance);
    performance.measure = ((
      name: string,
      options?: PerformanceMeasureOptions,
    ) => {
      const fallback = {
        name,
        entryType: "measure",
        startTime: 0,
        duration: 0,
        toJSON: () => ({}),
      } as PerformanceMeasure;
      try {
        return measure(name, options) ?? fallback;
      } catch {
        return fallback;
      }
    }) as typeof performance.measure;
  });
  store.problems.push({ ...problem }); // legacy URL-only identity, as in imported history
  const historical = {
    ...newAttempt(problem, "2026-10-18"),
    id: "77777777-7777-4777-8777-777777777777",
    correctness: "passed",
    duration_minutes: 27,
    solution: "# Private historical solution\nprint('keep exactly')",
    test_results: "Historical evidence",
    confidence: null,
  };
  store.attempts.push(historical);
  const original = JSON.stringify(historical);
  store.planner.config = {
    ...defaultPlannerConfig(),
    timezone: "UTC",
    interviewTimezone: "Europe/Istanbul",
    weekly: Array.from({ length: 7 }, () => [{ start: "08:00", end: "11:00" }]),
    rounds: [
      {
        id: "round",
        title: "Coding interview",
        date: "2026-10-21",
        time: "11:00",
        duration: 60,
        format: "coding",
      },
    ],
  };
  await page.goto("/plan");
  await expect(
    page
      .locator(".planner-session")
      .filter({ hasText: "Review Reverse Linked List" })
      .first(),
  ).toBeVisible();
  const companion = page.getByRole("complementary", {
    name: "Live study companion",
  });
  await page
    .getByRole("button", {
      name: "Start Review Reverse Linked List",
      exact: true,
    })
    .click();
  await expect(companion).toContainText("Review Reverse Linked List");
  await companion.locator(".companion-toggle").click();
  await expect(
    companion.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  const item = () =>
    store.planner.days.flatMap((d) => d.items).find((i) => i.live)!;
  const startedAt = item().live!.started_at;
  const key = item().key;
  await page.clock.runFor(6000);
  await expect
    .poll(() => item().live!.elapsed_seconds)
    .toBeGreaterThanOrEqual(5);
  await companion.getByRole("link", { name: "Open task", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/coding/${problem.id}/practice`));
  await expect(
    page.getByRole("heading", { name: problem.title, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open linked study session" }),
  ).toContainText("running");
  await expect(page.getByLabel("Practice timer", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByLabel("Active practice duration", { exact: true }),
  ).toHaveCount(0);
  await minimize(page);
  await page.getByRole("button", { name: "New attempt", exact: true }).click();
  expect(item().live!.started_at).toBe(startedAt);
  expect(item().live!.elapsed_seconds).toBeGreaterThanOrEqual(5);
  const mobile = info.project.name === "mobile";
  if (mobile)
    await page.getByRole("tab", { name: "Problem", exact: true }).click();
  await expect(page.locator(".practice-description")).toContainText(
    "Reorder a singly linked list",
  );
  await expect(page.locator(".practice-description")).toContainText(
    "[5,4,3,2,1]",
  );
  if (mobile)
    await page.getByRole("tab", { name: "Code", exact: true }).click();
  await expect(page.locator(".monaco-editor .view-lines")).toContainText(
    "def reverseList",
  );
  await expect(page.locator(".monaco-editor .view-lines")).not.toContainText(
    "Private historical solution",
  );
  // Real Monaco keyboard indentation, then clipboard paste the submitted code.
  const editor = page.getByRole("textbox", { name: "Solution code" });
  await editor.focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("# keyboard");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await write(page, solution);
  if (!mobile) {
    const before = await page.locator(".python-editor").boundingBox();
    expect(before!.height).toBeGreaterThan(220);
    const splitter = page.getByRole("separator", { name: "Resize test panel" });
    await splitter.focus();
    await page.keyboard.press("ArrowUp");
    const after = await page.locator(".python-editor").boundingBox();
    expect(after!.height).toBeLessThan(before!.height);
    const modelHeight = await page
      .locator(".monaco-editor")
      .first()
      .evaluate((e) => e.getBoundingClientRect().height);
    expect(Math.abs(modelHeight - after!.height)).toBeLessThan(3);
  }
  await run(page); // actual self-hosted Pyodide, no execution interception
  await expect(
    page.locator(".practice-tests .practice-case strong"),
  ).toHaveText(["Passed", "Passed", "Passed"]);
  await expect(
    page.locator(".practice-tests .practice-case").first().locator("pre"),
  ).toHaveText(["[5,4,3,2,1]", "[5, 4, 3, 2, 1]"]);
  if (mobile)
    await expect(
      page
        .locator(".practice-tests .practice-case")
        .first()
        .locator("pre")
        .last(),
    ).toBeInViewport();
  await page.screenshot({
    path: `artifacts/${info.project.name}-reverse-linked-list-results.png`,
    fullPage: false,
  });
  expect(store.attempts).toHaveLength(1);
  expect(item().status).toBe("planned");
  await page.getByRole("tab", { name: "Test Cases", exact: true }).click();
  await expect(
    page.getByRole("tabpanel", { name: "Test Cases" }),
  ).not.toContainText("grid");
  await page.getByRole("button", { name: "Add test case" }).click();
  await page.getByLabel("Input 4", { exact: true }).fill('{"head":[7]}');
  await page.getByLabel("Expected output 4", { exact: true }).fill("[7]");
  await run(page);
  await expect(
    page.locator(".practice-tests .practice-case strong"),
  ).toHaveText(["Passed", "Passed", "Passed", "Passed"]);
  await write(
    page,
    "class Solution:\n    def reverseList(self, head):\n        return head",
  );
  await run(page);
  await expect(
    page.locator(".practice-tests .practice-case strong"),
  ).toHaveText(["Wrong Answer", "Wrong Answer", "Passed", "Passed"]);
  await write(
    page,
    "class Solution:\n    def reverseList(self, head):\n        if head: head.next = head\n        return head",
  );
  await run(page);
  await expect(
    page.locator(".practice-tests .practice-case").first(),
  ).toContainText("Cycle detected");
  if (!mobile) {
    await write(
      page,
      "class Solution:\n    def reverseList(self, head):\n        result = ListNode(0)\n        tail = result\n        for i in range(5000):\n            tail.next = ListNode(0)\n            tail = tail.next\n        return result",
    );
    await run(page);
    await expect(
      page.locator(".practice-tests .practice-case").first(),
    ).toContainText("5000-node traversal limit");
  }
  await write(page, solution);
  await run(page);
  await page.getByRole("button", { name: "Open linked study session" }).click();
  await companion.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open linked study session" }),
  ).toContainText("paused");
  const paused = item().live!.elapsed_seconds;
  await page.clock.runFor(6000);
  expect(item().live!.elapsed_seconds).toBe(paused);
  await companion.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open linked study session" }),
  ).toContainText("running");
  expect(item().live!.started_at).toBe(startedAt);
  await minimize(page);
  await page.getByRole("button", { name: "Save attempt", exact: true }).click();
  await expect(
    page.getByText("Attempt saved. Correctness remains self-reported."),
  ).toBeVisible();
  expect(store.attempts).toHaveLength(2);
  expect(item().status).toBe("planned"); // sample results/unverified saves never complete
  const saved = store.attempts[1];
  const envelope = JSON.parse(String(saved.test_results));
  expect(envelope.studySession).toMatchObject({ key, startedAt });
  expect(envelope.timing).toBeUndefined(); // no second clock counting the session
  expect(saved.duration_minutes).toBeNull();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Open linked study session" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Active practice duration", { exact: true }),
  ).toHaveCount(0);
  if (mobile)
    await page.getByRole("tab", { name: "Tests", exact: true }).click();
  await expect(page.getByLabel("Input 4", { exact: true })).toHaveValue(
    '{"head":[7]}',
  );
  await page.getByRole("tab", { name: "Reflection", exact: true }).click();
  await page.getByLabel("Result (self-reported)").selectOption("partial");
  await page.getByLabel("Assistance used").selectOption("guided");
  await page.getByRole("button", { name: "Save attempt", exact: true }).click();
  await expect(
    page.getByText("Attempt saved. Correctness remains self-reported."),
  ).toBeVisible();
  await expect.poll(() => item().status).toBe("completed");
  expect(item().live).toMatchObject({
    attempt_id: saved.id,
    outcome: "partial",
    assistance: "guided",
  });
  expect(store.attempts).toHaveLength(2);
  expect(JSON.stringify(store.attempts[0])).toBe(original);
  await page.goto("/");
  await expect(page.locator(".milestone-card")).toContainText(
    "October 21, 2026",
  );
  await expect(page.locator(".milestone-card")).toContainText(
    "Coding interview",
  );
  await expect(page.locator(".milestone-days")).toContainText("2");
  const padding = await page
    .locator(".focus-panel .panel-body")
    .evaluate((e) => parseFloat(getComputedStyle(e).paddingLeft));
  expect(padding).toBeGreaterThanOrEqual(20);
  await page.goto(`/coding/${problem.id}/practice`);
  await expect(
    page.getByRole("button", { name: "Open linked study session" }),
  ).toContainText("finished");
  if (mobile)
    await page.getByRole("tab", { name: "Code", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Solution code" }),
  ).toBeVisible();
  await minimize(page);
  const bounds = await page.locator(".practice-content").boundingBox();
  const companionBounds = await companion.boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(companionBounds!.y);
  await page.screenshot({
    path: `artifacts/${info.project.name}-reverse-linked-list.png`,
    fullPage: false,
  });
  await page.getByRole("button", { name: "New attempt", exact: true }).click();
  expect(item().live!.started_at).toBe(startedAt);
  expect(item().status).toBe("completed");
  await expect(page.locator(".monaco-editor .view-lines")).toContainText(
    "pass",
  );
  await page.getByLabel("Attempt", { exact: true }).selectOption(historical.id);
  await expect(page.locator(".monaco-editor .view-lines")).toContainText(
    "Private historical solution",
  );
  expect(JSON.stringify(store.attempts[0])).toBe(original);
});

test("ID 206 loads without a canonical URL; untouched old blank drafts upgrade, edited drafts survive", async ({
  page,
  store,
}) => {
  store.problems.push({ ...problem, url: "", leetcode_id: 206 });
  const blank = newAttempt(problem, "2026-10-18");
  await page.addInitScript(
    ({ draft, id }) => {
      if (sessionStorage.getItem("old-preview-seeded")) return;
      sessionStorage.setItem("old-preview-seeded", "yes");
      localStorage.setItem(
        `looppilot:practice:v1:11111111-1111-4111-8111-111111111111:${id}`,
        JSON.stringify({ draft, saved: JSON.stringify(draft) }),
      );
    },
    { draft: blank, id: problem.id },
  );
  await page.goto(`/coding/${problem.id}/practice`);
  await expect(page.locator(".monaco-editor .view-lines")).toContainText(
    "def reverseList",
  );
  await expect(
    page.getByRole("button", { name: "Run Code", exact: true }),
  ).toBeEnabled();
  await write(page, "# my unsaved code");
  await page.waitForTimeout(1200);
  page.once("dialog", (d) => d.accept());
  await page.reload();
  await expect(page.locator(".monaco-editor .view-lines")).toContainText(
    "# my unsaved code",
  );
  expect(store.attempts).toHaveLength(0);
});

test("linked recovery freezes the previous attempt clock and new attempts keep the active session", async ({
  page,
  store,
}) => {
  test.setTimeout(45000);
  await page.clock.install({ time: instant });
  store.problems.push({ ...problem, leetcode_id: 206 });
  store.planner.config = {
    ...defaultPlannerConfig(),
    timezone: "UTC",
    weekly: Array.from({ length: 7 }, () => [{ start: "08:00", end: "11:00" }]),
  };
  await page.goto("/plan");
  await page
    .getByRole("button", { name: /^Start .*Reverse Linked List$/ })
    .first()
    .click();
  const companion = page.getByRole("complementary", {
    name: "Live study companion",
  });
  await expect(companion).toContainText("running");
  const current = () =>
    store.planner.days.flatMap((d) => d.items).find((i) => i.live)!;
  const link = {
    day: store.planner.days.find((d) =>
      d.items.some((i) => i.key === current().key),
    )!.day,
    key: current().key,
    startedAt: current().live!.started_at,
  };
  const timing = { seconds: 6, source: "measured" as const };
  const draft = {
    ...newAttempt(problem, "2026-10-19"),
    solution: "# Existing unsaved draft",
    test_results: serializeEvidence([], "", timing, link),
  };
  await page.evaluate(
    ({ draft, timing, id }) =>
      localStorage.setItem(
        `looppilot:practice:v1:11111111-1111-4111-8111-111111111111:${id}`,
        JSON.stringify({ draft, timing, saved: JSON.stringify(draft) }),
      ),
    { draft, timing, id: problem.id },
  );
  await companion.locator(".companion-toggle").click();
  await companion.getByRole("link", { name: "Open task", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open linked study session" }),
  ).toContainText("running");
  await minimize(page);
  await page.clock.runFor(6000);
  await page.getByRole("button", { name: "Save attempt", exact: true }).click();
  await expect(
    page.getByText("Attempt saved. Correctness remains self-reported."),
  ).toBeVisible();
  expect(store.attempts).toHaveLength(1);
  expect(store.attempts[0].duration_minutes).toBe(1);
  expect(JSON.parse(String(store.attempts[0].test_results)).timing).toEqual(
    timing,
  );
  expect(current().live!.elapsed_seconds).toBeGreaterThanOrEqual(5);
  expect(current().live!.started_at).toBe(link.startedAt);
  await page.getByRole("button", { name: "New attempt", exact: true }).click();
  await expect(page.getByLabel("Practice timer", { exact: true })).toHaveCount(
    0,
  );
  expect(current().live!.started_at).toBe(link.startedAt);
  await page.getByRole("button", { name: "Save attempt", exact: true }).click();
  await expect(
    page.getByText("Attempt saved. Correctness remains self-reported."),
  ).toBeVisible();
  expect(store.attempts).toHaveLength(2);
  expect(store.attempts[1].duration_minutes).toBeNull();
  expect(
    JSON.parse(String(store.attempts[1].test_results)).timing,
  ).toBeUndefined();
  expect(JSON.parse(String(store.attempts[0].test_results)).timing).toEqual(
    timing,
  );
  expect(current().live!.started_at).toBe(link.startedAt);
});
