import { z } from "zod";

export const timezoneSchema = z
  .string()
  .max(100)
  .refine((zone) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: zone }).format(0);
      return true;
    } catch {
      return false;
    }
  }, "Use an IANA timezone such as Europe/Istanbul.");
export const clockSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const windowSchema = z
  .object({
    start: clockSchema,
    end: z.string().regex(/^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/),
  })
  .refine(
    (w) => w.end > w.start,
    "End must follow start; split overnight windows across two days.",
  );
export const roundSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().trim().min(1).max(200),
  date: z.iso.date(),
  time: clockSchema,
  duration: z.number().int().min(15).max(480),
  format: z.enum(["mixed", "coding", "behavioral"]),
});
export const plannerConfigSchema = z
  .object({
    timezone: timezoneSchema.default("Europe/Istanbul"),
    interviewTimezone: timezoneSchema.default("Europe/Istanbul"),
    rounds: z.array(roundSchema).max(20).default([]),
    weekly: z
      .array(z.array(windowSchema).max(6))
      .length(7)
      .default([[], [], [], [], [], [], []]),
    overrides: z
      .array(
        z.object({ date: z.iso.date(), windows: z.array(windowSchema).max(6) }),
      )
      .max(366)
      .default([]),
    unavailable: z
      .array(
        z
          .object({
            start: z.iso.datetime({ offset: true }),
            end: z.iso.datetime({ offset: true }),
          })
          .refine(
            (b) => Date.parse(b.end) > Date.parse(b.start),
            "Unavailable period must end after it starts.",
          ),
      )
      .max(100)
      .default([]),
    dailyMinutes: z.number().int().min(0).max(720).default(120),
    intensity: z.enum(["gentle", "balanced", "intensive"]).default("balanced"),
    sessionMinutes: z.number().int().min(15).max(90).default(45),
    breakMinutes: z.number().int().min(5).max(30).default(10),
    phaseDays: z
      .object({
        foundations: z.number().int().min(8).max(120),
        focused: z.number().int().min(3).max(60),
        taper: z.number().int().min(1).max(3),
      })
      .refine(
        (p) => p.foundations > p.focused && p.focused > p.taper,
        "Phase boundaries must descend.",
      )
      .default({ foundations: 21, focused: 7, taper: 2 }),
    aiConsent: z.boolean().default(false),
  })
  .superRefine((c, ctx) => {
    if (new Set(c.overrides.map((o) => o.date)).size !== c.overrides.length)
      ctx.addIssue({
        code: "custom",
        message: "Use one override per date.",
        path: ["overrides"],
      });
    if (new Set(c.rounds.map((r) => r.id)).size !== c.rounds.length)
      ctx.addIssue({
        code: "custom",
        message: "Interview round identifiers must be unique.",
        path: ["rounds"],
      });
    for (const windows of [...c.weekly, ...c.overrides.map((o) => o.windows)]) {
      const sorted = [...windows].sort((a, b) =>
        a.start.localeCompare(b.start),
      );
      if (sorted.some((w, i) => i > 0 && w.start < sorted[i - 1].end))
        ctx.addIssue({
          code: "custom",
          message: "Availability windows cannot overlap.",
        });
    }
  });
export type PlannerConfig = z.infer<typeof plannerConfigSchema>;
export const defaultPlannerConfig = (): PlannerConfig =>
  plannerConfigSchema.parse({});
export const scheduleItemSchema = z
  .object({
    key: z.string().min(1).max(300),
    title: z.string().min(1).max(300),
    category: z.enum([
      "coding",
      "review",
      "behavioral",
      "mock",
      "debugging",
      "break",
    ]),
    start: z.iso.datetime({ offset: true }),
    end: z.iso.datetime({ offset: true }),
    minutes: z.number().int().min(1).max(90),
    problem_id: z.string().nullable(),
    story_id: z.string().nullable(),
    reason: z.string().max(3000),
    priority: z.number().int(),
    status: z.enum(["planned", "completed", "skipped", "missed"]),
    pinned: z.boolean(),
    completed_at: z.iso.datetime({ offset: true }).nullable(),
    live: z
      .object({
        state: z.enum(["running", "paused", "finished", "skipped"]),
        started_at: z.iso.datetime({ offset: true }),
        heartbeat_at: z.iso.datetime({ offset: true }),
        elapsed_seconds: z.number().min(0),
        owner_token: z.string(),
        attempt_id: z.string().optional(),
        outcome: z.string().optional(),
        assistance: z.string().optional(),
        duration_minutes: z.number().nullable().optional(),
      })
      .optional(),
  })
  .refine(
    (i) =>
      Date.parse(i.end) > Date.parse(i.start) &&
      (Date.parse(i.end) - Date.parse(i.start)) / 60000 === i.minutes &&
      (i.status === "completed") === (i.completed_at !== null),
    "Invalid session interval or completion state.",
  );
export type ScheduleItem = z.infer<typeof scheduleItemSchema>;
export const dayPlanSchema = z.object({
  sourceRevision: z.number().int().optional(),
  day: z.iso.date(),
  timezone: timezoneSchema,
  phase: z.string().max(100),
  daysRemaining: z.number().int().nullable(),
  availableMinutes: z.number().int().min(0),
  studyMinutes: z.number().int().min(0),
  overdue: z.number().int().min(0),
  baseline: z.boolean(),
  explanation: z.array(z.string().max(3000)).max(30),
  warnings: z.array(z.string().max(3000)).max(100),
  changes: z.array(z.string().max(3000)).max(30),
  items: z.array(scheduleItemSchema).max(100),
});
export type DayPlan = z.infer<typeof dayPlanSchema>;
export type PlannerState = {
  config: PlannerConfig;
  revision: number;
  days: DayPlan[];
};
