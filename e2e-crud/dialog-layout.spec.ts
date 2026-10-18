import { writeFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";

async function measure(page: Page, label: string) {
  const result = await page.getByRole("dialog").evaluate((el) => {
    const r = el.getBoundingClientRect(),
      s = getComputedStyle(el);
    return {
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      centerX: r.x + r.width / 2,
      centerY: r.y + r.height / 2,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      deltaX: Math.abs(r.x + r.width / 2 - innerWidth / 2),
      deltaY: Math.abs(r.y + r.height / 2 - innerHeight / 2),
      position: s.position,
      margin: s.margin,
      transform: s.transform,
      parent: el.parentElement?.tagName,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    };
  });
  console.log(JSON.stringify({ label, ...result }));
  expect(result.deltaX).toBeLessThanOrEqual(5);
  if (result.height <= result.viewportHeight)
    expect(result.deltaY).toBeLessThanOrEqual(5);
  expect(result.x).toBeGreaterThanOrEqual(0);
  expect(result.y).toBeGreaterThanOrEqual(0);
  expect(result.width).toBeLessThanOrEqual(result.viewportWidth - 24);
  expect(result.scrollWidth).toBeLessThanOrEqual(result.clientWidth);
  return { label, ...result };
}
for (const staleStyles of [false, true]) {
  test(`viewport modal geometry${staleStyles ? " with outdated global layout rules" : ""}`, async ({
    page,
    store,
  }, info) => {
    void store;
    const records = [];
    const prefix = `${info.project.name}-${staleStyles ? "stale-css" : "current-css"}`;
    await page.goto("/coding");
    if (staleStyles)
      await page.addStyleTag({
        content:
          ".dialog { position: fixed; inset: 0; margin: 0; } .problem-lookup, .problem-lookup-controls { display: block; } .main-shell { transform: translate(13px, 17px); overflow: hidden; isolation: isolate; }",
      });
    await page
      .getByRole("button", { name: "Add problem", exact: true })
      .first()
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    records.push(await measure(page, `${prefix}-add-problem`));
    const input = await page
      .getByLabel("LeetCode problem number")
      .boundingBox();
    const button = await page
      .getByRole("button", { name: "Look up", exact: true })
      .boundingBox();
    expect(button!.x).toBeGreaterThanOrEqual(input!.x + input!.width);
    expect(
      Math.abs(button!.y + button!.height / 2 - input!.y - input!.height / 2),
    ).toBeLessThanOrEqual(3);
    const lookupAlignment = {
      input,
      button,
      deltaY: Math.abs(
        button!.y + button!.height / 2 - input!.y - input!.height / 2,
      ),
    };
    await page.screenshot({ path: `artifacts/${prefix}-add-problem.png` });
    await page.getByLabel("LeetCode problem number").fill("150");
    await expect(page.getByLabel("Problem title")).toHaveValue(
      "Evaluate Reverse Polish Notation",
    );
    records.push(await measure(page, `${prefix}-add-problem-populated`));
    await page.screenshot({
      path: `artifacts/${prefix}-add-problem-populated.png`,
    });
    await page.keyboard.press("Escape");
    await page.goto("/stories");
    if (staleStyles)
      await page.addStyleTag({
        content: ".dialog { position: fixed; inset: 0; margin: 0; }",
      });
    await page.getByRole("button", { name: "Add story", exact: true }).click();
    records.push(await measure(page, `${prefix}-add-story`));
    await page.screenshot({ path: `artifacts/${prefix}-add-story.png` });
    const story = page.getByRole("dialog");
    await story.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(
      page.getByRole("button", { name: "Save story", exact: true }),
    ).toBeVisible();
    records.push(await measure(page, `${prefix}-add-story-scrolled`));
    await page.keyboard.press("Escape");
    await writeFile(
      `artifacts/${prefix}-dialog-measurements.json`,
      JSON.stringify({ dialogs: records, lookupAlignment }, null, 2),
    );
  });
}
