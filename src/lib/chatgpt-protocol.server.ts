import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { z } from "zod";

export const issuer = "https://auth.openai.com";
export const resource = "https://api.openai.com/v1";
export const requestedScopes = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "resource.invoke",
  "chatgpt.tokens.use.direct",
];
export const usageUrl = "https://chatgpt.com/settings/usage";
export class ChatGPTError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 503,
  ) {
    super(message);
  }
}
export function safeAIError(error: unknown) {
  return error instanceof ChatGPTError
    ? error
    : new ChatGPTError(
        "unavailable",
        "AI coaching is temporarily unavailable. Your rule-based schedule is ready.",
      );
}
export function apiFailure(status: number, code?: string) {
  if (code === "subscription_sharing_usage_limit_exceeded") status = 429;
  if (code === "subscription_sharing_user_not_eligible") status = 403;
  if (code === "subscription_sharing_invalid_user") status = 401;
  const message =
    code === "subscription_sharing_usage_limit_exceeded" || status === 429
      ? "ChatGPT usage limit reached. Review your plan or this app’s limit in Manage usage. No paid API fallback was used."
      : code === "subscription_sharing_user_not_eligible"
        ? "ChatGPT plan usage is unavailable for this account, workspace, or policy."
        : status === 401
          ? "ChatGPT authentication was not accepted. Sign in again to the selected account."
          : status === 403
            ? "ChatGPT plan access is restricted by permission, policy, or serving region. Check the selected account and grant."
            : code === "model_not_found" ||
                code === "subscription_sharing_unsupported_capability"
              ? "The selected model or request capability is unavailable. Refresh available models in Settings."
              : "ChatGPT usage is temporarily unavailable. Keep the rule-based schedule and retry later.";
  return new ChatGPTError(code ?? `http_${status}`, message, status);
}
export async function checked(response: Response) {
  if (response.ok) return response;
  const body = await response.json().catch(() => null);
  // Never forward upstream diagnostic text, headers, or credentials to the browser.
  throw apiFailure(
    response.status,
    typeof body?.error?.code === "string" ? body.error.code : undefined,
  );
}
export const randomValue = () => randomBytes(32).toString("base64url");
export const challenge = (verifier: string) =>
  createHash("sha256").update(verifier).digest("base64url");
export function equalSecret(a: string, b: string) {
  return (
    a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}
export function hasInferenceScopes(scopes: string[]) {
  return requestedScopes.every((scope) => scopes.includes(scope));
}
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
export async function verifyIdentity(
  token: string,
  clientId: string,
  nonce?: string,
  keys: JWTVerifyGetKey = jwks,
) {
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer,
      audience: clientId,
      algorithms: ["RS256", "ES256"],
      requiredClaims: ["sub", "exp", "iat"],
      clockTolerance: 5,
    });
    if (
      !payload.sub ||
      (payload.azp !== undefined && payload.azp !== clientId) ||
      (Array.isArray(payload.aud) &&
        payload.aud.length > 1 &&
        payload.azp !== clientId) ||
      (nonce !== undefined &&
        (typeof payload.nonce !== "string" ||
          !equalSecret(payload.nonce, nonce)))
    )
      throw new Error();
    return {
      issuer,
      subject: payload.sub,
      email: typeof payload.email === "string" ? payload.email : undefined,
    };
  } catch {
    throw new ChatGPTError(
      "invalid_identity",
      "ChatGPT identity validation failed. Start a fresh sign-in.",
      401,
    );
  }
}
export const tokenSchema = z.object({
  access_token: z.string().min(1).optional(),
  refresh_token: z.string().min(1).optional(),
  id_token: z.string().optional(),
  token_type: z.string().regex(/^bearer$/i),
  expires_in: z.number().positive().max(86400),
  scope: z.string().optional(),
  earliest_refresh_at: z.number().optional(),
});
export async function tokenRequest(
  form: URLSearchParams,
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher(`${issuer}/api/accounts/oauth/token`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const code =
      typeof body?.error === "string" ? body.error : body?.error?.code;
    const terminal = [
      "invalid_grant",
      "invalid_refresh_token",
      "token_expired",
      "refresh_token_expired",
      "refresh_token_invalidated",
      "refresh_token_reused",
      "invalid_client",
    ].includes(code);
    throw new ChatGPTError(
      terminal ? code : "token_unavailable",
      terminal
        ? "ChatGPT session needs a fresh sign-in."
        : "ChatGPT token renewal is temporarily unavailable. Retry later.",
      terminal ? 401 : 503,
    );
  }
  return tokenSchema.parse(body);
}
export function validateCallback(
  params: URLSearchParams,
  pending: { state: string; clientId?: string; expires: number },
  now = Date.now(),
) {
  if (
    pending.expires < now ||
    !equalSecret(params.get("state") ?? "", pending.state)
  )
    throw new ChatGPTError(
      "invalid_state",
      "ChatGPT sign-in expired or state did not match. Start again.",
      400,
    );
  if (params.has("error"))
    throw new ChatGPTError(
      "authorization_declined",
      "ChatGPT authorization was declined or unavailable. Your previous connection is unchanged.",
      400,
    );
  const clientId = params.get("client_id") ?? pending.clientId;
  if (
    !clientId ||
    clientId === "dynamic_agent_client" ||
    (pending.clientId && clientId !== pending.clientId) ||
    !params.get("code")
  )
    throw new ChatGPTError(
      "invalid_registration",
      "ChatGPT registration was incomplete or changed the selected client. Start again.",
      400,
    );
  return { clientId, code: params.get("code")! };
}
export const modelCatalogSchema = z.object({
  models: z.array(
    z.object({
      slug: z.string().min(1).max(200),
      display_name: z.string().max(200),
      visibility: z.string(),
    }),
  ),
});
export async function listModels(
  accessToken: string,
  fetcher: typeof fetch = fetch,
) {
  const response = await checked(
    await fetcher(`${resource}/models`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15000),
      redirect: "error",
      cache: "no-store",
    }),
  );
  return modelCatalogSchema
    .parse(await response.json())
    .models.filter((m) => m.visibility === "list")
    .map(({ slug, display_name }) => ({ slug, display_name }));
}

// Only the completed event is authoritative. Deltas, [DONE], EOF and output_text.done
// cannot turn partial content into a successful coaching result.
export async function completedStream(response: Response): Promise<unknown> {
  await checked(response);
  if (!response.body)
    throw new ChatGPTError("incomplete_stream", "ChatGPT returned no stream.");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) throw new Error("Stream too large");
      buffer += decoder.decode(value, { stream: true });
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const block = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const data = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data || data === "[DONE]") continue;
        const event = JSON.parse(data);
        if (event.type === "response.failed" || event.type === "error")
          throw apiFailure(
            503,
            event.response?.error?.code ?? event.error?.code ?? event.code,
          );
        if (event.type === "response.incomplete")
          throw new ChatGPTError(
            "incomplete_response",
            "ChatGPT returned incomplete coaching. Nothing was saved.",
          );
        if (event.type === "response.completed") {
          if (event.response?.status !== "completed") throw new Error();
          return event.response;
        }
      }
    }
    throw new ChatGPTError(
      "incomplete_stream",
      "ChatGPT connection ended before completed coaching. Nothing was saved.",
    );
  } catch (error) {
    throw safeAIError(error);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
