"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Data } from "@/lib/domain";
import { localDate } from "@/lib/domain";
import type { PlannerState } from "@/lib/adaptive-types";
import { generateAdaptiveWeek } from "@/lib/adaptive-planner";
import { studyWeek } from "@/lib/study-time";
import {
  commitPlannerWeek,
  loadPlannerState,
  loadPlanningEvidence,
} from "@/lib/planner-repository";
import { message } from "@/lib/form";
import { dayPlanSchema, plannerConfigSchema } from "@/lib/adaptive-types";
import { publishStudy, cachedStudy } from "@/lib/live-study";

export function useAdaptivePlanner(data: Data, userId?: string, ready = true) {
  const [storedState, setState] = useState<{
    owner: string;
    value: PlannerState;
  } | null>(() =>
    userId && cachedStudy(userId)
      ? { owner: userId, value: cachedStudy(userId)! }
      : null,
  );
  const [storedError, setError] = useState<{
    owner: string;
    value: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef<string | undefined>(undefined),
    queued = useRef(false),
    owner = useRef(userId);
  const latest = useRef(data);
  useEffect(() => {
    latest.current = data;
  }, [data]);
  useEffect(() => {
    owner.current = userId;
    return () => {
      owner.current = undefined;
    };
  }, [userId]);
  const refresh = useCallback(
    async (force = false) => {
      if (!userId) return;
      if (running.current === userId) {
        queued.current = true;
        return;
      }
      running.current = userId;
      setBusy(true);
      try {
        do {
          queued.current = false;
          // Read revision before evidence. Concurrent evidence/control writes make
          // commit fail rather than overwrite a newer plan; retry once from storage.
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const stored = await loadPlannerState(latest.current.profile);
              const now = new Date().toISOString();
              if (
                !force &&
                studyWeek(now, stored.config.timezone).every((day) =>
                  stored.days.some(
                    (p) =>
                      p.day === day && p.sourceRevision === stored.revision,
                  ),
                )
              ) {
                if (owner.current === userId) {
                  setState({ owner: userId, value: stored });
                  publishStudy(userId, stored);
                  setError(null);
                }
                break;
              }
              const evidence = await loadPlanningEvidence();
              if (owner.current !== userId) return;
              const days = generateAdaptiveWeek(
                evidence,
                stored.config,
                stored.days,
                now,
              ).map((p) => ({ ...p, sourceRevision: stored.revision }));
              await commitPlannerWeek(stored.revision, days);
              if (owner.current === userId) {
                setState({
                  owner: userId,
                  value: {
                    ...stored,
                    days: [
                      ...stored.days.filter(
                        (p) => !days.some((d) => d.day === p.day),
                      ),
                      ...days,
                    ],
                  },
                });
                setError(null);
                publishStudy(userId, {
                  ...stored,
                  days: [
                    ...stored.days.filter(
                      (p) => !days.some((d) => d.day === p.day),
                    ),
                    ...days,
                  ],
                });
              }
              break;
            } catch (e) {
              if (attempt === 0 && /Planner changed/.test(message(e))) continue;
              throw e;
            }
          }
        } while (queued.current && owner.current === userId);
      } catch (e) {
        if (owner.current === userId)
          setError({ owner: userId, value: message(e) });
      } finally {
        if (running.current === userId) running.current = undefined;
        if (owner.current === userId) setBusy(false);
      }
    },
    [userId],
  );
  useEffect(() => {
    if (!userId || !ready) return;
    queueMicrotask(() => {
      const memory = cachedStudy(userId);
      if (memory) setState({ owner: userId, value: memory });
      if (!cachedStudy(userId)) {
        try {
          const raw = JSON.parse(
            localStorage.getItem(`looppilot-study:${userId}`) ?? "null",
          );
          if (raw) {
            const cached = {
              config: plannerConfigSchema.parse(raw.config),
              revision: Number(raw.revision),
              days: dayPlanSchema.array().parse(raw.days),
            };
            publishStudy(userId, cached);
            setState({ owner: userId, value: cached });
          }
        } catch {
          /* Invalid local snapshots are discarded; Supabase is authoritative. */
        }
      }
      void refresh();
    });
  }, [data, userId, ready, refresh]);
  useEffect(() => {
    if (!userId || !ready) return;
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 15000);
    const focus = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", focus);
    window.addEventListener("online", focus);
    window.addEventListener("looppilot-study-change", focus);
    const storage = (event: StorageEvent) => {
      if (event.key === "looppilot-study-signal") focus();
    };
    window.addEventListener("storage", storage);
    document.addEventListener("visibilitychange", focus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", focus);
      window.removeEventListener("online", focus);
      window.removeEventListener("looppilot-study-change", focus);
      window.removeEventListener("storage", storage);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [userId, ready, refresh]);
  const state =
    storedState?.owner === userId ? (storedState?.value ?? null) : null;
  const error = storedError?.owner === userId ? (storedError?.value ?? "") : "";
  const today = localDate(
    new Date(),
    state?.config.timezone ?? data.profile.timezone,
  );
  return { state, error, busy, refresh, today };
}
