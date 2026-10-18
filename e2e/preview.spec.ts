import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

test("real Next.js AI routes accept configured loopback requests and reject foreign origins before authentication", async ({
  request,
}) => {
  // This reaches the actual Next route and guard, without a Supabase bearer token,
  // credential storage, OAuth authorization, or external inference.
  const get = await request.get("/api/ai/settings");
  expect(get.status()).toBe(401);
  expect(await get.json()).toMatchObject({ code: "unauthenticated" });
  const post = await request.post("/api/ai/settings", {
    headers: { Origin: "http://127.0.0.1:3003" },
    data: { action: "connect" },
  });
  expect(post.status()).toBe(401);
  expect(await post.json()).toMatchObject({ code: "unauthenticated" });
  const foreign = await request.post("/api/ai/settings", {
    headers: { Origin: "https://attacker.test" },
    data: { action: "connect" },
  });
  expect(foreign.status()).toBe(403);
  expect(await foreign.json()).toMatchObject({ code: "invalid_origin" });
  const wrongHost = await request.get("/api/ai/settings", {
    headers: { Host: "attacker.test:3003" },
  });
  expect(wrongHost.status()).toBe(403);
  expect(await wrongHost.json()).toMatchObject({
    code: "local_origin_mismatch",
  });
  const callback = await request.get("/auth/callback?state=synthetic-test", {
    headers: { "Sec-Fetch-Site": "cross-site" },
    maxRedirects: 0,
  });
  expect(callback.status()).toBe(303);
  expect(callback.headers().location).toBe("/settings?chatgpt=failed");
});
test("preview is honest, navigable and fits the viewport", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  async function inspectScreen(name: string) {
    await expect(
      page.locator(".eyebrow, .tiny-label, .section-number"),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `artifacts/${testInfo.project.name}-${name}.png`,
      fullPage: true,
    });
  }
  await page.goto("/");
  await expect(
    page.getByText("Setup preview · No sample history.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your study journal" }),
  ).toBeVisible();
  const illustration = page.locator(".brand-illustration");
  await expect(illustration).toHaveJSProperty("naturalWidth", 1254);
  const iconLink = page.locator('link[rel="icon"]');
  await expect(iconLink).toHaveCount(1);
  const iconHref = await iconLink.getAttribute("href");
  expect(iconHref).toMatch(/^\/icon\.png/);
  const faviconResponse = await page.request.get(iconHref!);
  expect(faviconResponse.ok()).toBe(true);
  expect(
    (await faviconResponse.body()).equals(readFileSync("src/app/icon.png")),
  ).toBe(true);
  const artworkResponse = await page.request.get("/brand/icon.png");
  expect(artworkResponse.ok()).toBe(true);
  expect(
    (await artworkResponse.body()).equals(
      readFileSync("public/brand/icon.png"),
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `artifacts/${testInfo.project.name}-overview.png`,
    fullPage: true,
  });
  await page.goto("/coding");
  await expect(
    page.getByRole("heading", { name: "Coding practice", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add problem" }).first(),
  ).toBeDisabled();
  await inspectScreen("coding");
  await page.goto("/stories");
  await expect(
    page.getByRole("heading", { name: "Your story bank", exact: true }),
  ).toBeVisible();
  await inspectScreen("stories");
  await page.goto("/plan");
  await expect(
    page.getByText("Connect your workspace in", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit availability", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".planner-session")).toHaveCount(0);
  await inspectScreen("plan");
  await page.goto("/analytics");
  await expect(
    page.getByRole("heading", { name: "Not enough data" }),
  ).toBeVisible();
  await inspectScreen("readiness");
  await page.goto("/settings");
  await page
    .getByLabel("Import JSON", { exact: true })
    .fill('{"version":1,"problems":[],"attempts":[],"stories":[]}');
  await page.getByRole("button", { name: "Validate & preview" }).click();
  await expect(
    page.getByText("0 problems · 0 attempts · 0 stories"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Import validated records" }),
  ).toBeDisabled();
  await inspectScreen("settings");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await page.goto("/not-a-route");
  await expect(
    page.getByRole("heading", { name: "Page not found" }),
  ).toBeVisible();
});
test("primary navigation reaches every route", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your study journal" }),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
  const navigation = page.getByRole("navigation", {
    name:
      testInfo.project.name === "mobile"
        ? "Mobile navigation"
        : "Main navigation",
  });
  await expect(navigation).toBeVisible();
  await navigation
    .getByRole("link", { name: "Coding practice", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Coding practice", exact: true }),
  ).toBeVisible();
  await expect(
    navigation.getByRole("link", { name: "Coding practice", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await navigation.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Settings & data" }),
  ).toBeVisible();
});
