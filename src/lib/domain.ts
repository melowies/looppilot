import { z } from "zod";

export const patterns = [
  "Arrays & hashing",
  "Two pointers",
  "Sliding window",
  "Stack",
  "Binary search",
  "Linked lists",
  "Trees",
  "Graphs",
  "Heaps",
  "Backtracking",
  "Dynamic programming",
  "Intervals",
] as const;
export const principles = [
  "Customer Obsession",
  "Ownership",
  "Invent and Simplify",
  "Are Right, A Lot",
  "Learn and Be Curious",
  "Hire and Develop the Best",
  "Insist on the Highest Standards",
  "Think Big",
  "Bias for Action",
  "Frugality",
  "Earn Trust",
  "Dive Deep",
  "Have Backbone; Disagree and Commit",
  "Deliver Results",
  "Strive to be Earth’s Best Employer",
  "Success and Scale Bring Broad Responsibility",
] as const;
const title = z.string().trim().min(1).max(200);
export const dateOnly = z.iso.date();
const text = z.string().max(50000).default("");
export const problemSchema = z.object({
  title,
  url: z
    .union([
      z.literal(""),
      z.url().refine((v) => /^https?:/.test(v), "Use an HTTP or HTTPS URL"),
    ])
    .default(""),
  difficulty: z.enum(["Easy", "Medium", "Hard"]),
  pattern: z.enum(patterns),
});
const attemptBase = z.object({
  problem_id: z.uuid(),
  attempted_on: dateOnly,
  duration_minutes: z.number().int().min(0).max(1440).nullable(),
  language: title,
  solution: text,
  difficulty: z.enum(["Easy", "Medium", "Hard"]),
  pattern: z.enum(patterns),
  assistance: z.enum(["independent", "hinted", "guided", "solution-viewed"]),
  hints: z.number().int().min(0).max(100).nullable(),
  correctness: z.enum(["passed", "partial", "failed", "unverified"]),
  test_results: text,
  time_complexity: z.string().max(200).default(""),
  space_complexity: z.string().max(200).default(""),
  confidence: z.number().int().min(1).max(5).nullable(),
  notes: text,
});
const assistanceCheck = (
  a: { assistance: string; hints: number | null },
  ctx: z.RefinementCtx,
) => {
  if (a.assistance === "independent" && a.hints !== 0)
    ctx.addIssue({
      code: "custom",
      message: "An independent attempt requires a known zero hints.",
      path: ["hints"],
    });
};
export const attemptSchema = attemptBase.superRefine(assistanceCheck);
export const storySchema = z
  .object({
    title,
    principles: z.array(z.enum(principles)).min(1),
    situation: text,
    task: text,
    action: text,
    result: text,
    evidence: text,
    follow_up_questions: text,
    confidence: z.number().int().min(1).max(5).nullable(),
    status: z.enum(["draft", "practicing", "ready"]),
  })
  .superRefine((s, ctx) => {
    if (
      s.status === "ready" &&
      [s.situation, s.task, s.action, s.result].some((v) => !v.trim())
    )
      ctx.addIssue({
        code: "custom",
        message: "Ready stories need every STAR section.",
        path: ["status"],
      });
  });
export type Problem = z.infer<typeof problemSchema> & {
  id: string;
  created_at: string;
  leetcode_id?: number | null;
  topic_tags?: string[];
};
export type Attempt = z.infer<typeof attemptSchema> & { id: string };
export type Story = z.infer<typeof storySchema> & {
  id: string;
  updated_at: string;
};
export type Task = {
  id: string;
  title: string;
  reason: string;
  due_on: string;
  status: "planned" | "completed";
  problem_id: string | null;
};
export type Profile = {
  interview_date: string | null;
  display_name: string;
  timezone: string;
};
export type Data = {
  problems: Problem[];
  attempts: Attempt[];
  stories: Story[];
  tasks: Task[];
  profile: Profile;
};
export const emptyData: Data = {
  problems: [],
  attempts: [],
  stories: [],
  tasks: [],
  profile: {
    interview_date: null,
    display_name: "",
    timezone: "Europe/Istanbul",
  },
};
export const importSchema = z
  .object({
    version: z.literal(1),
    problems: z
      .array(
        problemSchema.extend({
          source_id: title,
          leetcode_id: z
            .number()
            .int()
            .min(1)
            .max(2147483647)
            .nullable()
            .optional(),
        }),
      )
      .max(2000),
    attempts: z
      .array(
        z.object({
          problem_source_id: title,
          data: attemptBase
            .omit({ problem_id: true })
            .superRefine(assistanceCheck),
        }),
      )
      .max(10000),
    stories: z.array(storySchema).max(1000),
  })
  .superRefine((v, ctx) => {
    const ids = v.problems.map((p) => p.source_id);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({
        code: "custom",
        message: "Problem source IDs must be unique.",
      });
    for (const a of v.attempts)
      if (!ids.includes(a.problem_source_id))
        ctx.addIssue({
          code: "custom",
          message: `Unknown problem source: ${a.problem_source_id}`,
        });
  });
export function localDate(now: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
