import { z } from "zod";
import { authenticatedAIUser } from "@/lib/ai-route-auth.server";
import { chatgptSessions, requireLocal } from "@/lib/chatgpt-session.server";
import {
  randomValue,
  safeAIError,
  usageUrl,
} from "@/lib/chatgpt-protocol.server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (value: object, status = 200, extra?: HeadersInit) =>
  Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      ...extra,
    },
  });
export async function GET(request: Request) {
  try {
    requireLocal(request);
    const { user } = await authenticatedAIUser(request);
    return reply({
      ...(await chatgptSessions.status(user.id)),
      usageUrl,
      apiConfigured: !!process.env.OPENAI_API_KEY,
    });
  } catch (error) {
    const e = safeAIError(error);
    return reply({ error: e.message, code: e.code }, e.status);
  }
}
const commandSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("connect"),
      profileId: z.string().optional(),
      reconsent: z.boolean().optional(),
    })
    .strict(),
  z.object({ action: z.literal("models") }).strict(),
  z.object({ action: z.literal("disconnect") }).strict(),
  z
    .object({
      action: z.literal("select"),
      provider: z.enum(["rules", "chatgpt", "openai"]).optional(),
      profileId: z.string().optional(),
      model: z.string().min(1).max(200).optional(),
      welcomed: z.boolean().optional(),
    })
    .strict(),
]);
export async function POST(request: Request) {
  try {
    const origin = requireLocal(request, true);
    const { user } = await authenticatedAIUser(request);
    const body = commandSchema.parse(await request.json());
    if (body.action === "connect") {
      // Callback always uses 127.0.0.1. Require the same host for the HttpOnly binding.
      if (origin.hostname !== "127.0.0.1")
        return reply(
          {
            error:
              "Open LoopPilot at http://127.0.0.1 with the configured port before connecting ChatGPT.",
          },
          400,
        );
      const browser = randomValue();
      const url = await chatgptSessions.begin(
        user.id,
        browser,
        origin,
        body.profileId,
        body.reconsent,
      );
      return reply({ url }, 200, {
        "Set-Cookie": `looppilot-oauth=${browser}; HttpOnly; SameSite=Lax; Path=/auth/callback; Max-Age=600`,
      });
    }
    if (body.action === "models")
      return reply({ models: await chatgptSessions.models(user.id) });
    if (body.action === "disconnect")
      return reply(await chatgptSessions.disconnect(user.id));
    await chatgptSessions.select(user.id, body);
    return reply({
      ...(await chatgptSessions.status(user.id, false)),
      usageUrl,
      apiConfigured: !!process.env.OPENAI_API_KEY,
    });
  } catch (error) {
    const e = safeAIError(error);
    return reply({ error: e.message, code: e.code }, e.status);
  }
}
