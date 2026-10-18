import { requestCoach, type CoachSummary } from "./planner-coach";
import { ChatGPTError } from "./chatgpt-protocol.server";

// A single explicit dispatch. Neither branch can call the other provider on failure.
export async function requestSelectedCoach(
  summary: CoachSummary,
  provider:
    | { kind: "rules" }
    | { kind: "chatgpt"; accessToken: string; model: string }
    | { kind: "openai"; apiKey: string; model: string },
  fetcher?: typeof fetch,
  signal?: AbortSignal,
) {
  if (provider.kind === "rules")
    throw new ChatGPTError(
      "rules_selected",
      "Rule-based planning is selected. Choose an AI provider in Settings for optional coaching.",
      409,
    );
  if (provider.kind === "chatgpt")
    return requestCoach(summary, {
      provider: "chatgpt",
      accessToken: provider.accessToken,
      model: provider.model,
      fetcher,
      signal,
    });
  return requestCoach(summary, {
    apiKey: provider.apiKey,
    model: provider.model,
    fetcher,
    signal,
  });
}
