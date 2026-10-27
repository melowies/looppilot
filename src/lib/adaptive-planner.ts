import type { Attempt, Data, Story } from "./domain";
import { localDate, patterns, principles } from "./domain";
import { addDays, plan } from "./planner";
import { readTestEvidence } from "./coding-workspace";
import { isLive, occupiedInterval, sessionChange } from "./live-study";
import {
  plannerConfigSchema,
  type DayPlan,
  type PlannerConfig,
  type ScheduleItem,
} from "./adaptive-types";
import {
  availableIntervals,
  intervalMinutes,
  studyWeek,
  subtractIntervals,
  zonedInstant,
} from "./study-time";

export type PlanningData = Data & {
  sessions?: { studied_on: string; duration_minutes: number; focus: string }[];
  snapshots?: { recorded_at: string; score: number }[];
};
type Candidate = Pick<
  ScheduleItem,
  | "key"
  | "title"
  | "category"
  | "problem_id"
  | "story_id"
  | "reason"
  | "priority"
> & { duration: number };
const dayMs = 86400000;
const minutes = (a: Attempt) => {
  const timing = readTestEvidence(a.test_results).timing;
  return timing ? timing.seconds / 60 : a.duration_minutes;
};
export const independentPass = (a: Attempt) =>
  a.correctness === "passed" && a.assistance === "independent" && a.hints === 0;
const sortedHistory = (attempts: Attempt[]) =>
  [...attempts].sort(
    (a, b) =>
      a.attempted_on.localeCompare(b.attempted_on) ||
      (
        readTestEvidence(a.test_results).studySession?.startedAt ?? ""
      ).localeCompare(
        readTestEvidence(b.test_results).studySession?.startedAt ?? "",
      ) ||
      a.id.localeCompare(b.id),
  );
