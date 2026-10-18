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

export function useAdaptivePlanner(data: Data, userId?: string, ready = true) {
  const [storedState, setState] = useState<{
    owner: string;
    value: PlannerState;
  } | null>(null);
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
    queueMicrotask(() => void refresh());
  }, [data, userId, ready, refresh]);
  useEffect(() => {
    if (!userId || !ready) return;
    const interval = setInterval(() => {
      void refresh();
    }, 60000);
    const focus = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", focus);
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
