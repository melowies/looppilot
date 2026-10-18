import { z } from "zod";
import { importSchema } from "./domain";
import { supabase } from "./supabase";
import { leetcodeSlug, metadataSchema } from "./leetcode";

export const importReportSchema = z.object({
  problems: z.object({
    inserted: z.number().int().min(0),
    linked: z.number().int().min(0),
  }),
  attempts: z.object({
    inserted: z.number().int().min(0),
    skipped: z.number().int().min(0),
  }),
  stories: z.object({
    inserted: z.number().int().min(0),
    skipped: z.number().int().min(0),
  }),
  warnings: z.array(z.string()),
  conflicts: z.array(z.string()),
  committed: z.boolean(),
});
export type ImportReport = z.infer<typeof importReportSchema>;
export type HistoryImport = z.infer<typeof importSchema>;

// The server's maintained catalog verifies identity from the actual URL. Never
// infer LeetCode numbers from file-local source IDs or send private history here.
export async function prepareHistoryImport(raw: string) {
  const payload = importSchema.parse(JSON.parse(raw));
  const slugs = [
    ...new Set(
      payload.problems
        .map((p) => leetcodeSlug(p.url))
        .filter((s): s is string => s !== null),
    ),
  ];
  const identities = new Map<string, number>();
  for (let start = 0; start < slugs.length; start += 4) {
    await Promise.all(
      slugs.slice(start, start + 4).map(async (slug) => {
        const response = await fetch(
          `/api/leetcode?slug=${encodeURIComponent(slug)}`,
          { signal: AbortSignal.timeout(8000) },
        );
        if (response.status === 404) return;
        if (!response.ok)
          throw new Error(
            "Problem identity lookup is unavailable. Retry validation before importing.",
          );
        const metadata = metadataSchema.parse(await response.json());
        if (metadata.slug !== slug)
          throw new Error(
            "Problem identity lookup returned a different problem.",
          );
        identities.set(slug, metadata.number);
      }),
    );
  }
  for (const problem of payload.problems) {
    const number = identities.get(leetcodeSlug(problem.url) ?? "");
    if (number === undefined) continue;
    if (problem.leetcode_id != null && problem.leetcode_id !== number)
      throw new Error(
        `Conflicting LeetCode number and URL for ${problem.title}.`,
      );
    problem.leetcode_id = number;
  }
  return payload;
}

export async function importHistory(payload: HistoryImport, dryRun: boolean) {
  if (!supabase) throw new Error("Sign in to preview and import your history.");
  const { data, error } = await supabase.rpc("import_history_safe", {
    payload: importSchema.parse(payload),
    dry_run: dryRun,
  });
  if (error) {
    if (/PGRST20[245]|42883|42703|42P01/.test(error.code ?? ""))
      throw new Error(
        "Apply the new migration supabase/migrations/202610180002_safe_history_import.sql manually in Supabase, then validate again. Nothing has been imported.",
      );
    throw new Error(error.message);
  }
  const report = importReportSchema.parse(data);
  if (!dryRun && !report.committed)
    throw new Error(
      report.conflicts.join(" ") ||
        "The import was not committed. Validate again.",
    );
  return report;
}

export async function exportWorkspace() {
  if (!supabase) throw new Error("Sign in to export your workspace.");
  const tables = [
    "profiles",
    "coding_problems",
    "coding_attempts",
    "behavioral_stories",
    "study_sessions",
    "daily_study_tasks",
    "readiness_snapshots",
  ];
  const records: Record<string, unknown> = {};
  for (const table of tables) {
    const rows: unknown[] = [];
    for (let start = 0; ; start += 1000) {
      const { data, error } = await supabase
        .from(table)
        .select("*")
        .order("id")
        .range(start, start + 999);
      if (error) throw new Error(error.message);
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    records[table] = rows;
  }
  const planner = await supabase.rpc("get_planner_state");
  if (!planner.error) records.planner = planner.data;
  return {
    format: "looppilot-account-export-v1",
    exported_at: new Date().toISOString(),
    records,
  };
}

export function downloadExport(value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `looppilot-backup-${new Date().toISOString().replaceAll(":", "-")}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
