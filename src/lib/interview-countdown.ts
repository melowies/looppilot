import type { PlannerConfig } from "./adaptive-types";
import { zonedInstant } from "./study-time";
import { localDate } from "./domain";

// Same deadline semantics as the scheduler: an ongoing round remains current,
// and profile dates are a fallback only when no rounds have been configured.
export function interviewCountdown(
  config: PlannerConfig | undefined,
  profileDate: string | null,
  now: number,
  today: string,
) {
  const rounds = (config?.rounds ?? [])
    .map((round) => {
      const start = zonedInstant(
        round.date,
        round.time,
        config!.interviewTimezone,
      );
      return start === null
        ? null
        : { ...round, start, end: start + round.duration * 60000 };
    })
    .filter((r) => r !== null)
    .sort((a, b) => a.start - b.start);
  const next = rounds.find((r) => r.end > now);
  if (next)
    return {
      date: next.date,
      days: Math.max(0, Math.ceil((next.start - now) / 86400000)),
      title: next.title,
      fromRound: true,
    };
  if (config?.rounds.length) return null;
  const studyToday = config ? localDate(new Date(now), config.timezone) : today;
  return profileDate
    ? {
        date: profileDate,
        days: Math.ceil(
          (Date.parse(profileDate) - Date.parse(studyToday)) / 86400000,
        ),
        title: "Interview",
        fromRound: false,
      }
    : null;
}