const median = (values: number[], fallback: number) => {
  if (!values.length) return fallback;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
export function analyzePatterns(attempts: Attempt[]) {
  const history = sortedHistory(attempts);
  return patterns.map((pattern) => {
    const items = history.filter((a) => a.pattern === pattern);
    const latest = [...new Map(items.map((a) => [a.problem_id, a])).values()];
    // A first recorded independent Medium carries more weight than a familiar repeat.
    const first = items.filter(
      (a, i) => items.findIndex((b) => b.problem_id === a.problem_id) === i,
    );
    const weight = (a: Attempt) =>
      a.difficulty === "Medium" ? 1.5 : a.difficulty === "Hard" ? 1.25 : 1;
    const denominator = latest.reduce((sum, a) => sum + weight(a), 0);
    const strength = denominator
      ? latest.reduce(
          (sum, a) =>
            sum +
            (independentPass(a)
              ? weight(a) *
                (first.find((f) => f.problem_id === a.problem_id)?.id === a.id
                  ? 1
                  : 0.65)
              : 0),
          0,
        ) / denominator
      : null;
    const recent = items.slice(-3);
    return {
      pattern,
      observed: latest.length,
      strength,
      hints: recent.filter(
        (a) =>
          (a.hints !== null && a.hints > 0) || a.assistance !== "independent",
      ).length,
      recentFailures: recent.filter((a) => a.correctness === "failed").length,
    };
  });
}
export function adaptiveReviews(data: Data, day: string): Candidate[] {
  return data.problems
    .flatMap((problem): Candidate[] => {
      const history = sortedHistory(
        data.attempts.filter(
          (a) => a.problem_id === problem.id && a.attempted_on <= day,
        ),
      );
      if (!history.length) return [];
      const anchor = history[0].attempted_on;
      let stage = 0,
        lastAdvanced = anchor;
      for (const a of history.slice(1)) {
        if (
          stage < 3 &&
          independentPass(a) &&
          a.attempted_on > lastAdvanced &&
          a.attempted_on >= addDays(anchor, [1, 3, 7][stage])
        ) {
          stage++;
          lastAdvanced = a.attempted_on;
        }
      }
      const latest = history.at(-1)!;
      if (stage === 3 && independentPass(latest)) return [];
      let due =
        stage < 3
          ? addDays(anchor, [1, 3, 7][stage])
          : addDays(latest.attempted_on, 1);
      if (stage > 0) due = [due, addDays(lastAdvanced, 1)].sort().at(-1)!;
      if (!independentPass(latest) && history.length > 1)
        due = [due, addDays(latest.attempted_on, 1)].sort().at(-1)!;
      if (due > day) return [];
      const overdue = Math.max(
        0,
        Math.floor((Date.parse(day) - Date.parse(due)) / dayMs),
      );
      return [
        {
          key: `review:${problem.id}:${stage}:${due}`,
          title: `Review ${problem.title}`,
          category: "review",
          problem_id: problem.id,
          story_id: null,
          duration: 30,
          priority:
            110 +
            Math.min(60, overdue * 6) +
            (independentPass(latest) ? 0 : 30) +
            (latest.confidence === null ? 0 : (5 - latest.confidence) * 3),
          reason: `${stage < 3 ? `D+${[1, 3, 7][stage]}` : "Recovery"} review due ${due}${overdue ? ` (${overdue} days overdue)` : ""}. Last result: ${latest.correctness}, ${latest.assistance}, ${latest.hints === null ? "hints unknown" : `${latest.hints} hints`}, ${latest.confidence === null ? "confidence unassessed" : `confidence ${latest.confidence}/5`}. Only a later independent pass advances repetition.`,
        },
      ];
    })
    .sort((a, b) => b.priority - a.priority || a.key.localeCompare(b.key));
}
export function preparationPhase(hours: number | null, config: PlannerConfig) {
  if (hours === null) return "Foundations";
  if (hours <= config.phaseDays.taper * 24) return "Light review";
  if (hours <= config.phaseDays.focused * 24) return "Interview rehearsal";
  if (hours <= config.phaseDays.foundations * 24) return "Focused practice";
  return "Foundations";
}
export function remainingStudyMinutes(
  data: Data,
  config: PlannerConfig,
  now: string,
) {
  const instant = Date.parse(now),
    day = localDate(new Date(now), config.timezone);
  const rounds = config.rounds.map((r) => ({
    ...r,
    start: zonedInstant(r.date, r.time, config.interviewTimezone),
  }));
  if (
    !rounds.length &&
    data.profile.interview_date &&
    data.profile.interview_date <= day
  )
    return 0;
  if (
    rounds.length &&
    rounds.every(
      (r) => r.start !== null && r.start + r.duration * 60000 <= instant,
    )
  )
    return 0;
  const deadline = Math.min(
    Infinity,
    ...rounds
      .filter(
        (r) =>
          r.start !== null &&
          localDate(new Date(r.start), config.timezone) === day,
      )
      .map((r) => r.start!),
  );
  const slots = subtractIntervals(
    availableIntervals(config, day),
    rounds
      .filter((r) => r.start !== null)
      .map((r) => ({ start: r.start!, end: r.start! + r.duration * 60000 })),
  );
  return Math.floor(
    intervalMinutes(
      slots
        .map((s) => ({
          start: Math.max(s.start, instant),
          end: Math.min(s.end, deadline),
        }))
        .filter((s) => s.end > s.start),
    ),
  );
}
const storyGaps = (s: Story) =>
  [
    !s.situation.trim() && "situation",
    !s.task.trim() && "task",
    !s.action.trim() && "action",
    !s.result.trim() && "result",
    !s.evidence.trim() && "specific evidence",
    !s.follow_up_questions.trim() && "follow-ups",
  ]
    .filter(Boolean)
    .join(", ");

function candidates(
  data: PlanningData,
  config: PlannerConfig,
  day: string,
  phase: string,
  format: string | undefined,
  reserved: Set<string>,
): Candidate[] {
  const attempts = data.attempts.filter((a) => a.attempted_on <= day);
  const analysis = analyzePatterns(attempts);
  const weak = [...analysis].sort(
    (a, b) =>
      (a.strength ?? 0.4) - (b.strength ?? 0.4) ||
      b.hints - a.hints ||
      a.pattern.localeCompare(b.pattern),
  );
  const observedWeak = weak.find((p) => p.observed > 0) ?? weak[0];
  const baseline = !attempts.length;
  const light = phase === "Light review";
  const reviews = adaptiveReviews({ ...data, attempts }, day)
    .slice(0, 5)
    .map((r) => ({ ...r, duration: light ? 20 : r.duration }));
  const result: Candidate[] = [...reviews];
  // Reuse the existing planner's baseline/pattern recommendation as a fallback.
  const fallback = plan(
    [],
    attempts.filter((a) => a.pattern === observedWeak.pattern),
    day,
  ).find((r) => !r.problem_id)!;
  if (
    !light &&
    (phase !== "Interview rehearsal" ||
      !attempts.length ||
      (observedWeak.strength ?? 0) < 0.4)
  ) {
    const unseen = data.problems
      .filter(
        (p) =>
          !attempts.some((a) => a.problem_id === p.id) && !reserved.has(p.id),
      )
      .sort(
        (a, b) =>
          Number(b.pattern === observedWeak.pattern) -
            Number(a.pattern === observedWeak.pattern) ||
          Number(b.difficulty === "Medium") -
            Number(a.difficulty === "Medium") ||
          a.id.localeCompare(b.id),
      );
    for (let i = 0; i < 3; i++) {
      const p = unseen[i];
      if (i && !p) break;
      const target =
        analysis.find((a) => a.pattern === p?.pattern) ?? observedWeak;
      const duration = Math.min(
        75,
        Math.max(
          30,
          Math.ceil(
            median(
              attempts
                .filter(
                  (a) => a.pattern === (p?.pattern ?? observedWeak.pattern),
                )
                .map(minutes)
                .filter((m): m is number => m !== null && m > 0),
              45,
            ) / 5,
          ) * 5,
        ),
      );
      result.push({
        key: p ? `new:${p.id}` : `baseline:${observedWeak.pattern}`,
        title: baseline
          ? `Baseline assessment${p ? `: ${p.title}` : ": one Medium problem"}`
          : p
            ? `Independent practice: ${p.title}`
            : fallback.title,
        category: "coding",
        problem_id: p?.id ?? null,
        story_id: null,
        duration,
        priority:
          (baseline
            ? 125
            : 95 + Math.round((1 - (target.strength ?? 0.5)) * 30)) -
          i * 20 +
          (format === "coding" ? 20 : 0),
        reason: `${baseline ? "No recorded attempts: establish a baseline, without hints first." : `${target.pattern}: ${target.observed} distinct recorded problems, ${target.hints}/3 recent attempts assisted.`} ${p ? "No attempts recorded for this library problem; familiarity outside LoopPilot is unknown." : "Choose or add one library problem before practicing."} ${phase === "Focused practice" ? "Use a timer, then explain complexity and edge cases." : "Record correctness, assistance, complexity and edge cases afterwards."} Duration is an estimate${attempts.some((a) => a.pattern === target.pattern && minutes(a) !== null) ? " informed by recorded durations" : "; no duration history for this pattern"}.`,
      });
    }
  }
  const stories = [...data.stories].sort(
    (a, b) =>
      (a.confidence !== null && b.confidence !== null
        ? a.confidence - b.confidence
        : Number(a.confidence === null) - Number(b.confidence === null)) ||
      Number(a.status === "ready") - Number(b.status === "ready") ||
      a.id.localeCompare(b.id),
  );
  for (const s of stories.slice(0, 2))
    result.push({
      key: `story:${s.id}`,
      title: `${light ? "Recall" : "Rehearse"}: ${s.title}`,
      category: "behavioral",
      problem_id: null,
      story_id: s.id,
      duration: light ? 15 : 25,
      priority:
        100 +
        (s.confidence === null ? 0 : (5 - s.confidence) * 5) +
        (s.status !== "ready" ? 12 : 0) +
        (format === "behavioral" ? 35 : 0),
      reason: `${s.confidence === null ? "Confidence unassessed" : `Self-rated confidence ${s.confidence}/5`}; status ${s.status}. ${storyGaps(s) ? `Strengthen ${storyGaps(s)}.` : "Rehearse STAR and follow-up questions aloud."} Covers ${s.principles.join(", ")}. Rehearsal outcomes are not recorded separately yet.`,
    });
  const missing = principles.filter(
    (p) => !data.stories.some((s) => s.principles.includes(p)),
  );
  if (missing.length)
    result.push({
      key: `coverage:${missing[0]}`,
      title: `Develop a story: ${missing[0]}`,
      category: "behavioral",
      problem_id: null,
      story_id: null,
      duration: light ? 15 : 25,
      priority:
        (!data.stories.length ? 120 : 90) + (format === "behavioral" ? 35 : 0),
      reason: `${missing.length}/${principles.length} Leadership Principles have no recorded story. Use a real experience; completing this task does not mark a story ready.`,
    });
  const latest = sortedHistory(attempts).at(-1);
  if (
    latest &&
    (latest.correctness !== "passed" ||
      !latest.time_complexity.trim() ||
      !latest.space_complexity.trim() ||
      !readTestEvidence(latest.test_results).evidence.trim())
  ) {
    const p = data.problems.find((p) => p.id === latest.problem_id);
    result.push({
      key: `debug:${latest.id}`,
      title: `Explain and debug${p ? `: ${p.title}` : " your latest solution"}`,
      category: "debugging",
      problem_id: p?.id ?? null,
      story_id: null,
      duration: light ? 15 : 25,
      priority: 85 + (latest.correctness === "failed" ? 25 : 0),
      reason: `Latest result: ${latest.correctness}. Check edge cases and explain time/space complexity. Stored local tests and test notes are supporting evidence only; passing samples never proves full correctness.`,
    });
  }
  if (
    !light &&
    (phase === "Focused practice" || phase === "Interview rehearsal")
  )
    result.push({
      key: `mock:${format ?? "mixed"}`,
      title: `Self-directed ${format === "behavioral" ? "behavioral" : format === "coding" ? "coding" : "interview"} rehearsal`,
      category: "mock",
      problem_id: null,
      story_id: null,
      duration: 45,
      priority: phase === "Interview rehearsal" ? 180 : 80,
      reason:
        "No scored mock results are available. Simulate the interview: clarify, solve or tell a STAR story, explain trade-offs, then record your observations. This is self-directed practice, not an AI or scored mock interview.",
    });
  for (const t of data.tasks.filter(
    (t) => t.status === "planned" && t.due_on <= day,
  ))
    result.push({
      key: `manual:${t.id}`,
      title: t.title,
      category: "review",
      problem_id: t.problem_id,
      story_id: null,
      duration: light ? 20 : 30,
      priority: 130,
      reason: `Previously scheduled for ${t.due_on}. ${t.reason} The original task remains in your history.`,
    });
  return result.sort(
    (a, b) => b.priority - a.priority || a.key.localeCompare(b.key),
  );
}

export function generateAdaptiveWeek(
  data: PlanningData,
  rawConfig: PlannerConfig,
  previous: DayPlan[],
  now: string,
): DayPlan[] {
  const config = plannerConfigSchema.parse(rawConfig);
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs))
    throw new Error("A valid current instant is required.");
  const today = localDate(new Date(now), config.timezone);
  const warnings: string[] = [];
  const rounds = config.rounds
    .map((r) => {
      const start = zonedInstant(r.date, r.time, config.interviewTimezone);
      if (start === null)
        throw new Error(
          `Interview time ${r.date} ${r.time} does not exist in ${config.interviewTimezone}; choose another time.`,
        );
      return { ...r, start, end: start + r.duration * 60000 };
    })
    .sort((a, b) => a.start - b.start);
  if (rounds.some((r, i) => i > 0 && r.start < rounds[i - 1].end))
    warnings.push(
      "Interview rounds overlap; all interview blocks are reserved.",
    );
  const reserved = new Set<string>();
  return studyWeek(now, config.timezone).map((day): DayPlan => {
    const old = previous.find((p) => p.day === day);
    const dayStart =
      zonedInstant(day, "00:00", config.timezone) ??
      Date.parse(day + "T00:00:00Z");
    const referenceNow = day === today ? nowMs : dayStart;
    const nextRound = rounds.find((r) => r.end > referenceNow);
    const legacyDate = !rounds.length ? data.profile.interview_date : null;
    const hours = nextRound
      ? Math.max(0, (nextRound.start - referenceNow) / 3600000)
      : legacyDate
        ? (Date.parse(legacyDate) - Date.parse(day)) / 3600000
        : null;
    const phase = preparationPhase(hours, config);
    const daysRemaining =
      hours === null ? null : Math.max(0, Math.ceil(hours / 24));
    const pastDeadline =
      (!nextRound && rounds.length > 0) || (!!legacyDate && legacyDate < day);
    let availability = availableIntervals(config, day);
    availability = subtractIntervals(
      availability,
      rounds.map((r) => ({ start: r.start, end: r.end })),
    );
    // Study before this day's interview only. Date-only legacy deadlines reserve the whole interview day.
    const dayRound = rounds.find(
      (r) => localDate(new Date(r.start), config.timezone) === day,
    );
    if (dayRound)
      availability = availability.flatMap((s) =>
        s.start >= dayRound.start
          ? []
          : [{ start: s.start, end: Math.min(s.end, dayRound.start) }],
      );
    if (legacyDate === day || pastDeadline) availability = [];
    const dayWarnings = [...warnings];
    if (legacyDate)
      dayWarnings.push(
        "Only a date is recorded for the interview. Set an exact round time; the interview day is reserved.",
      );
    if (pastDeadline)
      dayWarnings.push(
        "Recorded interviews have ended. Add the next round to resume automatic scheduling.",
      );
    const preserved = (old?.items ?? [])
      .filter(
        (i) =>
          i.status !== "planned" ||
          i.pinned ||
          isLive(i) ||
          Date.parse(i.end) <= nowMs,
      )
      .map((i) =>
        i.status === "planned" &&
        !isLive(i) &&
        !i.pinned &&
        Date.parse(i.end) <= nowMs
          ? { ...i, status: "missed" as const }
          : { ...i },
      );
    for (const item of preserved.filter(
      (i) => (i.pinned || isLive(i)) && i.status === "planned",
    )) {
      if (
        !availability.some(
          (s) =>
            Date.parse(item.start) >= s.start && Date.parse(item.end) <= s.end,
        )
      )
        dayWarnings.push(
          `${isLive(item) ? "Active" : "Pinned"} session “${item.title}” conflicts with current availability or an interview. ${isLive(item) ? "Finish or pause your work; your study window will not be extended." : "Reschedule or unpin it."}`,
        );
    }
    const blocking = preserved
      .filter((i) => !["skipped", "missed"].includes(i.status))
      .map((i) => occupiedInterval(i, nowMs));
    let slots = subtractIntervals(availability, [
      ...blocking,
      { start: 0, end: Math.ceil(nowMs / 60000) * 60000 },
    ]);
    // An explicitly active task owns the remainder of today's window. Its end
    // is unknown until Finish; do not allocate work that could overlap it.
    if (previous.some((p) => p.items.some(isLive)) && day === today) slots = [];
    // Keep breaks around retained sessions; early completion can free remaining time.
    const breakMs = config.breakMinutes * 60000;
    slots = subtractIntervals(
      slots,
      preserved
        .filter(
          (i) =>
            !["skipped", "missed"].includes(i.status) && i.category !== "break",
        )
        .map((i) => occupiedInterval(i, nowMs))
        .flatMap((b) => [
          { start: b.start - breakMs, end: b.start },
          { start: b.end, end: b.end + breakMs },
        ]),
    );
    // Real completion timestamps include seconds. Round free slots inward so a
    // required rest and the next work session share a safe minute boundary.
    slots = slots
      .map((s) => ({
        start: Math.ceil(s.start / 60000) * 60000,
        end: Math.floor(s.end / 60000) * 60000,
      }))
      .filter((s) => s.end > s.start);
    const attempts = data.attempts.filter((a) => a.attempted_on <= today);
    const recent = sortedHistory(attempts).slice(-3);
    const struggle =
      recent.length >= 3 &&
      recent.filter(
        (a) => a.correctness === "failed" || (a.hints !== null && a.hints >= 2),
      ).length >= 2;
    const cap = Math.floor(
      config.dailyMinutes *
        (config.intensity === "gentle" ? 0.75 : 1) *
        (struggle ? 0.75 : 1),
    );
    const dailyCap = phase === "Light review" ? Math.min(cap, 90) : cap;
    const recordedMinutes = Math.max(
      (data.sessions ?? [])
        .filter((s) => s.studied_on === day)
        .reduce((sum, s) => sum + s.duration_minutes, 0),
      attempts
        .filter((a) => a.attempted_on === day)
        .reduce((sum, a) => sum + (minutes(a) ?? 0), 0),
      preserved
        .filter((i) => i.category !== "break" && i.status === "completed")
        .reduce(
          (sum, i) => sum + (i.live ? i.live.elapsed_seconds / 60 : i.minutes),
          0,
        ),
    );
    const futurePinned = preserved
      .filter((i) => i.status === "planned" && i.category !== "break")
      .reduce((sum, i) => sum + i.minutes, 0);
    if (recordedMinutes + futurePinned > dailyCap)
      dayWarnings.push(
        "Retained sessions and accounted study exceed the current daily cap. No additional work is scheduled; review pinned sessions if your availability changed.",
      );
    let budget = Math.max(0, dailyCap - recordedMinutes - futurePinned);
    const result = [...preserved];
    const recentWork = preserved
      .filter((i) => i.category !== "break" && i.completed_at && i.live)
      .sort((a, b) => b.completed_at!.localeCompare(a.completed_at!))[0];
    if (recentWork && !previous.some((p) => p.items.some(isLive))) {
      const start = Math.ceil(nowMs / 60000) * 60000;
      const restEnd =
        Math.ceil((Date.parse(recentWork.completed_at!) + breakMs) / 60000) *
        60000;
      if (
        restEnd > start &&
        availability.some((s) => s.start <= start && s.end >= restEnd) &&
        !preserved.some(
          (i) =>
            i.category === "break" &&
            i.status !== "missed" &&
            Date.parse(i.end) > start,
        )
      ) {
        result.push({
          key: `${recentWork.key}:rest:${start}`,
          title: "Take a break",
          category: "break",
          start: new Date(start).toISOString(),
          end: new Date(restEnd).toISOString(),
          minutes: (restEnd - start) / 60000,
          problem_id: null,
          story_id: null,
          reason:
            "Rest after your completed session. Start the countdown when you begin resting.",
          priority: 0,
          status: "planned",
          pinned: false,
          completed_at: null,
        });
      }
    }
    const occupiedKeys = new Set(preserved.map((i) => i.key));
    const candidateList = candidates(
      { ...data, attempts },
      config,
      day,
      phase,
      nextRound?.format,
      reserved,
    );
    const usedCategories = new Map<string, number>();
    const maxSession = Math.min(
      config.sessionMinutes,
      struggle ? 30 : 90,
      phase === "Light review" ? 25 : 90,
    );
    let count = 0;
    // Allocate in priority order, then diversify after each selection so behavioral work cannot starve.
    const pending = candidateList.filter(
      (c) => !occupiedKeys.has(`${day}:${c.key}`),
    );
    while (pending.length && budget >= 15 && count < 12) {
      pending.sort(
        (a, b) =>
          b.priority -
            (usedCategories.get(b.category) ?? 0) * 45 -
            (a.priority - (usedCategories.get(a.category) ?? 0) * 45) ||
          a.key.localeCompare(b.key),
      );
      const c = pending.shift()!;
      const largestGap = Math.max(
        0,
        ...slots.map((s) => Math.floor((s.end - s.start) / 60000)),
      );
      const duration = Math.min(c.duration, maxSession, budget, largestGap);
      if (duration < 15) break;
      const slotIndex = slots.findIndex(
        (s) => (s.end - s.start) / 60000 >= duration,
      );
      if (slotIndex < 0) continue;
      const slot = slots[slotIndex];
      const start = slot.start,
        end = start + duration * 60000;
      const key = `${day}:${c.key}`;
      const { duration: _duration, ...fields } = c;
      void _duration;
      result.push({
        ...fields,
        key,
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        minutes: duration,
        status: "planned",
        pinned: false,
        completed_at: null,
        reason:
          c.reason +
          (duration < c.duration
            ? ` Session limited to ${duration} minutes by your time budget; continue later if needed.`
            : ""),
      });
      if (c.category === "coding" && c.problem_id) reserved.add(c.problem_id);
      budget -= duration;
      count++;
      usedCategories.set(c.category, (usedCategories.get(c.category) ?? 0) + 1);
      slots = subtractIntervals(slots, [
        { start: start - breakMs, end: end + breakMs },
      ]);
      if (
        pending.length &&
        budget >= 15 &&
        slot.end - end >= (config.breakMinutes + 15) * 60000
      ) {
        const breakEnd = end + breakMs;
        result.push({
          key: `${key}:break`,
          title: "Take a break",
          category: "break",
          start: new Date(end).toISOString(),
          end: new Date(breakEnd).toISOString(),
          minutes: config.breakMinutes,
          problem_id: null,
          story_id: null,
          reason: "Rest between focused sessions.",
          priority: 0,
          status: "planned",
          pinned: false,
          completed_at: null,
        });
      }
    }
    result.sort(
      (a, b) => a.start.localeCompare(b.start) || a.key.localeCompare(b.key),
    );
    const baseline = !attempts.length;
    const explanation = [
      baseline
        ? "Baseline assessment: no coding results are recorded. Weaknesses are unknown."
        : "Priorities use latest results per problem, assistance, confidence, repeated hints and D+1/D+3/D+7 reviews. Task completion and sample passes never establish mastery.",
      `${phase}: ${phase === "Light review" ? "light recall, no new topics; study is capped at 90 minutes" : phase === "Interview rehearsal" ? "favor self-directed rehearsal and existing algorithms" : phase === "Focused practice" ? "increase independent timed work and behavioral rehearsal" : "develop foundations and independent Medium practice"}.`,
      `Daily study cap ${dailyCap} minutes; breaks use additional window time. ${Math.ceil(recordedMinutes)} minutes accounted for (maximum of logged sessions, attempt durations, or session time to avoid double counting). Older completions without a timer use estimates.`,
      "Future days are provisional: no future attempts or improvements are assumed. Mock scores and separate behavioral practice outcomes are not available.",
    ];
    if (struggle)
      explanation.push(
        "At least two of the last three recorded attempts failed or needed multiple hints. Shorter sessions and a 25% lower workload leave room to review; this is not a fatigue diagnosis.",
      );
    if ((data.snapshots ?? []).length)
      explanation.push(
        `${data.snapshots!.length} saved readiness snapshots are retained as context; scores are not used as proof of mastery.`,
      );
    if (!availability.length)
      dayWarnings.push("No usable study windows on this date.");
    const newKeys = result
      .filter((i) => i.category !== "break")
      .map((i) => i.key);
    const oldKeys =
      old?.items.filter((i) => i.category !== "break").map((i) => i.key) ?? [];
    const changes = old
      ? JSON.stringify(old.items) === JSON.stringify(result)
        ? old.changes
        : [
            `${newKeys.filter((k) => !oldKeys.includes(k)).length} sessions added; ${oldKeys.filter((k) => !newKeys.includes(k)).length} unpinned sessions replaced. Completed and pinned sessions retained.`,
          ]
      : ["First plan for this date."];
    const latestCompletion = [...preserved]
      .filter((i) => i.completed_at && i.live)
      .sort((a, b) => b.completed_at!.localeCompare(a.completed_at!))[0];
    const liveChange = latestCompletion && sessionChange(latestCompletion);
    if (liveChange && !changes.includes(liveChange))
      changes.unshift(liveChange);
    const deferred = (old?.items ?? []).filter(
      (i) =>
        i.status === "planned" &&
        i.category !== "break" &&
        !result.some((r) => r.key === i.key),
    );
    if (deferred.length)
      changes.push(
        `${deferred.map((i) => i.title).join(", ")} deferred for a later available window; future days remain provisional.`.slice(
          0,
          3000,
        ),
      );
    return {
      day,
      timezone: config.timezone,
      phase,
      daysRemaining,
      availableMinutes: Math.floor(intervalMinutes(availability)),
      studyMinutes: result
        .filter(
          (i) =>
            i.category !== "break" &&
            i.status !== "skipped" &&
            i.status !== "missed",
        )
        .reduce((s, i) => s + i.minutes, 0),
      overdue: adaptiveReviews({ ...data, attempts }, day).length,
      baseline,
      explanation,
      warnings: dayWarnings,
      changes,
      items: result,
    };
  });
}

export function scheduleConflicts(items: ScheduleItem[], target: ScheduleItem) {
  return items.some(
    (i) =>
      i.key !== target.key &&
      !["skipped", "missed"].includes(i.status) &&
      Date.parse(i.start) < Date.parse(target.end) &&
      Date.parse(i.end) > Date.parse(target.start),
  );
}
