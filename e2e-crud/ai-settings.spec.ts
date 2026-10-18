import { test, expect } from "./fixtures";
import { defaultPlannerConfig } from "../src/lib/adaptive-types";

test("local AI settings keep provider choice explicit and retain rule-based scheduling after a quota error", async ({
  page,
  store,
}, testInfo) => {
  // Synthetic browser transport exercises UI only; no real OAuth or inference.
  let provider = "rules",
    model: string | undefined,
    connected = false;
  const commands: Record<string, unknown>[] = [];
  const status = () => ({
    provider,
    active: connected ? "profile-1" : undefined,
    apiConfigured: true,
    profiles: connected
      ? [
          {
            id: "profile-1",
            label: "Account 1",
            email: "fixture@example.test",
            verified: true,
            connected: true,
            authorized: true,
            model,
            welcome: false,
          },
        ]
      : [],
  });
  await page.route("**/api/ai/settings", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: status() });
    const body = route.request().postDataJSON();
    commands.push(body);
    if (body.action === "models")
      return route.fulfill({
        json: {
          models: [
            { slug: "available-model", display_name: "Available model" },
          ],
        },
      });
    if (body.action === "connect") {
      connected = true;
      return route.fulfill({ json: {} });
    }
    if (body.action === "disconnect") {
      connected = false;
      return route.fulfill({ json: { revoked: true } });
    }
    if (body.provider) provider = body.provider;
    if (body.model) model = body.model;
    return route.fulfill({ json: status() });
  });
  await page.goto("/settings");
  const panel = page.getByRole("region", {
    name: "AI provider & ChatGPT connection",
  });
  await expect(
    panel.getByText("Current provider:", { exact: false }),
  ).toContainText("Rule-based planner");
  await panel
    .getByRole("button", { name: "Continue with ChatGPT", exact: true })
    .click();
  await expect(
    panel.getByText("Connected · plan permission granted", { exact: true }),
  ).toBeVisible();
  await panel
    .getByLabel("Available ChatGPT model", { exact: true })
    .selectOption("available-model");
  await panel.getByRole("button", { name: "Save ChatGPT model" }).click();
  await expect(
    panel.getByText("Current provider:", { exact: false }),
  ).toContainText("Rule-based planner");
  await panel
    .getByLabel("AI provider", { exact: true })
    .selectOption("chatgpt");
  await panel.getByRole("button", { name: "Use selected provider" }).click();
  await expect(
    panel.getByText("Current provider:", { exact: false }),
  ).toContainText("ChatGPT plan");
  await expect(
    panel.getByRole("link", { name: "Manage usage" }),
  ).toHaveAttribute("href", "https://chatgpt.com/settings/usage");
  await expect(page.locator("body")).toHaveJSProperty(
    "scrollWidth",
    await page.locator("body").evaluate((e) => e.clientWidth),
  );
  await page.screenshot({
    path: `artifacts/${testInfo.project.name}-chatgpt-settings.png`,
    fullPage: true,
  });
  store.planner.config = {
    ...defaultPlannerConfig(),
    aiConsent: true,
    weekly: Array.from({ length: 7 }, () => [{ start: "18:00", end: "20:00" }]),
  };
  await page.clock.install({ time: new Date("2026-10-19T08:00:00Z") });
  await page.route("**/api/planner/coach", (route) =>
    route.fulfill({
      status: 429,
      json: {
        error:
          "ChatGPT usage limit reached. Review your plan or this app’s limit in Manage usage. No paid API fallback was used.",
      },
    }),
  );
  await page.goto("/plan");
  await expect(
    page.getByRole("heading", { name: /Baseline assessment:/ }),
  ).toBeVisible();
  await expect(
    page.getByText("ChatGPT usage limit reached.", { exact: false }),
  ).toBeVisible();
  expect(commands.some((c) => c.provider === "openai")).toBe(false);
  await page.goto("/settings");
  await panel
    .getByRole("button", { name: "Disconnect ChatGPT", exact: true })
    .click();
  await expect(panel.getByText("Disconnected", { exact: true })).toBeVisible();
  expect(provider).toBe("chatgpt"); // Disconnect must not select a paid provider.
});
