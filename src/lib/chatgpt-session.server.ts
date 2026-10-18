import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { z } from "zod";
import { ProtectedLocalStore } from "./protected-local-store.server";
import {
  challenge,
  ChatGPTError,
  equalSecret,
  hasInferenceScopes,
  issuer,
  listModels,
  randomValue,
  requestedScopes,
  resource,
  safeAIError,
  tokenRequest,
  validateCallback,
  verifyIdentity,
} from "./chatgpt-protocol.server";

const credentialsSchema = z.object({
  access: z.string(),
  refresh: z.string(),
  idToken: z.string().optional(),
  expires: z.number(),
  earliestRefresh: z.number().optional(),
  scopes: z.array(z.string()),
});
const profileSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  subject: z.string().optional(),
  email: z.string().optional(),
  credentials: credentialsSchema.optional(),
  model: z.string().optional(),
  welcomed: z.boolean().default(false),
  issue: z.string().optional(),
});
const pendingSchema = z.object({
  state: z.string(),
  nonce: z.string(),
  verifier: z.string(),
  browser: z.string(),
  owner: z.string(),
  profileId: z.string().optional(),
  clientId: z.string().optional(),
  redirect: z.string(),
  expires: z.number(),
});
const accountSchema = z.object({
  provider: z.enum(["rules", "chatgpt", "openai"]).default("rules"),
  active: z.string().optional(),
  profiles: z.array(profileSchema).default([]),
  notice: z.string().optional(),
});
const storeSchema = z.object({
  hostId: z.string(),
  accounts: z.record(z.string(), accountSchema),
  pending: z.array(pendingSchema),
});
export type LocalAIStore = z.infer<typeof storeSchema>;
type Store = LocalAIStore;
type Profile = z.infer<typeof profileSchema>;
export type AIProvider = z.infer<typeof accountSchema>["provider"];
const localStore = new ProtectedLocalStore(
  resolve(process.cwd(), ".looppilot-local"),
  storeSchema.parse,
  () => ({ hostId: `urn:uuid:${randomUUID()}`, accounts: {}, pending: [] }),
);
const accountFor = (store: Store, owner: string) =>
  (store.accounts[owner] ??= { provider: "rules", profiles: [] });

// Share cancellation across independently bundled Next route modules in this process.
const runtimeRequests = globalThis as typeof globalThis & {
  loopPilotChatGPTRequests?: Map<string, Set<AbortController>>;
};
const activeRequests = (runtimeRequests.loopPilotChatGPTRequests ??= new Map<
  string,
  Set<AbortController>
>());
export function trackChatGPTRequest(profileId: string) {
  const controller = new AbortController();
  const controllers =
    activeRequests.get(profileId) ?? new Set<AbortController>();
  activeRequests.set(profileId, controllers);
  controllers.add(controller);
  return {
    signal: controller.signal,
    done: () => {
      controllers.delete(controller);
      if (!controllers.size) activeRequests.delete(profileId);
    },
  };
}

export function requireLocal(
  request: Request,
  mutation = false,
  oauthCallback = false,
) {
  const expected = new URL(
    process.env.LOOPPILOT_LOCAL_ORIGIN || "http://127.0.0.1:3000",
  );
  const url = new URL(request.url);
  if (process.env.LOOPPILOT_CHATGPT_LOCAL !== "1")
    throw new ChatGPTError(
      "local_disabled",
      "Local ChatGPT mode is disabled in this server process. Set LOOPPILOT_CHATGPT_LOCAL=1 in .env.local and restart the LoopPilot server.",
      403,
    );
  if (
    expected.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(expected.hostname)
  )
    throw new ChatGPTError(
      "invalid_local_config",
      "LOOPPILOT_LOCAL_ORIGIN must be an HTTP loopback origin, such as http://127.0.0.1:3000. Restart the server after changing it.",
      403,
    );
  // Next.js may normalize the internal Request URL to localhost even when the
  // browser used 127.0.0.1. The browser-facing Host must still match exactly;
  // accept only internal loopback aliases with the configured scheme and port.
  if (
    url.protocol !== expected.protocol ||
    url.port !== expected.port ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    request.headers.get("host") !== expected.host
  )
    throw new ChatGPTError(
      "local_origin_mismatch",
      `Open LoopPilot at ${expected.origin} using the configured host and port.`,
      403,
    );
  const origin = request.headers.get("origin");
  // The OAuth browser return is intentionally cross-site. State and the
  // HttpOnly browser binding are still required by the callback handler.
  const callbackReturn =
    oauthCallback &&
    !mutation &&
    request.method === "GET" &&
    url.pathname === "/auth/callback";
  if (
    (mutation && origin !== expected.origin) ||
    (!callbackReturn &&
      ((origin && origin !== expected.origin) ||
        request.headers.get("sec-fetch-site") === "cross-site"))
  )
    throw new ChatGPTError(
      "invalid_origin",
      "Open AI settings from your local LoopPilot window.",
      403,
    );
  return expected;
}

