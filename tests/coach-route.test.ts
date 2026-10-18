import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyData } from "../src/lib/domain";
import { defaultPlannerConfig } from "../src/lib/adaptive-types";
import { generateAdaptiveWeek } from "../src/lib/adaptive-planner";
import { ChatGPTError } from "../src/lib/chatgpt-protocol.server";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  status: vi.fn(),
  access: vi.fn(),
  request: vi.fn(),
  recordFailure: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("../src/lib/chatgpt-session.server", async (original) => ({
  ...(await original<typeof import("../src/lib/chatgpt-session.server")>()),
  chatgptSessions: {
    status: mocks.status,
    access: mocks.access,
    recordFailure: mocks.recordFailure,
  },
}));
vi.mock("../src/lib/coach-provider.server", () => ({
  requestSelectedCoach: mocks.request,
}));
import { POST } from "../src/app/api/planner/coach/route";

describe("coaching persistence boundary", () => {
  const config = {
    ...defaultPlannerConfig(),
    aiConsent: true,
    weekly: Array.from({ length: 7 }, () => [{ start: "18:00", end: "20:00" }]),
  };
  let revision = 1;
  let rpc: ReturnType<typeof vi.fn>;
  const request = () =>
    new Request("http://127.0.0.1:3000/api/planner/coach", {
      method: "POST",
      headers: {
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
        Authorization: "Bearer app-session",
      },
    });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-19T08:00:00Z"));
    revision = 1;
    for (const [name, value] of Object.entries({
      LOOPPILOT_CHATGPT_LOCAL: "1",
      LOOPPILOT_LOCAL_ORIGIN: "http://127.0.0.1:3000",
      NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-test-key",
      OPENAI_API_KEY: "",
    }))
      vi.stubEnv(name, value);
    const day = {
      ...generateAdaptiveWeek(emptyData, config, [], "2026-10-19T08:00:00Z")[0],
      sourceRevision: 1,
    };
    rpc = vi
      .fn()
      .mockImplementation(async (name) => ({
        data: name === "reserve_planner_coach" ? { status: "allowed" } : null,
        error: null,
      }));
    mocks.createClient.mockReturnValue({
      auth: {
        getUser: async () => ({ data: { user: { id: "owner" } }, error: null }),
      },
      rpc,
      from: (table: string) => {
        const result = () => ({
          data:
            table === "planner_state"
              ? { config, revision }
              : table === "study_plans"
                ? { payload: day }
                : table === "profiles"
                  ? emptyData.profile
                  : [],
          error: null,
        });
        const query = {
          select: () => query,
          eq: () => query,
          single: async () => result(),
          then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve(result()).then(resolve),
        };
        return query;
      },
    });
    mocks.status.mockResolvedValue({
      provider: "chatgpt",
      active: "profile",
      profiles: [{ id: "profile", authorized: true, model: "catalog-model" }],
    });
    mocks.access.mockResolvedValue({
      access: "private-oauth-token",
      profileId: "profile",
      clientId: "oaiapp_test",
      model: "catalog-model",
    });
    mocks.request.mockImplementation(async (summary) => ({
      focus_keys: [summary.sessions[0].key],
      approach: "independent_first",
      difficulty: "maintain",
      pacing: "steady",
    }));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });
  it("saves validated completed choices using ChatGPT without an API key and returns only safe provider metadata", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({
      provider: "chatgpt",
      model: "catalog-model",
      status: "generated",
    });
    expect(JSON.stringify(result)).not.toContain("private-oauth-token");
    expect(mocks.request.mock.calls[0][1]).toEqual({
      kind: "chatgpt",
      accessToken: "private-oauth-token",
      model: "catalog-model",
    });
    expect(
      rpc.mock.calls.filter(([name]) => name === "finish_planner_coach"),
    ).toHaveLength(1);
  });
  it.each([
    "interrupted",
    "malformed",
    "quota",
    "selection_changed",
    "evidence_changed",
  ])(
    "never saves %s coaching or retries through the paid provider",
    async (failure) => {
      vi.stubEnv("OPENAI_API_KEY", "paid-key-must-not-be-used");
      const original = mocks.request.getMockImplementation()!;
      mocks.request.mockImplementation(async (...args) => {
        if (failure === "interrupted") throw new Error("stream ended");
        if (failure === "quota")
          throw new ChatGPTError(
            "subscription_sharing_usage_limit_exceeded",
            "Usage limit reached",
            429,
          );
        if (failure === "malformed")
          return {
            focus_keys: ["invented"],
            approach: "independent_first",
            difficulty: "maintain",
            pacing: "steady",
          };
        if (failure === "selection_changed")
          mocks.status.mockResolvedValue({ provider: "openai", profiles: [] });
        if (failure === "evidence_changed") revision++;
        return original(...args);
      });
      expect((await POST(request())).status).toBeGreaterThanOrEqual(400);
      expect(mocks.request).toHaveBeenCalledTimes(1);
      expect(
        rpc.mock.calls.some(([name]) => name === "finish_planner_coach"),
      ).toBe(false);
    },
  );
  it("does not dispatch when rule-based planning is selected even with an API key present", async () => {
    vi.stubEnv("OPENAI_API_KEY", "paid-key");
    mocks.status.mockResolvedValue({ provider: "rules" });
    expect((await POST(request())).status).toBe(409);
    expect(mocks.request).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
