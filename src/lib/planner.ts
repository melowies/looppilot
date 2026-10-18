import { Attempt, Problem, Story, patterns } from "./domain";
const dayMs = 86400000;
export const addDays = (day: string, n: number) =>
  new Date(Date.parse(day + "T00:00:00Z") + n * dayMs)
    .toISOString()
    .slice(0, 10);
export function patternPerformance(attempts: Attempt[]) {
  return patterns.map((pattern) => {
    const items = attempts.filter((a) => a.pattern === pattern);
    return {
      pattern,
      total: items.length,
      independent: items.filter(
        (a) =>
          a.assistance === "independent" &&
          a.correctness === "passed" &&
          a.hints === 0,
      ).length,
    };
  });
}
export function readiness(attempts: Attempt[], stories: Story[]) {
  const unique = new Set(attempts.map((a) => a.problem_id)).size;
  const observed = patternPerformance(attempts).filter((p) => p.total > 0);
  if (unique < 5 || observed.length < 3 || stories.length < 2) return null;
  const independent = new Set(
    attempts
      .filter(
        (a) =>
          a.correctness === "passed" &&
          a.assistance === "independent" &&
          a.hints === 0,
      )
      .map((a) => a.problem_id),
  ).size;
  const coding = independent / unique;
  const behavioral =
    stories.filter((s) => s.status === "ready").length / stories.length;
  return {
    score: Math.round((coding * 0.7 + behavioral * 0.3) * 100),
    problems: unique,
    patterns: observed.length,
    stories: stories.length,
  };
}
export type Recommendation = {
  key: string;
  problem_id: string | null;
  title: string;
  reason: string;
  due_on: string;
  priority: number;
};
export function plan(
  problems: Problem[],
  attempts: Attempt[],
  today: string,
): Recommendation[] {
  const reviews: Recommendation[] = [];
  for (const p of problems) {
    const history = attempts
      .filter((a) => a.problem_id === p.id && a.attempted_on <= today)
      .sort(
        (a, b) =>
          b.attempted_on.localeCompare(a.attempted_on) ||
          b.id.localeCompare(a.id),
      );
    if (!history.length) continue;
    // A review advances only after a new attempt on a later calendar day.
    const days = [...new Set(history.map((a) => a.attempted_on))].sort();
    const anchor = days[0];
    let stage = 0;
    for (const day of days.slice(1)) {
      if (day >= addDays(anchor, [1, 3, 7][stage])) {
        stage++;
        if (stage === 3) break;
      }
    }
    if (stage === 3) continue;
    const due = addDays(anchor, [1, 3, 7][stage]);
    const latest = history[0];
    if (due <= today)
      reviews.push({
        key: `review:${p.id}:${stage}:${due}`,
        problem_id: p.id,
        title: `Review ${p.title}`,
        due_on: due,
        reason: `D+${[1, 3, 7][stage]} review${due < today ? " · overdue" : ""}. Last attempt: ${latest.assistance}, ${latest.confidence === null ? "confidence unassessed" : `confidence ${latest.confidence}/5`}.`,
        priority:
          100 +
          Math.floor((Date.parse(today) - Date.parse(due)) / dayMs) * 10 +
          (latest.confidence === null ? 0 : (5 - latest.confidence) * 3) +
          (latest.assistance !== "independent" ? 8 : 0),
      });
  }
  reviews.sort((a, b) => b.priority - a.priority || a.key.localeCompare(b.key));
  const result = reviews.slice(0, 5);
  const weak = patternPerformance(
    attempts.filter((a) => a.attempted_on <= today),
  )
    .filter((p) => p.total > 0)
    .sort(
      (a, b) =>
        a.independent / a.total - b.independent / b.total ||
        a.pattern.localeCompare(b.pattern),
    );
  if (result.length < 3) {
    const pattern = weak[0]?.pattern ?? "Arrays & hashing";
    result.push({
      key: `practice:${today}:${pattern}`,
      problem_id: null,
      title: `Practice ${pattern.toLowerCase()}`,
      due_on: today,
      reason: weak.length
        ? `${weak[0].independent}/${weak[0].total} attempts independently passed. Strengthen this pattern with one focused problem.`
        : "Start with one problem to establish your baseline.",
      priority: 0,
    });
  }
  return result;
}