// Injectable transport/store/ID verifier allow offline security tests; runtime defaults
// use only the published OpenAI endpoints and protected local disk storage.
export class ChatGPTSessions {
  constructor(
    private store: Pick<ProtectedLocalStore<Store>, "transaction"> = localStore,
    private fetcher: typeof fetch = fetch,
    private verify = verifyIdentity,
  ) {}
  async begin(
    owner: string,
    browser: string,
    origin: URL,
    profileId?: string,
    reconsent = false,
  ) {
    return this.store.transaction((store) => {
      const account = accountFor(store, owner),
        profile = account.profiles.find((p) => p.id === profileId);
      if (profileId && !profile)
        throw new ChatGPTError(
          "unknown_account",
          "Choose a saved ChatGPT account.",
          400,
        );
      const pending = {
        state: randomValue(),
        nonce: randomValue(),
        verifier: randomValue(),
        browser: challenge(browser),
        owner,
        profileId,
        clientId: profile?.clientId,
        redirect: `http://127.0.0.1:${origin.port || "80"}/auth/callback`,
        expires: Date.now() + 600000,
      };
      store.pending = store.pending.filter(
        (p) => p.expires > Date.now() && p.owner !== owner,
      );
      store.pending.push(pending);
      const url = new URL(`${issuer}/api/accounts/authorize`);
      const params: Record<string, string> = {
        client_id: profile?.clientId ?? "dynamic_agent_client",
        ext_agent_host_id: store.hostId,
        response_type: "code",
        redirect_uri: pending.redirect,
        scope: requestedScopes.join(" "),
        resource,
        state: pending.state,
        nonce: pending.nonce,
        code_challenge_method: "S256",
        code_challenge: challenge(pending.verifier),
      };
      if (!profile) params.agent_name_hint = "LoopPilot";
      if (profile?.email) params.login_hint = profile.email;
      // No retained ID-token hint is sent through a browser-accessible API response.
      if (reconsent) params.prompt = "consent";
      url.search = new URLSearchParams(params).toString();
      return url.toString();
    });
  }
  async callback(params: URLSearchParams, browser: string) {
    const result = await this.store.transaction(async (store) => {
      const pending = store.pending.find(
        (p) =>
          equalSecret(p.state, params.get("state") ?? "") &&
          equalSecret(p.browser, challenge(browser)),
      );
      if (!pending)
        return new ChatGPTError(
          "invalid_state",
          "ChatGPT sign-in did not match this browser. Start again.",
          400,
        );
      store.pending = store.pending.filter((p) => p !== pending); // One time, including failures.
      const account = accountFor(store, pending.owner);
      try {
        const { code, clientId } = validateCallback(params, pending);
        let profile = account.profiles.find((p) => p.id === pending.profileId);
        if (!profile) {
          profile = { id: randomUUID(), clientId, welcomed: false };
          account.profiles.push(profile);
        }
        // Retain issued registration even if the exchange fails (including invalid_grant).
        const tokens = await tokenRequest(
          new URLSearchParams({
            grant_type: "authorization_code",
            client_id: clientId,
            code,
            code_verifier: pending.verifier,
            redirect_uri: pending.redirect,
            resource,
          }),
          this.fetcher,
        );
        if (!tokens.id_token)
          throw new ChatGPTError(
            "missing_identity",
            "ChatGPT did not return an ID token. Sign in again.",
            401,
          );
        const identity = await this.verify(
          tokens.id_token,
          clientId,
          pending.nonce,
        );
        if (profile.subject && profile.subject !== identity.subject)
          throw new ChatGPTError(
            "account_mismatch",
            "ChatGPT returned a different identity. Select the matching account.",
            401,
          );
        profile.subject = identity.subject;
        profile.email = identity.email;
        profile.credentials = {
          access: tokens.access_token ?? "",
          refresh: tokens.refresh_token ?? "",
          idToken: tokens.id_token,
          expires: Date.now() + tokens.expires_in * 1000,
          earliestRefresh: tokens.earliest_refresh_at,
          scopes: (tokens.scope ?? "").split(/\s+/).filter(Boolean),
        };
        profile.issue = undefined;
        account.active = profile.id;
        account.notice =
          hasInferenceScopes(profile.credentials.scopes) &&
          !!profile.credentials.access &&
          !!profile.credentials.refresh
            ? "ChatGPT connected. Select an available model and explicitly choose ChatGPT plan to use it."
            : "Identity connected, but required ChatGPT plan scopes were not granted. Inference is disabled. Enable plan permission or check account eligibility.";
        return null;
      } catch (error) {
        const safe = safeAIError(error);
        account.notice = safe.message;
        return safe;
      }
    });
    if (result) throw result;
  }
  private async credentials(profile: Profile) {
    const old = profile.credentials;
    if (!old)
      throw new ChatGPTError(
        "disconnected",
        "Continue with ChatGPT to connect this account.",
        401,
      );
    if (old.expires <= Date.now() + 60000) {
      if (!old.refresh) {
        profile.credentials = undefined;
        throw new ChatGPTError(
          "expired_session",
          "ChatGPT session expired without renewable access. Sign in again.",
          401,
        );
      }
      if (old.earliestRefresh && old.earliestRefresh * 1000 > Date.now())
        throw new ChatGPTError(
          "refresh_not_ready",
          "ChatGPT token renewal is not available yet. Retry later.",
        );
      try {
        const tokens = await tokenRequest(
          new URLSearchParams({
            grant_type: "refresh_token",
            client_id: profile.clientId,
            refresh_token: old.refresh,
            resource,
          }),
          this.fetcher,
        );
        if (!tokens.access_token || !tokens.refresh_token)
          throw new ChatGPTError(
            "invalid_refresh_token",
            "ChatGPT did not return replacement credentials. Sign in again.",
            401,
          );
        if (tokens.id_token) {
          const identity = await this.verify(tokens.id_token, profile.clientId);
          if (identity.subject !== profile.subject)
            throw new ChatGPTError(
              "account_mismatch",
              "ChatGPT renewal returned a different identity. Sign in again.",
              401,
            );
        }
        profile.credentials = {
          access: tokens.access_token,
          refresh: tokens.refresh_token,
          idToken: tokens.id_token ?? old.idToken,
          expires: Date.now() + tokens.expires_in * 1000,
          earliestRefresh: tokens.earliest_refresh_at,
          scopes:
            tokens.scope === undefined
              ? old.scopes
              : tokens.scope.split(/\s+/).filter(Boolean),
        };
        profile.issue = undefined;
      } catch (error) {
        const safe = safeAIError(error);
        if (safe.status === 401) profile.credentials = undefined;
        profile.issue = safe.message;
        throw safe;
      }
    }
    return profile.credentials!;
  }
  async access(owner: string) {
    const result = await this.store.transaction(async (store) => {
      const account = accountFor(store, owner),
        profile = account.profiles.find((p) => p.id === account.active);
      if (!profile)
        return new ChatGPTError(
          "disconnected",
          "Continue with ChatGPT in Settings first.",
          401,
        );
      try {
        const credentials = await this.credentials(profile);
        if (
          !hasInferenceScopes(credentials.scopes) ||
          !credentials.access ||
          !credentials.refresh
        )
          throw new ChatGPTError(
            "missing_scopes",
            "ChatGPT identity alone does not permit inference. Enable plan permission in Settings; account eligibility may restrict access.",
            403,
          );
        return {
          access: credentials.access,
          profileId: profile.id,
          clientId: profile.clientId,
          model: profile.model,
        };
      } catch (error) {
        return safeAIError(error);
      }
    });
    if (result instanceof Error) throw result;
    return result;
  }
  async status(owner: string, refresh = true) {
    if (refresh) {
      // Renew near-expiry credentials when opening Settings; never report stale as connected.
      await this.access(owner).catch(() => {});
    }
    return this.store.transaction((store) => {
      const account = accountFor(store, owner);
      return {
        provider: account.provider,
        active: account.active,
        notice: account.notice,
        profiles: account.profiles.map((p, i) => ({
          id: p.id,
          label: `Account ${i + 1}`,
          email: p.email,
          verified: !!p.subject,
          connected: !!p.credentials && p.credentials.expires > Date.now(),
          authorized:
            !!p.credentials &&
            p.credentials.expires > Date.now() &&
            !!p.credentials.access &&
            !!p.credentials.refresh &&
            hasInferenceScopes(p.credentials.scopes),
          model: p.model,
          issue: p.issue,
          welcome:
            !!p.credentials &&
            p.credentials.expires > Date.now() &&
            !!p.credentials.access &&
            !!p.credentials.refresh &&
            hasInferenceScopes(p.credentials.scopes) &&
            !p.welcomed,
        })),
      };
    });
  }
  async models(owner: string) {
    const session = await this.access(owner);
    try {
      return await listModels(session.access, this.fetcher);
    } catch (error) {
      await this.recordFailure(owner, session, error);
      throw error;
    }
  }
  async recordFailure(
    owner: string,
    session: { profileId: string; access: string },
    error: unknown,
  ) {
    if (!(error instanceof ChatGPTError)) return;
    await this.store.transaction((store) => {
      const p = accountFor(store, owner).profiles.find(
        (p) => p.id === session.profileId,
      );
      if (p?.credentials?.access === session.access) {
        p.issue = error.message;
        if (error.status === 401) p.credentials = undefined;
      }
    });
  }
  async select(
    owner: string,
    input: {
      provider?: AIProvider;
      profileId?: string;
      model?: string;
      welcomed?: boolean;
    },
  ) {
    const modelAccount = input.model
      ? (await this.status(owner, false)).active
      : undefined;
    if (input.model && input.profileId)
      throw new ChatGPTError(
        "account_changed",
        "Select the account before choosing its model.",
        400,
      );
    if (
      input.model &&
      !(await this.models(owner)).some((m) => m.slug === input.model)
    )
      throw new ChatGPTError(
        "model_unavailable",
        "Select a model from the current account’s available models.",
        400,
      );
    await this.store.transaction((store) => {
      const a = accountFor(store, owner);
      if (input.profileId) {
        if (!a.profiles.some((p) => p.id === input.profileId))
          throw new ChatGPTError(
            "unknown_account",
            "Unknown ChatGPT account.",
            400,
          );
        a.active = input.profileId;
      }
      const p = a.profiles.find((p) => p.id === a.active);
      if (input.model) {
        if (!p || a.active !== modelAccount)
          throw new ChatGPTError(
            "account_changed",
            "The account changed. Refresh models before selecting one.",
            409,
          );
        p.model = input.model;
      }
      if (input.welcomed && p) p.welcomed = true;
      if (input.provider) a.provider = input.provider;
    });
  }
  async disconnect(owner: string) {
    return this.store.transaction(async (store) => {
      const a = accountFor(store, owner),
        p = a.profiles.find((p) => p.id === a.active);
      if (p)
        for (const controller of activeRequests.get(p.id) ?? [])
          controller.abort();
      store.pending = store.pending.filter((p) => p.owner !== owner);
      let revoked = !p?.credentials?.refresh;
      try {
        if (p?.credentials?.refresh) {
          const discovery = await this.fetcher(
            `${issuer}/.well-known/openid-configuration`,
            { signal: AbortSignal.timeout(10000), redirect: "error" },
          );
          const metadata = await discovery.json();
          const endpoint = new URL(metadata.revocation_endpoint);
          if (metadata.issuer !== issuer || endpoint.origin !== issuer)
            throw new Error();
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const response = await this.fetcher(endpoint, {
                method: "POST",
                body: new URLSearchParams({
                  token: p.credentials.refresh,
                  token_type_hint: "refresh_token",
                  client_id: p.clientId,
                }),
                signal: AbortSignal.timeout(10000),
                redirect: "error",
              });
              if (response.status === 200) {
                revoked = true;
                break;
              }
              if (response.status < 500) break;
            } catch {
              /* bounded retry */
            }
            if (!attempt) await new Promise((r) => setTimeout(r, 250));
          }
        }
      } catch {
        /* clear local tokens even when remote revocation is unavailable */
      } finally {
        if (p) {
          p.credentials = undefined;
          p.issue = undefined;
        }
      }
      a.notice = revoked
        ? "ChatGPT disconnected. Local credentials cleared."
        : "Local credentials cleared; remote revocation was not confirmed. Disconnect LoopPilot in ChatGPT Settings → Usage.";
      return { revoked, notice: a.notice };
    });
  }
}
export const chatgptSessions = new ChatGPTSessions();
