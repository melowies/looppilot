import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { mkdir, mkdtemp, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  challenge,
  completedStream,
  hasInferenceScopes,
  issuer,
  requestedScopes,
  resource,
  validateCallback,
  verifyIdentity,
} from "../src/lib/chatgpt-protocol.server";
import {
  ChatGPTSessions,
  requireLocal,
  trackChatGPTRequest,
  type LocalAIStore,
} from "../src/lib/chatgpt-session.server";
import { ProtectedLocalStore } from "../src/lib/protected-local-store.server";
import { requestSelectedCoach } from "../src/lib/coach-provider.server";
import type { CoachSummary } from "../src/lib/planner-coach";

let key: Awaited<ReturnType<typeof generateKeyPair>>,
  keys: ReturnType<typeof createLocalJWKSet>;
beforeAll(async () => {
  key = await generateKeyPair("RS256");
  keys = createLocalJWKSet({
    keys: [{ ...(await exportJWK(key.publicKey)), kid: "test" }],
  });
});
async function idToken(nonce: string, overrides: Record<string, unknown> = {}) {
  return new SignJWT({ nonce, email: "test@example.test", ...overrides })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer(issuer)
    .setAudience("oaiapp_test")
    .setSubject("subject")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key.privateKey);
}
const verify = (token: string, client: string, nonce?: string) =>
  verifyIdentity(token, client, nonce, keys);
