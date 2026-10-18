import { supabase } from "./supabase";
import { Data, emptyData } from "./domain";
export async function loadData(): Promise<Data> {
  if (!supabase) return emptyData;
  const results = await Promise.all([
    supabase
      .from("coding_problems")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase
      .from("coding_attempts")
      .select("*")
      .order("attempted_on", { ascending: false }),
    supabase
      .from("behavioral_stories")
      .select("*")
      .order("updated_at", { ascending: false }),
    supabase.from("daily_study_tasks").select("*").order("due_on"),
    supabase.from("profiles").select("*").maybeSingle(),
  ]);
  for (const r of results) if (r.error) throw new Error(r.error.message);
  return {
    problems: results[0].data ?? [],
    attempts: results[1].data ?? [],
    stories: results[2].data ?? [],
    tasks: results[3].data ?? [],
    profile: results[4].data ?? emptyData.profile,
  } as Data;
}
export async function save(table: string, value: object, id?: string) {
  if (!supabase) throw new Error("Connect Supabase to save your data.");
  const result = id
    ? await supabase
        .from(table)
        .update(value)
        .eq("id", id)
        .select("id")
        .single()
    : await supabase.from(table).insert(value).select("id").single();
  if (result.error) {
    if (
      table === "coding_problems" &&
      result.error.code === "PGRST204" &&
      /leetcode_id|topic_tags/.test(result.error.message)
    )
      throw new Error(
        "Apply supabase/migrations/202610170002_leetcode_identity.sql in Supabase, then reload and try saving again.",
      );
    if (table === "coding_problems" && result.error.code === "23505")
      throw new Error(
        "This LeetCode problem is already in your library. Open it to record another attempt.",
      );
    throw new Error(result.error.message);
  }
}
export async function remove(table: string, id: string) {
  if (!supabase) throw new Error("Connect Supabase first.");
  const r = await supabase
    .from(table)
    .delete()
    .eq("id", id)
    .select("id")
    .single();
  if (r.error) throw new Error(r.error.message);
}
