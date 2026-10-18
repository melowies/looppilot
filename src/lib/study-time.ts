import { localDate } from "./domain";
import { addDays } from "./planner";
import type { PlannerConfig } from "./adaptive-types";

export type Interval = { start: number; end: number };
const minute = 60000;
const cache = new Map<string, { instant: number; clock: string }[]>();
// Enumerating real UTC minutes avoids guessing offsets at DST gaps and folds.
// A repeated wall-clock minute has two real instants; a nonexistent one has none.
function dayMinutes(day: string, timezone: string) {
  const key = `${day}:${timezone}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const midnight = Date.parse(`${day}T00:00:00Z`);
  const result: { instant: number; clock: string }[] = [];
  for (
    let instant = midnight - 14 * 3600000;
    instant < midnight + 38 * 3600000;
    instant += minute
  ) {
    const p = Object.fromEntries(
      formatter.formatToParts(instant).map((p) => [p.type, p.value]),
    );
    if (`${p.year}-${p.month}-${p.day}` === day)
      result.push({ instant, clock: `${p.hour}:${p.minute}` });
  }
  if (cache.size > 40) cache.clear();
  cache.set(key, result);
  return result;
}
export function zonedInstant(day: string, clock: string, timezone: string) {
  // Ambiguous interview times use the earlier occurrence, explicitly documented.
  return (
    dayMinutes(day, timezone).find((m) => m.clock === clock)?.instant ?? null
  );
}
export function subtractIntervals(
  source: Interval[],
  blocks: Interval[],
): Interval[] {
  return blocks.reduce(
    (slots, block) =>
      slots.flatMap((slot) => {
        if (block.end <= slot.start || block.start >= slot.end) return [slot];
        return [
          ...(block.start > slot.start
            ? [{ start: slot.start, end: block.start }]
            : []),
          ...(block.end < slot.end
            ? [{ start: block.end, end: slot.end }]
            : []),
        ];
      }),
    source.map((s) => ({ ...s })),
  );
}
export function availableIntervals(
  config: PlannerConfig,
  day: string,
): Interval[] {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  const windows =
    config.overrides.find((o) => o.date === day)?.windows ??
    config.weekly[weekday];
  const slots: Interval[] = [];
  for (const m of dayMinutes(day, config.timezone)) {
    if (!windows.some((w) => m.clock >= w.start && m.clock < w.end)) continue;
    const tail = slots.at(-1);
    if (tail?.end === m.instant) tail.end += minute;
    else slots.push({ start: m.instant, end: m.instant + minute });
  }
  return subtractIntervals(
    slots,
    config.unavailable.map((b) => ({
      start: Date.parse(b.start),
      end: Date.parse(b.end),
    })),
  );
}
export function studyWeek(now: string, timezone: string) {
  const today = localDate(new Date(now), timezone);
  return Array.from({ length: 7 }, (_, i) => addDays(today, i));
}
export const intervalMinutes = (slots: Interval[]) =>
  slots.reduce((sum, s) => sum + (s.end - s.start) / minute, 0);
