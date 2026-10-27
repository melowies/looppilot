import type { PlannerState, ScheduleItem } from "./adaptive-types";

export type StudySessionLink = { day: string; key: string; startedAt: string };

export const isLive = (item: ScheduleItem) =>
  item.status === "planned" &&
  (item.live?.state === "running" || item.live?.state === "paused");

export function currentStudy(state: PlannerState | null, now: number) {
  const items =
    state?.days.flatMap((d) => d.items.map((item) => ({ day: d.day, item }))) ??
    [];
  const active = items.find(({ item }) => isLive(item));
  const upcoming = items
    .filter(
      ({ item }) =>
        item.status === "planned" &&
        !isLive(item) &&
        Date.parse(item.end) > now,
    )
    .sort((a, b) => Date.parse(a.item.start) - Date.parse(b.item.start));
  return {
    current: active ?? upcoming[0],
    next: active ? upcoming[0] : upcoming[1],
    active,
  };
}

// A bounded display interpolation. Only server-acknowledged heartbeats are durable.
export function liveSeconds(
  item: ScheduleItem,
  now: number,
  observedSince = now,
) {
  return (
    (item.live?.elapsed_seconds ?? 0) +
    (item.live?.state === "running"
      ? Math.max(
          0,
          Math.min(
            10,
            (now -
              Math.max(observedSince, Date.parse(item.live.heartbeat_at))) /
              1000,
          ),
        )
      : 0)
  );
}

export function occupiedInterval(item: ScheduleItem, now: number) {
  const start = Date.parse(item.live?.started_at ?? item.start);
  return {
    start,
    end: item.completed_at
      ? Math.max(start, Date.parse(item.completed_at))
      : isLive(item)
        ? Math.max(Date.parse(item.end), now)
        : Date.parse(item.end),
  };
}

export function sessionChange(item: ScheduleItem) {
  if (!item.live || item.status !== "completed") return null;
  const difference = Math.round(
    (Date.parse(item.completed_at!) - Date.parse(item.end)) / 60000,
  );
  return `${item.title} finished ${Math.abs(difference)} min ${difference > 0 ? "later" : "earlier"} than scheduled (${Math.ceil(item.live.elapsed_seconds / 60)} min active / ${item.minutes} min planned). Remaining work was reconsidered within your study windows.`;
}

// External subscribers keep planner/clock updates away from the controlled IDE.
type Snapshot = { owner: string; state: PlannerState } | null;
let snapshot: Snapshot = null;
const listeners = new Set<() => void>();
export const subscribeStudy = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const studySnapshot = () => snapshot;
export const serverStudySnapshot = () => null;
export function publishStudy(owner: string, state: PlannerState) {
  snapshot = { owner, state };
  try {
    localStorage.setItem(`looppilot-study:${owner}`, JSON.stringify(state));
  } catch {
    /* Storage can be unavailable. */
  }
  listeners.forEach((listener) => listener());
}
export function cachedStudy(owner: string) {
  if (snapshot?.owner === owner) return snapshot.state;
  return null;
}
export function signalStudyChange() {
  window.dispatchEvent(new Event("looppilot-study-change"));
  try {
    localStorage.setItem("looppilot-study-signal", crypto.randomUUID());
  } catch {
    /* Polling also reconciles. */
  }
}
export function liveAttemptLink(owner: string, problemId: string) {
  const active = currentStudy(cachedStudy(owner), Date.now()).active;
  return active?.item.problem_id === problemId &&
    ["coding", "review", "debugging"].includes(active.item.category)
    ? {
        day: active.day,
        key: active.item.key,
        startedAt: active.item.live!.started_at,
      }
    : undefined;
}

export function clearStudy(owner: string) {
  if (snapshot?.owner === owner) snapshot = null;
  try {
    localStorage.removeItem(`looppilot-study:${owner}`);
  } catch {
    /* Storage can be unavailable. */
  }
  listeners.forEach((listener) => listener());
}

export function signalEvidenceChange() {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem("looppilot-evidence-signal", crypto.randomUUID());
  } catch {
    /* Focus/navigation also reload account evidence. */
  }
}
