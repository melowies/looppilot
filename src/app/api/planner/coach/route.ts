import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { localDate, type Data } from "@/lib/domain";
import { dayPlanSchema, plannerConfigSchema } from "@/lib/adaptive-types";
import {
  coachingSummary,
  renderCoaching,
  validateCoachChoice,
} from "@/lib/planner-coach";
import {
  chatgptSessions,
  requireLocal,
  trackChatGPTRequest,
} from "@/lib/chatgpt-session.server";
import { ChatGPTError, safeAIError } from "@/lib/chatgpt-protocol.server";
import { requestSelectedCoach } from "@/lib/coach-provider.server";

export const runtime = "nodejs";
export const maxDuration = 120;
const reply = (value: object, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const authorization = request.headers.get("authorization") ?? "";
  if (!url || !key || !authorization.startsWith("Bearer "))
    return reply({ error: "Authentication required." }, 401);
  const db = createClient(url, key, {
    global: { headers: { Authorization: authorization } },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const {
    data: { user },
    error: authError,
  } = await db.auth.getUser(authorization.slice(7));
  if (authError || !user)
    return reply({ error: "Authentication required." }, 401);
  try {
    requireLocal(request, true);
    const stateResult = await db
      .from("planner_state")
      .select("config,revision")
      .eq("user_id", user.id)
      .single();
    if (stateResult.error)
      throw new Error("Save availability before requesting coaching.");
    const config = plannerConfigSchema.parse(stateResult.data.config);
    if (!config.aiConsent)
      return reply(
        {
          error:
            "OpenAI coaching is off. Enable it in availability settings to share a structured summary.",
        },
        403,
      );
    const selection = await chatgptSessions.status(user.id, false);
    if (selection.provider === "rules")
      throw new ChatGPTError(
        "rules_selected",
        "Rule-based planning is selected. Choose an AI provider in Settings for optional coaching.",
        409,
      );
    const chatgpt =
      selection.provider === "chatgpt"
        ? await chatgptSessions.access(user.id)
        : null;
    const model = chatgpt
      ? chatgpt.model
      : process.env.OPENAI_PLANNER_MODEL || "gpt-4o-mini";
    if (!model)
      throw new ChatGPTError(
        "model_required",
        "Select an available ChatGPT model in Settings.",
        409,
      );
    if (selection.provider === "openai" && !process.env.OPENAI_API_KEY)
      throw new ChatGPTError(
        "api_key_missing",
        "OpenAI API provider requires OPENAI_API_KEY and separate API billing. No other provider was used.",
        503,
      );
    const provider = chatgpt
      ? { kind: "chatgpt" as const, accessToken: chatgpt.access, model }
      : { kind: "openai" as const, apiKey: process.env.OPENAI_API_KEY!, model };
    const unchanged = async () => {
      const current = await chatgptSessions.status(user.id, false);
      const active = current.profiles.find((p) => p.id === current.active);
      if (
        current.provider !== selection.provider ||
        (chatgpt &&
          (current.active !== chatgpt.profileId ||
            !active?.authorized ||
            active.model !== model))
      )
        throw new ChatGPTError(
          "provider_changed",
          "AI connection or selection changed. Request coaching again with your current provider.",
          409,
        );
    };
    const today = localDate(new Date(), config.timezone);
    const results = await Promise.all([
      db.from("coding_problems").select("*"),
      db.from("coding_attempts").select("*"),
      db.from("behavioral_stories").select("*"),
      db.from("daily_study_tasks").select("*"),
      db.from("profiles").select("*").single(),
      db.from("study_plans").select("payload").eq("day", today).single(),
    ]);
    if (results.some((r) => r.error))
      throw new Error("Could not load the recorded evidence for coaching.");
    const data = {
      problems: results[0].data,
      attempts: results[1].data,
      stories: results[2].data,
      tasks: results[3].data,
      profile: results[4].data,
    } as Data;
    const day = dayPlanSchema.parse(results[5].data!.payload);
    if (day.sourceRevision !== Number(stateResult.data.revision))
      return reply(
        { error: "The plan changed. Regenerate before requesting coaching." },
        409,
      );
    const summary = coachingSummary(data, day);
    if (!summary.sessions.length)
      return reply(
        { error: "No remaining sessions need coaching today." },
        409,
      );
    const cacheKey = createHash("sha256")
      .update(
        JSON.stringify({
          version: 2,
          provider: selection.provider,
          clientId: chatgpt?.clientId,
          model,
          summary,
        }),
      )
      .digest("hex");
    const reservation = await db.rpc("reserve_planner_coach", {
      cache_key: cacheKey,
    });
    if (reservation.error)
      throw new Error(
        "Coaching limits are unavailable; the deterministic schedule is ready.",
      );
    if (reservation.data.status === "cached") {
      await unchanged();
      return reply({
        ...renderCoaching(
          validateCoachChoice(reservation.data.result, summary),
          day,
        ),
        status: "cached",
        provider: selection.provider,
        model,
      });
    }
    if (reservation.data.status !== "allowed")
      return reply(
        {
          error:
            "Coaching is limited to five requests per UTC day, at least one minute apart. Your deterministic schedule is ready.",
        },
        429,
      );
    let choice;
    const tracked = chatgpt ? trackChatGPTRequest(chatgpt.profileId) : null;
    try {
      choice = validateCoachChoice(
        await requestSelectedCoach(
          summary,
          provider,
          undefined,
          tracked?.signal,
        ),
        summary,
      );
    } catch (error) {
      if (chatgpt) await chatgptSessions.recordFailure(user.id, chatgpt, error);
      throw error;
    } finally {
      tracked?.done();
    }
    await unchanged();
    // Evidence may have changed while streaming; never cache against a stale revision.
    const latest = await db
      .from("planner_state")
      .select("revision,config")
      .eq("user_id", user.id)
      .single();
    if (
      latest.error ||
      Number(latest.data.revision) !== Number(stateResult.data.revision) ||
      !plannerConfigSchema.parse(latest.data.config).aiConsent
    )
      throw new ChatGPTError(
        "plan_changed",
        "Your evidence or consent changed during coaching. Nothing was saved; regenerate first.",
        409,
      );
    // Store only validated constrained choices, never credentials or raw histories.
    const stored = await db.rpc("finish_planner_coach", {
      cache_key: cacheKey,
      result: choice,
    });
    if (stored.error)
      throw new Error(
        "Coaching could not be cached. Your deterministic schedule is ready.",
      );
    return reply({
      ...renderCoaching(choice, day),
      status: "generated",
      provider: selection.provider,
      model,
    });
  } catch (error) {
    const e = safeAIError(error);
    return reply(
      {
        error: e.message,
        code: e.code,
      },
      e.status,
    );
  }
}
