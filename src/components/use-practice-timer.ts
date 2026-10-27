"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { PracticeClock, type Timing } from "@/lib/practice-timer";

export function usePracticeTimer(suspended = false) {
  const clock = useRef(new PracticeClock());
  const source = useRef<Timing["source"]>("measured");
  const enabled = useRef(true);
  const historical = useRef(false);
  const [display, setDisplay] = useState({
    seconds: 0,
    running: false,
    reason: "Ready",
    known: false,
    source: "measured",
  });
  const known = useRef(false);
  // Linked scheduled practice uses the persisted session clock. Retain any
  // previously recorded attempt timing, but never advance both clocks.
  useEffect(() => {
    enabled.current = !suspended && !historical.current;
    if (suspended) clock.current.pause("Study session timing");
  }, [suspended]);
  const snapshot = useCallback(
    (): Timing | undefined =>
      known.current
        ? { seconds: clock.current.seconds(), source: source.current }
        : undefined,
    [],
  );
  const refresh = useCallback(() => {
    const seconds = clock.current.seconds();
    setDisplay({
      seconds,
      running: clock.current.running,
      reason: clock.current.reason,
      known: known.current,
      source: source.current,
    });
  }, []);
  const activity = useCallback(() => {
    if (!enabled.current || document.hidden) return;
    known.current = true;
    clock.current.activity();
    refresh();
  }, [refresh]);
  const pause = useCallback(
    (reason = "Paused") => {
      clock.current.pause(reason);
      refresh();
    },
    [refresh],
  );
  const reset = useCallback(
    (timing?: Timing, isHistorical = false) => {
      clock.current = new PracticeClock(timing?.seconds ?? 0);
      if (timing) clock.current.pause();
      known.current = Boolean(timing);
      source.current = timing?.source ?? "measured";
      historical.current = isHistorical;
      enabled.current = !isHistorical && !suspended;
      refresh();
    },
    [refresh, suspended],
  );
  const correct = useCallback(
    (seconds: number) => {
      reset({ seconds, source: "manual" });
    },
    [reset],
  );
  useEffect(() => {
    const interval = window.setInterval(refresh, 500);
    const hidden = () => {
      if (document.hidden) pause("Paused · tab hidden");
    };
    const leave = () => pause("Paused · workspace closed");
    // Reflection and test editing keep an already running session active, but don't start passive views.
    const input = () => {
      if (clock.current.running) activity();
    };
    document.addEventListener("visibilitychange", hidden);
    document.addEventListener("keydown", input);
    document.addEventListener("pointerdown", input);
    window.addEventListener("pagehide", leave);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", hidden);
      document.removeEventListener("keydown", input);
      document.removeEventListener("pointerdown", input);
      window.removeEventListener("pagehide", leave);
      clock.current.pause();
    };
  }, [activity, pause, refresh]);
  return { ...display, activity, pause, reset, correct, snapshot };
}
