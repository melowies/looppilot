import { test as base } from "@playwright/test";
import type { DayPlan, PlannerConfig } from "../src/lib/adaptive-types";

type Store = {
  problems: Record<string, unknown>[];
  rejectNext: boolean;
  attemptWrites: number;
  attempts: Record<string, unknown>[];
  stories: Record<string, unknown>[];
  rejectAttempt: boolean;
  planner: {
    config: Partial<PlannerConfig>;
    revision: number;
    days: DayPlan[];
  };
  planWrites: number;
};
export const test = base.extend<{ store: Store }>({
  store: async ({ page }, provideStore) => {
    const store: Store = {
      problems: [],
      attempts: [],
      stories: [],
      rejectAttempt: false,
      rejectNext: false,
      attemptWrites: 0,
      planner: { config: {}, revision: 0, days: [] },
      planWrites: 0,
    };
    const user = {
      id: "11111111-1111-4111-8111-111111111111",
      aud: "authenticated",
      role: "authenticated",
      email: "fixture@example.test",
      app_metadata: { provider: "email" },
      user_metadata: {},
      created_at: "2026-10-17T00:00:00Z",
    };
    // Test-only token must survive deterministic planner day/deadline clocks.
    const expires = Math.floor(Date.now() / 1000) + 10 * 365 * 86400;
    const token = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: user.id, role: "authenticated", exp: expires })).toString("base64url")}.test-signature`;
    const session = {
      access_token: token,
      refresh_token: "test-only-refresh",
      expires_at: expires,
      expires_in: 3600,
      token_type: "bearer",
      user,
    };
    await page.addInitScript(
      (value) =>
        localStorage.setItem(
          "sb-looppilot-e2e-auth-token",
          JSON.stringify(value),
        ),
      session,
    );
    await page.route("https://looppilot-e2e.supabase.co/**", async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (url.pathname.startsWith("/auth/")) {
        await route.fulfill({ json: user });
        return;
      }
      const table = url.pathname.split("/").at(-1);
      if (table === "get_planner_state") {
        await route.fulfill({ json: store.planner });
        return;
      }
      if (table === "commit_planner_week") {
        const value = request.postDataJSON();
        if (value.expected_revision !== store.planner.revision) {
          await route.fulfill({
            status: 409,
            json: {
              code: "40001",
              message: "Planner changed; refresh and try again",
            },
          });
          return;
        }
        store.planWrites++;
        store.planner.days = [
          ...store.planner.days.filter(
            (p) => !value.days.some((d: DayPlan) => d.day === p.day),
          ),
          ...value.days,
        ];
        await route.fulfill({ json: null });
        return;
      }
      if (table === "save_planner_config") {
        const value = request.postDataJSON();
        store.planner.config = value.settings;
        store.planner.revision++;
        await route.fulfill({ json: null });
        return;
      }
      if (table === "edit_planner_item") {
        const value = request.postDataJSON(),
          plan = store.planner.days.find((p) => p.day === value.plan_day),
          item = plan?.items.find((i) => i.key === value.item_key);
        if (!item) throw new Error("Unknown planner session");
        if (value.action === "complete") {
          item.status = "completed";
          item.completed_at = new Date().toISOString();
        }
        if (value.action === "skip") item.status = "skipped";
        if (value.action === "pin") item.pinned = !item.pinned;
        if (value.action === "reschedule") {
          const targetDay = new Date(value.new_start).toLocaleDateString(
            "en-CA",
            { timeZone: store.planner.config.timezone ?? "Europe/Istanbul" },
          );
          const moved = {
            ...item,
            start: value.new_start,
            end: new Date(
              Date.parse(value.new_start) + item.minutes * 60000,
            ).toISOString(),
            pinned: true,
          };
          if (targetDay === value.plan_day) Object.assign(item, moved);
          else {
            const target = store.planner.days.find((p) => p.day === targetDay)!;
            moved.key = targetDay + item.key.slice(10);
            item.status = "skipped";
            target.items = [
              ...target.items.filter((i) => i.key !== moved.key),
              moved,
            ];
          }
        }
        store.planner.revision++;
        await route.fulfill({ json: null });
        return;
      }
      if (request.method() === "GET") {
        await route.fulfill({
          json:
            table === "coding_problems"
              ? store.problems
              : table === "coding_attempts"
                ? store.attempts
                : table === "behavioral_stories"
                  ? store.stories
                  : [],
        });
        return;
      }
      if (table === "coding_attempts") {
        store.attemptWrites++;
        if (store.rejectAttempt) {
          store.rejectAttempt = false;
          await route.fulfill({
            status: 500,
            json: { message: "Attempt save failed. Please retry." },
          });
          return;
        }
        const value = request.postDataJSON() as Record<string, unknown>;
        const id = url.searchParams.get("id")?.replace("eq.", "") ?? value.id;
        if (request.method() === "PATCH") {
          const index = store.attempts.findIndex((a) => a.id === id);
          if (index < 0) throw new Error("Attempt not found");
          store.attempts[index] = { ...store.attempts[index], ...value };
        } else store.attempts.push(value);
        store.planner.revision++;
        await route.fulfill({ json: { id } });
        return;
      }
      if (table === "coding_problems" && request.method() === "POST") {
        const value = request.postDataJSON() as Record<string, unknown>;
        if (
          store.rejectNext ||
          store.problems.some(
            (p) =>
              value.leetcode_id != null && p.leetcode_id === value.leetcode_id,
          )
        ) {
          store.rejectNext = false;
          await route.fulfill({
            status: 409,
            json: {
              code: "23505",
              message: "duplicate key value violates unique constraint",
            },
          });
          return;
        }
        const row = {
          ...value,
          id: crypto.randomUUID(),
          created_at: new Date().toISOString(),
        };
        store.problems.unshift(row);
        store.planner.revision++;
        await route.fulfill({ status: 201, json: { id: row.id } });
        return;
      }
      await route.fulfill({ json: { id: crypto.randomUUID() } });
    });
    await provideStore(store);
  },
});

export { expect } from "@playwright/test";