const origin = new URL("http://127.0.0.1:3000");
const owner = "supabase-user";
function memory(initial?: LocalAIStore) {
  let value: LocalAIStore = initial ?? {
      hostId: "urn:uuid:host",
      accounts: {},
      pending: [],
    },
    queue = Promise.resolve();
  return {
    get value() {
      return value;
    },
    transaction<R>(
      operation: (value: LocalAIStore) => Promise<R> | R,
    ): Promise<R> {
      const run = queue.then(async () => {
        const draft = structuredClone(value);
        const result = await operation(draft);
        value = draft;
        return result;
      });
      queue = run.then(
        () => {},
        () => {},
      );
      return run;
    },
  };
}
function setup(scopes = requestedScopes.join(" ")) {
  const store = memory();
  const fetcher = vi.fn<typeof fetch>();
  const sessions = new ChatGPTSessions(store, fetcher, verify);
  async function connect() {
    const url = new URL(await sessions.begin(owner, "browser", origin));
    fetcher.mockResolvedValueOnce(
      Response.json({
        access_token: "secret-access",
        refresh_token: "secret-refresh",
        id_token: await idToken(url.searchParams.get("nonce")!),
        token_type: "Bearer",
        scope: scopes,
        expires_in: 3600,
      }),
    );
    const callback = new URLSearchParams({
      state: url.searchParams.get("state")!,
      code: "authorization-code",
      client_id: "oaiapp_test",
    });
    await sessions.callback(callback, "browser");
    return { url, callback };
  }
  return { store, fetcher, sessions, connect };
}
const summary = {
  phase: "Foundations",
  recordedAttempts: 0,
  failedAttempts: 0,
  assistedAttempts: 0,
  sessions: [{ key: "real-session", category: "coding" }],
} as CoachSummary;
const choice = {
  focus_keys: ["real-session"],
  approach: "independent_first",
  difficulty: "maintain",
  pacing: "steady",
};
function sse(events: unknown[], tail = "") {
  const bytes = new TextEncoder().encode(
    events.map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`).join("") +
      tail,
  );
  // Deliberately split UTF-8 and SSE delimiters across arbitrary network chunks.
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 7)
          controller.enqueue(bytes.slice(i, i + 7));
        controller.close();
      },
    }),
  );
}
const complete = (text = JSON.stringify(choice)) => ({
  type: "response.completed",
  response: {
    status: "completed",
    output: [{ content: [{ type: "output_text", text }] }],
  },
});

describe("official OAuth security", () => {
  it("uses fresh state/nonce, S256 PKCE, stable host and the exact loopback redirect", async () => {
    const { sessions, store } = setup();
    const first = new URL(await sessions.begin(owner, "browser", origin));
    const pending = store.value.pending[0];
    expect(first.origin + first.pathname).toBe(
      `${issuer}/api/accounts/authorize`,
    );
    expect(first.searchParams.get("client_id")).toBe("dynamic_agent_client");
    expect(first.searchParams.get("agent_name_hint")).toBe("LoopPilot");
    expect(first.searchParams.get("code_challenge")).toBe(
      challenge(pending.verifier),
    );
    expect(first.searchParams.get("code_challenge_method")).toBe("S256");
    expect(first.searchParams.get("scope")?.split(" ")).toEqual(
      requestedScopes,
    );
    expect(first.searchParams.get("redirect_uri")).toBe(
      "http://127.0.0.1:3000/auth/callback",
    );
    const second = new URL(await sessions.begin(owner, "browser", origin));
    expect(second.searchParams.get("ext_agent_host_id")).toBe(
      first.searchParams.get("ext_agent_host_id"),
    );
    expect(second.searchParams.get("state")).not.toBe(
      first.searchParams.get("state"),
    );
    expect(second.searchParams.get("nonce")).not.toBe(
      first.searchParams.get("nonce"),
    );
  });
  it("rejects mismatched/expired state, incomplete registration and changed client IDs", () => {
    const pending = { state: "expected", expires: Date.now() + 1000 };
    for (const params of [
      { state: "wrong", code: "x", client_id: "oaiapp_test" },
      { state: "expected", code: "x" },
      { state: "expected", error: "access_denied" },
    ])
      expect(() =>
        validateCallback(
          new URLSearchParams(
            Object.entries(params).filter(
              (entry): entry is [string, string] =>
                typeof entry[1] === "string",
            ),
          ),
          pending,
        ),
      ).toThrow();
    expect(() =>
      validateCallback(
        new URLSearchParams({
          state: "expected",
          code: "x",
          client_id: "other",
        }),
        { ...pending, clientId: "oaiapp_test" },
      ),
    ).toThrow();
    expect(() =>
      validateCallback(
        new URLSearchParams({
          state: "expected",
          code: "x",
          client_id: "oaiapp_test",
        }),
        { ...pending, expires: 0 },
      ),
    ).toThrow();
  });
  it("validates real JWT signatures, issuer, audience, expiry and nonce", async () => {
    const token = await idToken("nonce");
    expect(await verify(token, "oaiapp_test", "nonce")).toMatchObject({
      subject: "subject",
      email: "test@example.test",
    });
    await expect(verify(token, "wrong-client", "nonce")).rejects.toThrow();
    await expect(verify(token, "oaiapp_test", "wrong-nonce")).rejects.toThrow();
    const wrongIssuer = await new SignJWT({ nonce: "nonce" })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setIssuer("https://attacker.test")
      .setAudience("oaiapp_test")
      .setSubject("subject")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(key.privateKey);
    await expect(verify(wrongIssuer, "oaiapp_test", "nonce")).rejects.toThrow();
    const expired = await new SignJWT({ nonce: "nonce" })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setIssuer(issuer)
      .setAudience("oaiapp_test")
      .setSubject("subject")
      .setIssuedAt()
      .setExpirationTime(1)
      .sign(key.privateKey);
    await expect(verify(expired, "oaiapp_test", "nonce")).rejects.toThrow();
    const pieces = token.split(".");
    pieces[1] = Buffer.from(JSON.stringify({ sub: "attacker" })).toString(
      "base64url",
    );
    await expect(
      verify(pieces.join("."), "oaiapp_test", "nonce"),
    ).rejects.toThrow();
  });
  it("binds callbacks to their initiating browser and consumes them once", async () => {
    const { sessions, fetcher, connect } = setup();
    const { callback } = await connect();
    await expect(sessions.callback(callback, "browser")).rejects.toThrow();
    const url = new URL(await sessions.begin(owner, "browser", origin));
    await expect(
      sessions.callback(
        new URLSearchParams({
          state: url.searchParams.get("state")!,
          code: "x",
          client_id: "oaiapp_test",
        }),
        "other-browser",
      ),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("exchanges the issued client, exact redirect and verifier; reuses registrations", async () => {
    const { sessions, fetcher, store, connect } = setup();
    const { url } = await connect();
    const form = fetcher.mock.calls[0][1]!.body as URLSearchParams;
    expect(form.get("client_id")).toBe("oaiapp_test");
    expect(form.get("redirect_uri")).toBe(url.searchParams.get("redirect_uri"));
    expect(challenge(form.get("code_verifier")!)).toBe(
      url.searchParams.get("code_challenge"),
    );
    const profile = store.value.accounts[owner].profiles[0];
    const returning = new URL(
      await sessions.begin(owner, "browser", origin, profile.id),
    );
    expect(returning.searchParams.get("client_id")).toBe("oaiapp_test");
    expect(returning.searchParams.has("agent_name_hint")).toBe(false);
    expect(returning.searchParams.has("id_token_hint")).toBe(false);
  });
  it("retains issued client on exchange failure without activating an unverified account", async () => {
    const { sessions, fetcher, store } = setup();
    const url = new URL(await sessions.begin(owner, "browser", origin));
    fetcher.mockResolvedValueOnce(
      Response.json({ error: "invalid_grant" }, { status: 400 }),
    );
    await expect(
      sessions.callback(
        new URLSearchParams({
          state: url.searchParams.get("state")!,
          code: "x",
          client_id: "oaiapp_test",
        }),
        "browser",
      ),
    ).rejects.toThrow();
    expect(store.value.accounts[owner].profiles[0].clientId).toBe(
      "oaiapp_test",
    );
    expect(store.value.accounts[owner].active).toBeUndefined();
  });
  it("requires actual granted identity and inference scopes, not callback scope claims", async () => {
    expect(hasInferenceScopes(requestedScopes)).toBe(true);
    for (const missing of requestedScopes)
      expect(
        hasInferenceScopes(requestedScopes.filter((s) => s !== missing)),
      ).toBe(false);
    const { sessions, connect, fetcher } = setup("openid email profile");
    await connect();
    expect((await sessions.status(owner)).profiles[0]).toMatchObject({
      connected: true,
      authorized: false,
    });
    await expect(sessions.models(owner)).rejects.toThrow(/identity alone/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("local session lifecycle", () => {
  it("retains a validated identity without renewable credentials but disables plan use", async () => {
    const { sessions, store, fetcher } = setup();
    const url = new URL(await sessions.begin(owner, "browser", origin));
    fetcher.mockResolvedValueOnce(
      Response.json({
        id_token: await idToken(url.searchParams.get("nonce")!),
        token_type: "Bearer",
        scope: "openid email profile",
        expires_in: 3600,
      }),
    );
    await sessions.callback(
      new URLSearchParams({
        state: url.searchParams.get("state")!,
        client_id: "oaiapp_test",
        code: "code",
      }),
      "browser",
    );
    expect((await sessions.status(owner)).profiles[0]).toMatchObject({
      connected: true,
      authorized: false,
    });
    expect(store.value.accounts[owner].profiles[0].subject).toBe("subject");
    await expect(sessions.models(owner)).rejects.toThrow();
    expect((await sessions.disconnect(owner)).revoked).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("preserves the active account when returning OAuth validates a different identity", async () => {
    const { sessions, store, fetcher, connect } = setup();
    await connect();
    const before = structuredClone(store.value.accounts[owner].profiles[0]);
    const url = new URL(
      await sessions.begin(owner, "browser", origin, before.id),
    );
    const wrong = await new SignJWT({ nonce: url.searchParams.get("nonce")! })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setIssuer(issuer)
      .setAudience("oaiapp_test")
      .setSubject("other-subject")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(key.privateKey);
    fetcher.mockResolvedValueOnce(
      Response.json({
        access_token: "different",
        refresh_token: "different",
        id_token: wrong,
        token_type: "Bearer",
        scope: requestedScopes.join(" "),
        expires_in: 3600,
      }),
    );
    await expect(
      sessions.callback(
        new URLSearchParams({
          state: url.searchParams.get("state")!,
          code: "code",
        }),
        "browser",
      ),
    ).rejects.toThrow(/different identity/);
    expect(store.value.accounts[owner].profiles[0]).toEqual(before);
  });
  it("cancels in-flight inference when disconnecting the selected profile", async () => {
    const { sessions, store, fetcher, connect } = setup();
    await connect();
    const tracked = trackChatGPTRequest(store.value.accounts[owner].active!);
    fetcher.mockRejectedValueOnce(new Error("network"));
    await sessions.disconnect(owner);
    expect(tracked.signal.aborted).toBe(true);
    tracked.done();
  });
  it("serializes refreshes, persists rotated tokens and omits scope on refresh", async () => {
    const { sessions, connect, fetcher, store } = setup();
    await connect();
    store.value.accounts[owner].profiles[0].credentials!.expires = 0;
    fetcher.mockResolvedValueOnce(
      Response.json({
        access_token: "new-access",
        refresh_token: "new-refresh",
        token_type: "Bearer",
        expires_in: 3600,
      }),
    );
    const results = await Promise.all([
      sessions.access(owner),
      sessions.access(owner),
      sessions.access(owner),
    ]);
    expect(results.every((r) => r.access === "new-access")).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const form = fetcher.mock.calls[1][1]!.body as URLSearchParams;
    expect(Object.fromEntries(form)).toEqual({
      grant_type: "refresh_token",
      client_id: "oaiapp_test",
      refresh_token: "secret-refresh",
      resource,
    });
    expect(store.value.accounts[owner].profiles[0].credentials).toMatchObject({
      access: "new-access",
      refresh: "new-refresh",
      scopes: requestedScopes,
    });
    expect(JSON.stringify(await sessions.status(owner))).not.toMatch(
      /secret-access|secret-refresh|new-access|new-refresh|idToken/,
    );
    expect((await sessions.status("other-user")).profiles).toEqual([]);
  });
  it("clears terminal refresh failures but preserves temporary failures and never reports expired connected", async () => {
    for (const terminal of [false, true]) {
      const { sessions, connect, fetcher, store } = setup();
      await connect();
      store.value.accounts[owner].profiles[0].credentials!.expires = 0;
      fetcher.mockResolvedValueOnce(
        Response.json(
          { error: terminal ? "invalid_grant" : "temporarily_unavailable" },
          { status: terminal ? 400 : 503 },
        ),
      );
      await expect(sessions.access(owner)).rejects.toThrow();
      expect(!!store.value.accounts[owner].profiles[0].credentials).toBe(
        !terminal,
      );
      expect((await sessions.status(owner, false)).profiles[0].connected).toBe(
        false,
      );
    }
  });
  it("honors earliest_refresh_at instead of renewing too early", async () => {
    const { sessions, connect, fetcher, store } = setup();
    await connect();
    Object.assign(store.value.accounts[owner].profiles[0].credentials!, {
      expires: 0,
      earliestRefresh: Date.now() / 1000 + 600,
    });
    await expect(sessions.access(owner)).rejects.toThrow(/not available yet/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("discovers only visible model slugs and rejects unavailable selections", async () => {
    const { sessions, connect, fetcher } = setup();
    await connect();
    const models = {
      models: [
        {
          slug: "actual-model",
          display_name: "Available model",
          visibility: "list",
        },
        { slug: "hidden", display_name: "Hidden", visibility: "hide" },
      ],
    };
    fetcher.mockImplementation(async () => Response.json(models));
    expect(await sessions.models(owner)).toEqual([
      { slug: "actual-model", display_name: "Available model" },
    ]);
    await expect(
      sessions.select(owner, { model: "invented" }),
    ).rejects.toThrow();
    await sessions.select(owner, { model: "actual-model" });
    expect((await sessions.access(owner)).model).toBe("actual-model");
  });
  it("revokes the refresh token through discovery and clears local credentials while preserving registration", async () => {
    const { sessions, connect, fetcher, store } = setup();
    await connect();
    const profile = store.value.accounts[owner].profiles[0];
    await sessions.begin(owner, "browser", origin, profile.id);
    fetcher
      .mockResolvedValueOnce(
        Response.json({ issuer, revocation_endpoint: `${issuer}/revoke` }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    expect((await sessions.disconnect(owner)).revoked).toBe(true);
    expect(
      Object.fromEntries(fetcher.mock.calls[2][1]!.body as URLSearchParams),
    ).toEqual({
      token: "secret-refresh",
      token_type_hint: "refresh_token",
      client_id: "oaiapp_test",
    });
    expect(store.value.pending).toEqual([]);
    expect(store.value.accounts[owner].profiles[0]).toMatchObject({
      clientId: "oaiapp_test",
      subject: "subject",
    });
    expect(store.value.accounts[owner].profiles[0].credentials).toBeUndefined();
  });
  it("clears credentials and reports unconfirmed revocation on network failure", async () => {
    const { sessions, connect, fetcher, store } = setup();
    await connect();
    fetcher.mockRejectedValueOnce(new Error("network secret"));
    expect(await sessions.disconnect(owner)).toMatchObject({
      revoked: false,
      notice: expect.stringContaining("not confirmed"),
    });
    expect(store.value.accounts[owner].profiles[0].credentials).toBeUndefined();
  });
  it("uses real protected files and an inter-instance lock without plaintext Windows tokens", async () => {
    await mkdir(resolve("artifacts"), { recursive: true });
    const directory = await mkdtemp(resolve("artifacts", "chatgpt-store-"));
    type Record = { count: number; token: string };
    const make = () =>
      new ProtectedLocalStore<Record>(
        directory,
        (raw) => raw as Record,
        () => ({ count: 0, token: "private-test-token" }),
      );
    await Promise.all(
      [make(), make(), make()].map((store) =>
        store.transaction(async (value) => {
          await new Promise((r) => setTimeout(r, 20));
          value.count++;
        }),
      ),
    );
    expect(await make().transaction((value) => value.count)).toBe(3);
    const file = (await readdir(directory)).find((f) =>
      f.startsWith("sessions."),
    )!;
    if (process.platform === "win32")
      expect(await readFile(resolve(directory, file), "utf8")).not.toContain(
        "private-test-token",
      );
  });
  afterEach(() => vi.unstubAllEnvs());
  it("allows cross-site OAuth GET returns only on the callback while retaining ordinary route protections", () => {
    vi.stubEnv("LOOPPILOT_CHATGPT_LOCAL", "1");
    vi.stubEnv("LOOPPILOT_LOCAL_ORIGIN", origin.origin);
    const returned = new Request("http://localhost:3000/auth/callback", {
      headers: { host: "127.0.0.1:3000", "sec-fetch-site": "cross-site" },
    });
    expect(() => requireLocal(returned, false, true)).not.toThrow();
    expect(() => requireLocal(returned)).toThrow();
    const settings = new Request("http://localhost:3000/api/ai/settings", {
      headers: { host: "127.0.0.1:3000", "sec-fetch-site": "cross-site" },
    });
    expect(() => requireLocal(settings, false, true)).toThrow();
    const post = new Request(returned, { method: "POST" });
    expect(() => requireLocal(post, true, true)).toThrow();
  });
  it("accepts Next.js internal loopback normalization while enforcing the browser host, origin, scheme and port", () => {
    vi.stubEnv("LOOPPILOT_CHATGPT_LOCAL", "1");
    vi.stubEnv("LOOPPILOT_LOCAL_ORIGIN", origin.origin);
    const request = (
      url = "http://localhost:3000/api/ai/settings",
      host = "127.0.0.1:3000",
      browserOrigin = origin.origin,
    ) =>
      new Request(url, {
        method: "POST",
        headers: { host, origin: browserOrigin },
      });
    expect(() => requireLocal(request(), true)).not.toThrow();
    expect(() =>
      requireLocal(request(undefined, "localhost:3000"), true),
    ).toThrow();
    expect(() =>
      requireLocal(
        request(undefined, undefined, "http://localhost:3000"),
        true,
      ),
    ).toThrow();
    expect(() =>
      requireLocal(request("http://localhost:3001/api/ai/settings"), true),
    ).toThrow();
    expect(() =>
      requireLocal(request("https://localhost:3000/api/ai/settings"), true),
    ).toThrow();
    expect(() =>
      requireLocal(request("http://attacker.test:3000/api/ai/settings"), true),
    ).toThrow();
  });
  it("rejects cross-origin, remote and disabled local management requests", () => {
    vi.stubEnv("LOOPPILOT_CHATGPT_LOCAL", "1");
    vi.stubEnv("LOOPPILOT_LOCAL_ORIGIN", origin.origin);
    const req = (host: string, originHeader = origin.origin) =>
      new Request(`${origin.origin}/api/ai/settings`, {
        method: "POST",
        headers: { host, origin: originHeader },
      });
    expect(() => requireLocal(req("127.0.0.1:3000"), true)).not.toThrow();
    expect(() => requireLocal(req("attacker.test"), true)).toThrow();
    expect(() =>
      requireLocal(req("127.0.0.1:3000", "https://attacker.test"), true),
    ).toThrow();
    vi.stubEnv("LOOPPILOT_CHATGPT_LOCAL", "0");
    expect(() => requireLocal(req("127.0.0.1:3000"), true)).toThrow();
  });
});

describe("completed inference and explicit provider separation", () => {
  it("accepts only completed streaming structured output and sends the selected slug without unsupported fields", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        sse([
          { type: "response.output_text.delta", delta: "ignore incomplete" },
          complete(),
        ]),
      );
    expect(
      await requestSelectedCoach(
        summary,
        { kind: "chatgpt", accessToken: "oauth-token", model: "catalog-slug" },
        fetcher,
      ),
    ).toEqual(choice);
    const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
    expect(body).toMatchObject({
      model: "catalog-slug",
      store: false,
      stream: true,
    });
    expect(Array.isArray(body.input)).toBe(true);
    expect(body.text.format.strict).toBe(true);
    for (const field of [
      "max_output_tokens",
      "temperature",
      "previous_response_id",
      "metadata",
      "background",
      "conversation",
    ])
      expect(body).not.toHaveProperty(field);
    expect(fetcher.mock.calls[0][1]!.headers).toMatchObject({
      Authorization: "Bearer oauth-token",
    });
  });
  it("rejects interrupted streams, incomplete events, refusals, malformed JSON and invented sessions", async () => {
    for (const events of [
      [],
      [{ type: "response.output_text.delta", delta: JSON.stringify(choice) }],
      [{ type: "response.incomplete", response: { status: "incomplete" } }],
      [complete("not JSON")],
      [complete("{}")],
      [complete(JSON.stringify({ ...choice, focus_keys: ["invented"] }))],
      [{ type: "response.completed", response: { status: "incomplete" } }],
    ]) {
      await expect(
        requestSelectedCoach(
          summary,
          { kind: "chatgpt", accessToken: "oauth", model: "slug" },
          vi.fn().mockResolvedValue(sse(events)),
        ),
      ).rejects.toThrow();
    }
    const broken = new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error("socket lost"));
        },
      }),
    );
    await expect(completedStream(broken)).rejects.toThrow();
  });
  it("handles usage-limit and authentication failures without any paid-provider fallback", async () => {
    vi.stubEnv("OPENAI_API_KEY", "paid-key-must-not-be-used");
    for (const response of [
      Response.json(
        { error: { code: "subscription_sharing_usage_limit_exceeded" } },
        { status: 429 },
      ),
      Response.json({ detail: "private diagnostic" }, { status: 401 }),
      sse([
        {
          type: "response.failed",
          response: {
            error: { code: "subscription_sharing_usage_limit_exceeded" },
          },
        },
      ]),
      Response.json(
        { error: { code: "subscription_sharing_user_not_eligible" } },
        { status: 403 },
      ),
    ]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
      await expect(
        requestSelectedCoach(
          summary,
          { kind: "chatgpt", accessToken: "oauth", model: "slug" },
          fetcher,
        ),
      ).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0][1]!.headers).toMatchObject({
        Authorization: "Bearer oauth",
      });
    }
    vi.unstubAllEnvs();
  });
  it("uses no network for rule-based planning and only the API key for explicit API mode", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(complete().response));
    await expect(
      requestSelectedCoach(summary, { kind: "rules" }, fetcher),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    expect(
      await requestSelectedCoach(
        summary,
        { kind: "openai", apiKey: "explicit-api-key", model: "api-model" },
        fetcher,
      ),
    ).toEqual(choice);
    expect(fetcher.mock.calls[0][1]!.headers).toMatchObject({
      Authorization: "Bearer explicit-api-key",
    });
    expect(
      JSON.parse(fetcher.mock.calls[0][1]!.body as string),
    ).not.toHaveProperty("stream");
  });
});
