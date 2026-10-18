import { z } from "zod";
import type { Attempt, Problem } from "./domain";
import type { Timing } from "./practice-timer";

export interface PythonTestCase {
  id: string;
  input: string;
  expectedOutput: string;
  origin?: "curated";
}
export interface PythonExecutionRequest {
  language: "python";
  source: string;
  cases: PythonTestCase[];
  method: "numIslands";
}
export interface PythonTestResult {
  caseId: string;
  status: "Passed" | "Wrong Answer" | "Runtime Error" | "Time Limit Exceeded";
  actualOutput: string;
  expectedOutput: string;
  errorMessage?: string;
}
export interface PythonExecutionResult {
  results: PythonTestResult[];
  stdout: string;
  stderr: string;
  engineError?: string;
}
export interface PythonRunner {
  execute(
    request: PythonExecutionRequest,
    signal: AbortSignal,
  ): Promise<PythonExecutionResult>;
}
const evidenceSchema = z.object({
  format: z.literal("looppilot-workspace-v1"),
  cases: z
    .array(
      z.object({
        id: z.string(),
        input: z.string(),
        expectedOutput: z.string(),
        origin: z.literal("curated").optional(),
      }),
    )
    .max(50),
  evidence: z.string(),
  timing: z
    .object({
      seconds: z.number().finite().min(0).max(86400),
      source: z.enum(["measured", "manual"]),
    })
    .optional(),
});
export function readTestEvidence(raw: string) {
  try {
    const parsed = evidenceSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    /* Existing test evidence is plain text and must be preserved. */
  }
  return {
    format: "looppilot-workspace-v1" as const,
    cases: [] as PythonTestCase[],
    evidence: raw,
    timing: undefined,
  };
}
export function serializeEvidence(
  cases: PythonTestCase[],
  evidence: string,
  timing?: Timing,
) {
  return cases.length || timing
    ? JSON.stringify({
        format: "looppilot-workspace-v1",
        cases,
        evidence,
        ...(timing ? { timing } : {}),
      })
    : evidence;
}
export function newAttempt(
  problem: Problem,
  today: string,
): Omit<Attempt, "id"> {
  return {
    problem_id: problem.id,
    attempted_on: today,
    duration_minutes: null,
    language: "Python",
    solution: "",
    difficulty: problem.difficulty,
    pattern: problem.pattern,
    assistance: "independent",
    hints: 0,
    correctness: "unverified",
    test_results: "",
    time_complexity: "",
    space_complexity: "",
    confidence: 3,
    notes: "",
  };
}
