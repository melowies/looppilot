import { test, expect } from "./fixtures";

const problem = {
  id: "22222222-2222-4222-8222-222222222222",
  title: "Two Sum",
  url: "https://leetcode.com/problems/two-sum/",
  difficulty: "Easy",
  pattern: "Arrays & hashing",
  created_at: "2026-10-17T00:00:00Z",
};

test("IDE keyboard, save/reopen, reflection, panels and navigation warnings", async ({
  page,
  store,
}, info) => {
  store.problems.push(problem);
  const mobile = info.project.name === "mobile";
  await page.goto("/coding");
  await page.getByRole("button", { name: /Two Sum/ }).click();
  await expect(page).toHaveURL(new RegExp(`/coding/${problem.id}/practice`));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const editor = page.getByRole("textbox", { name: "Solution code" });
  await expect(editor).toBeVisible();
  await page
    .locator(".monaco-editor .view-lines")
    .click({ position: { x: 45, y: 12 } });
  await expect(editor).toBeFocused();
  await page.keyboard.type("def solve():");
  await page.keyboard.press("Enter");
  await page.keyboard.type("return ");
  await page.keyboard.type("(");
  await expect(page.locator(".monaco-editor .view-lines")).toContainText(
    "return ()",
  );
  await page.keyboard.type("1");
  await page.keyboard.press("End");
  await page.keyboard.press("Home");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator(".monaco-editor .view-lines")).toContainText(
    "return (1)",
  );
  await page.keyboard.press("Control+m");
  await page.keyboard.press("Tab");
  await expect(editor).not.toBeFocused();
  await editor.focus();
  await page.keyboard.press("Control+m");
  await page.keyboard.press("Control+s");
  await expect(
    page.getByText("Attempt saved. Correctness remains self-reported."),
  ).toBeVisible();
  expect(store.attempts).toHaveLength(1);
  expect(String(store.attempts[0].solution).replace(/\r\n/g, "\n")).toBe(
    "def solve():\n    return (1)",
  );
  expect(store.attempts[0].correctness).toBe("unverified");
  expect(Number(store.attempts[0].duration_minutes)).toBeGreaterThan(0);

  await page.getByRole("tab", { name: "Reflection", exact: true }).click();
  await page.getByLabel("Personal notes").fill("Check empty input");
  await page.getByLabel("Assistance used").selectOption("hinted");
  await page.getByLabel("Number of hints").fill("1");
  await page.getByText("Correct duration manually", { exact: true }).click();
  await page.getByLabel("Manual duration correction (minutes)").fill("25");
  store.rejectAttempt = true;
  await page.getByRole("button", { name: "Save attempt", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Attempt save failed" }),
  ).toBeVisible();
  await expect(page.getByLabel("Personal notes")).toHaveValue(
    "Check empty input",
  );
  await page.getByRole("button", { name: "Save attempt", exact: true }).click();
  await expect(
    page.getByText("Attempt saved. Correctness remains self-reported."),
  ).toBeVisible();
  expect(store.attempts).toHaveLength(1);
  expect(store.attempts[0]).toMatchObject({
    assistance: "hinted",
    hints: 1,
    duration_minutes: 25,
    correctness: "unverified",
  });
  expect(JSON.parse(String(store.attempts[0].test_results)).timing.source).toBe(
    "manual",
  );

  if (mobile)
    await page.getByRole("tab", { name: "Tests", exact: true }).click();
  await page.getByRole("button", { name: "Add test case" }).click();
  await page.getByLabel("Input 1", { exact: true }).fill("[2,7], 9");
  await page.getByLabel("Expected output 1").fill("[0,1]");
  await page.getByRole("tab", { name: "Test Results", exact: true }).click();
  await expect(
    page.getByText("Not run. Run Code on a supported Python problem", {
      exact: false,
    }),
  ).toBeVisible();
  await page
    .getByLabel("Test results / correctness evidence (self-reported)")
    .fill("Manual case, not executed");
  await page.getByRole("tab", { name: "Test Results", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Console", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByText("No console output.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save attempt", exact: true }).click();
  await expect(
    page.getByText("No unsaved changes", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByLabel("Attempt", { exact: true })
    .selectOption(store.attempts[0].id as string);
  if (!mobile)
    await page.getByRole("tab", { name: "Problem", exact: true }).click();
  if (mobile)
    await page.getByRole("tab", { name: "Problem", exact: true }).click();
  await expect(page.locator(".practice-notes")).toBeVisible();
  await expect(
    page.locator(".practice-description pre").filter({ hasText: "[0,1]" }),
  ).toBeVisible();

  if (mobile)
    await page.getByRole("tab", { name: "Code", exact: true }).click();
  await page.getByLabel("Editor theme").selectOption("light");
  await page.getByLabel("Font size").selectOption("18");
  await expect(page.locator(".monaco-editor")).toHaveClass(/\bvs\b/);
  await expect(page.locator(".monaco-editor .view-lines")).toHaveCSS(
    "font-size",
    "18px",
  );
  if (!mobile) {
    const separator = page.getByRole("separator", {
      name: "Resize problem panel",
    });
    await separator.focus();
    await page.keyboard.press("ArrowRight");
    await expect(separator).toHaveAttribute("aria-valuenow", "38");
    const box = await separator.boundingBox();
    await page.mouse.move(box!.x + 4, box!.y + 100);
    await page.mouse.down();
    await page.mouse.move(box!.x + 40, box!.y + 100);
    await page.mouse.up();
    expect(
      Number(await separator.getAttribute("aria-valuenow")),
    ).toBeGreaterThan(38);
    const tests = page.getByRole("separator", { name: "Resize test panel" });
    await tests.focus();
    await page.keyboard.press("ArrowUp");
    await expect(tests).toHaveAttribute("aria-valuenow", "70");
  }
  await page.screenshot({
    path: `artifacts/${info.project.name}-coding-practice.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .locator(".monaco-editor .view-lines")
    .click({ position: { x: 45, y: 12 } });
  await expect(editor).toBeFocused();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" # changed");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "New attempt", exact: true }).click();
  await expect(
    page.getByText("Unsaved changes", { exact: true }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Two Sum", exact: true }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("link", { name: "← Coding practice" }).click();
  await expect(page).toHaveURL(new RegExp(`/coding/${problem.id}/practice`));
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.goBack();
  await expect(
    page.getByText("Unsaved changes", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save attempt", exact: true }).click();
  await expect(
    page.getByText("No unsaved changes", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "← Coding practice" }).click();
  await expect(page).toHaveURL(/\/coding$/);
  expect(store.attempts).toHaveLength(1);
});

test("reopens a legacy attempt without changing its date, duration, language or evidence", async ({
  page,
  store,
}, info) => {
  store.problems.push(problem);
  store.attempts.push({
    id: "33333333-3333-4333-8333-333333333333",
    problem_id: problem.id,
    attempted_on: "2025-04-02",
    duration_minutes: null,
    language: "JavaScript",
    solution: "const x = 1;",
    difficulty: "Hard",
    pattern: "Trees",
    assistance: "solution-viewed",
    hints: 0,
    correctness: "partial",
    test_results: "Manually checked sample",
    time_complexity: "O(n)",
    space_complexity: "O(1)",
    confidence: 2,
    notes: "Historical notes",
  });
  await page.goto(`/coding/${problem.id}/practice`);
  await page
    .getByLabel("Attempt", { exact: true })
    .selectOption(store.attempts[0].id as string);
  await page.getByRole("tab", { name: "Reflection", exact: true }).click();
  await expect(page.getByLabel("Attempt date")).toHaveValue("2025-04-02");
  await expect(page.getByLabel("Programming language")).toHaveValue(
    "JavaScript",
  );
  await page.getByRole("button", { name: "Save attempt", exact: true }).click();
  await expect(
    page.getByText("No unsaved changes", { exact: true }),
  ).toBeVisible();
  expect(store.attempts[0]).toMatchObject({
    attempted_on: "2025-04-02",
    duration_minutes: null,
    language: "JavaScript",
    correctness: "partial",
    assistance: "solution-viewed",
    test_results: "Manually checked sample",
  });
  if (info.project.name === "mobile")
    await page.getByRole("tab", { name: "Code", exact: true }).click();
  await expect(
    page.getByText("JavaScript · plain text", { exact: true }),
  ).toBeVisible();
});
