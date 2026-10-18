import { supabase } from "./supabase";
import { emptyData } from "./domain";
import { loadData } from "./repository";
import {
  dayPlanSchema,
  plannerConfigSchema,
  type DayPlan,
  type PlannerConfig,
  type PlannerState,
} from "./adaptive-types";
import type { PlanningData } from "./adaptive-planner";

function client() {
  if (!supabase) throw new Error("Connect Supabase to save your schedule.");
  return supabase;
}
export function plannerError(error: { message: string; code?: string }) {
  if (/PGRST20[245]|42P01|42883/.test(error.code ?? ""))
    return new Error(
      "Apply the new migration supabase/migrations/202610180001_adaptive_planner.sql, then retry the planner. Your existing preparation history is unchanged.",
    );
  return new Error(error.message);
}
export async function loadPlannerState(
  profile = emptyData.profile,
): Promise<PlannerState> {
  const { data, error } = await client().rpc("get_planner_state");
  if (error) throw plannerError(error);
  const config = plannerConfigSchema.parse({
    timezone: profile.timezone,
    ...data.config,
  });
  return {
    config,
    revision: Number(data.revision),
    days: dayPlanSchema.array().parse(data.days),
  };
}
export async function loadPlanningEvidence(): Promise<PlanningData> {
  const results = await Promise.all([
    loadData(),
    client().from("study_sessions").select("studied_on,duration_minutes,focus"),
    client()
      .from("readiness_snapshots")
      .select("recorded_at,score")
      .order("recorded_at"),
  ]);
  if (results[1].error) throw plannerError(results[1].error);
  if (results[2].error) throw plannerError(results[2].error);
  return {
    ...results[0],
    sessions: results[1].data ?? [],
    snapshots: results[2].data ?? [],
  };
}
export async function commitPlannerWeek(revision: number, days: DayPlan[]) {
  const { error } = await client().rpc("commit_planner_week", {
    expected_revision: revision,
    days,
  });
  if (error) throw plannerError(error);
}
export async function savePlannerConfig(
  revision: number,
  config: PlannerConfig,
) {
  const { error } = await client().rpc("save_planner_config", {
    expected_revision: revision,
    settings: plannerConfigSchema.parse(config),
  });
  if (error) throw plannerError(error);
}
export async function editPlannerItem(
  revision: number,
  day: string,
  key: string,
  action: "complete" | "skip" | "pin" | "reschedule",
  start?: string,
) {
  const { error } = await client().rpc("edit_planner_item", {
    expected_revision: revision,
    plan_day: day,
    item_key: key,
    action,
    new_start: start ?? null,
  });
  if (error) throw plannerError(error);
}
