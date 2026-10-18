import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ callback: vi.fn() }));
vi.mock("../src/lib/chatgpt-session.server", async (original) => ({
  ...(await original<typeof import("../src/lib/chatgpt-session.server")>()),
  chatgptSessions: { callback: mocks.callback },
}));
import { GET } from "../src/app/auth/callback/route";

describe("browser OAuth return route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("LOOPPILOT_CHATGPT_LOCAL", "1");
    vi.stubEnv("LOOPPILOT_LOCAL_ORIGIN", "http://127.0.0.1:3000");
    mocks.callback.mockResolvedValue(undefined);
  });
  afterEach(() => vi.unstubAllEnvs());
  const request = (
    cookie = "looppilot-oauth=test-browser-binding",
    host = "127.0.0.1:3000",
  ) =>
    new Request(
      "http://localhost:3000/auth/callback?code=synthetic-code&state=synthetic-state",
      { headers: { host, cookie, "sec-fetch-site": "cross-site" } },
    );
  it("accepts a normalized cross-site return and passes the browser binding for session validation", async () => {
    const response = await GET(request());
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(
      "/settings?chatgpt=connected",
    );
    expect(mocks.callback).toHaveBeenCalledTimes(1);
    expect(mocks.callback.mock.calls[0][1]).toBe("test-browser-binding");
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });
  it("rejects a return without its binding before session operations", async () => {
    const response = await GET(request(""));
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/settings?chatgpt=failed");
    expect(mocks.callback).not.toHaveBeenCalled();
  });
  it("keeps state and ID-validation failures on the failed path", async () => {
    mocks.callback.mockRejectedValue(new Error("Invalid state"));
    const response = await GET(request());
    expect(response.headers.get("Location")).toBe("/settings?chatgpt=failed");
    expect(response.headers.get("Location")).not.toContain("synthetic-code");
  });
  it("rejects a foreign host before consuming any pending attempt", async () => {
    expect((await GET(request(undefined, "attacker.test:3000"))).status).toBe(
      403,
    );
    expect(mocks.callback).not.toHaveBeenCalled();
  });
});
