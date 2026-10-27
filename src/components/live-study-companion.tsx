"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { currentStudy, liveSeconds, signalStudyChange } from "@/lib/live-study";
import { liveStudyAction } from "@/lib/planner-repository";
import { message } from "@/lib/form";
import { availableIntervals } from "@/lib/study-time";
import type { useAdaptivePlanner } from "./use-adaptive-planner";
import { useStudyClock } from "./use-study-clock";

type Action = Parameters<typeof liveStudyAction>[3];
export function LiveStudyCompanion({
  planner,
  userId,
}: {
  planner: ReturnType<typeof useAdaptivePlanner>;
  userId: string;
}) {
  const [expanded, setExpanded] = useState(false),
    [tabToken, setTabToken] = useState("");
  useEffect(() => {
    const open = () => {
      setExpanded(true);
      panel.current
        ?.querySelector<HTMLButtonElement>(".companion-toggle")
        ?.focus();
    };
    window.addEventListener("looppilot-open-companion", open);
    return () => window.removeEventListener("looppilot-open-companion", open);
  }, []);
  const now = useStudyClock(1000);
  const [mountedAt] = useState(() => Date.now());
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const pending = useRef(false),
    token = useRef(""),
    panel = useRef<HTMLElement>(null);
  const observedClock = useRef(0);
  const observing = useRef(true);
  const latest = useRef(planner);
  const lastDue = useRef(""),
    lastCompletion = useRef("");
  const lastBreakFinish = useRef(0);
  useEffect(() => {
    latest.current = planner;
  }, [planner]);
  useEffect(() => {
    let identity = sessionStorage.getItem("looppilot-study-tab");
    if (!identity) {
      identity = crypto.randomUUID();
      sessionStorage.setItem("looppilot-study-tab", identity);
    }
    token.current = identity;
    observedClock.current = performance.now();
    observing.current = document.visibilityState === "visible";
    queueMicrotask(() => setTabToken(identity));
  }, []);
  const { current, next, active } = currentStudy(planner.state, now);
  const item = current?.item;
  useEffect(() => {
    observing.current =
      item?.live?.state === "running" &&
      item.live.owner_token === token.current &&
      document.visibilityState === "visible";
    observedClock.current = performance.now();
  }, [item?.live?.state, item?.live?.owner_token, item?.live?.started_at]);
  const seconds = item
    ? liveSeconds(
        item,
        now,
        item.live?.owner_token === tabToken ? mountedAt : now,
      )
    : 0;
  const format = (s: number) =>
    `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s)) % 60).padStart(2, "0")}`;
  const time = (s: string) =>
    new Date(s).toLocaleTimeString("en-GB", {
      timeZone: planner.state?.config.timezone,
      hour: "2-digit",
      minute: "2-digit",
    });
  const datedTime = (s: string) =>
    new Date(s).toLocaleString("en-GB", {
      timeZone: planner.state?.config.timezone,
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  async function act(action: Action, quiet = false) {
    const p = latest.current,
      target = currentStudy(p.state, Date.now()).current;
    if (pending.current || !p.state || !target) return;
    pending.current = true;
    if (!quiet) {
      setSaving(true);
      setError("");
    }
    try {
      // Only credit time witnessed by this mounted observer, never a navigation,
      // refresh or closed-app gap between server heartbeats.
      const observed = observing.current
        ? Math.min(
            15,
            Math.max(0, (performance.now() - observedClock.current) / 1000),
          )
        : 0;
      await liveStudyAction(
        p.state.revision,
        target.day,
        target.item.key,
        action,
        token.current,
        observed,
      );
      observedClock.current = performance.now();
      if (action === "pause") observing.current = false;
      if (action === "start" || action === "resume")
        observing.current = document.visibilityState === "visible";
      if (action !== "heartbeat") {
        signalStudyChange();
        if (action === "finish" || action === "break_elapsed")
          setNotice("Session finished. Adjusting your remaining schedule.");
        if (action === "skip")
          setNotice("Session skipped. Adjusting your remaining schedule.");
      }
      await p.refresh();
    } catch (e) {
      setError(
        `${message(e)} Your last saved session is retained. Reconnect and retry.`,
      );
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }
  const actionRef = useRef(act);
  useEffect(() => {
    actionRef.current = act;
  });
  useEffect(() => {
    const beat = setInterval(() => {
      const p = latest.current;
      const a = currentStudy(p.state, Date.now()).active;
      if (
        observing.current &&
        document.visibilityState === "visible" &&
        a?.item.live?.state === "running" &&
        a.item.live.owner_token === token.current
      )
        void actionRef.current("heartbeat", true);
    }, 5000);
    const hidden = () => {
      const a = currentStudy(latest.current.state, Date.now()).active;
      if (document.visibilityState === "hidden") observing.current = false;
      if (
        !observing.current &&
        a?.item.live?.state === "running" &&
        a.item.live.owner_token === token.current
      )
        void actionRef.current("pause", true);
    };
    document.addEventListener("visibilitychange", hidden);
    const leave = () => {
      observing.current = false;
      const a = currentStudy(latest.current.state, Date.now()).active;
      if (
        a?.item.live?.state === "running" &&
        a.item.live.owner_token === token.current
      )
        void actionRef.current("pause", true);
    };
    window.addEventListener("pagehide", leave);
    return () => {
      clearInterval(beat);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", leave);
    };
  }, [userId]);
  useEffect(() => {
    if (
      item?.category === "break" &&
      item.live?.state === "running" &&
      item.live.owner_token === token.current &&
      item.live.elapsed_seconds >= item.minutes * 60 &&
      !pending.current &&
      now - lastBreakFinish.current >= 5000
    ) {
      lastBreakFinish.current = now;
      void actionRef.current("break_elapsed");
    }
  }, [item, now]);
  useEffect(() => {
    if (
      item &&
      !active &&
      Date.parse(item.start) <= now &&
      lastDue.current !== item.key
    ) {
      lastDue.current = item.key;
      queueMicrotask(() => setNotice(`Due now: ${item.title}`));
    }
    const completed = planner.state?.days
      .flatMap((d) => d.items)
      .filter((i) => i.live && i.completed_at)
      .sort((a, b) => b.completed_at!.localeCompare(a.completed_at!))[0];
    if (completed && lastCompletion.current !== completed.completed_at) {
      const previous = lastCompletion.current;
      lastCompletion.current = completed.completed_at!;
      if (previous || Date.now() - Date.parse(completed.completed_at!) < 15000)
        queueMicrotask(() =>
          setNotice(
            `${completed.title} finished. Your remaining schedule has been adjusted.`,
          ),
        );
    }
  }, [item, active, now, planner.state]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 10000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!panel.current) return;
    const observer = new ResizeObserver(([entry]) =>
      document.body.style.setProperty(
        "--companion-space",
        `${entry.target.getBoundingClientRect().height + 20}px`,
      ),
    );
    observer.observe(panel.current);
    document.body.classList.add("has-study-companion");
    return () => {
      observer.disconnect();
      document.body.classList.remove("has-study-companion");
      document.body.style.removeProperty("--companion-space");
    };
  }, []);
  if (!planner.state) return null;
  const remaining = Math.max(0, (item?.minutes ?? 0) * 60 - seconds);
  const running = item?.live?.state === "running";
  const elsewhere = running && item.live?.owner_token !== tabToken;
  const due = item && Date.parse(item.start) <= now;
  const canStart =
    current?.day === planner.today &&
    availableIntervals(planner.state.config, planner.today).some(
      (s) => s.start <= now && s.end > now,
    );
  const href = item?.problem_id
    ? `/coding/${item.problem_id}/practice`
    : item?.story_id
      ? `/stories#story-${encodeURIComponent(item.story_id)}`
      : "/plan";
  return (
    <aside
      className={`study-companion ${expanded ? "expanded" : "compact"}`}
      aria-label="Live study companion"
      ref={panel}
    >
      <button
        className="companion-toggle"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls="companion-details"
      >
        <span>
          <small>{item?.live?.state ?? (due ? "Due now" : "Up next")}</small>
          <strong>{item?.title ?? "No upcoming study session"}</strong>
        </span>
        <span className="companion-clock">
          {item?.category === "break" ? format(remaining) : format(seconds)}
        </span>
        {expanded ? (
          <ChevronDown size={17} aria-label="Minimize" />
        ) : (
          <ChevronUp size={17} aria-label="Expand" />
        )}
      </button>
      <div role="status" className="companion-notice">
        {notice}
      </div>
      {expanded && (
        <div id="companion-details">
          {item ? (
            <>
              <p>
                {current?.day === planner.today
                  ? time(item.start)
                  : datedTime(item.start)}
                –{time(item.end)} · {item.category} ·{" "}
                {planner.state.config.timezone}
              </p>
              <p>
                {format(seconds)} active · {format(remaining)} estimated
                remaining
              </p>
              <progress
                value={Math.min(seconds, item.minutes * 60)}
                max={item.minutes * 60}
                aria-label="Estimated session progress"
              />
              {elsewhere && (
                <p>Running in another tab. Pause here to take over.</p>
              )}
              <div className="companion-actions">
                {!item.live && (
                  <button
                    className="primary"
                    disabled={saving || !canStart}
                    onClick={() => void act("start")}
                  >
                    Start
                  </button>
                )}
                {running && (
                  <button
                    className="secondary"
                    disabled={saving}
                    onClick={() => void act("pause")}
                  >
                    Pause
                  </button>
                )}
                {item.live?.state === "paused" && (
                  <button
                    className="primary"
                    disabled={saving}
                    onClick={() => void act("resume")}
                  >
                    Resume
                  </button>
                )}
                <button
                  className="secondary"
                  disabled={saving}
                  onClick={() => void act("finish")}
                >
                  {item.category === "break" ? "End break" : "Finish"}
                </button>
                <button
                  className="text-link"
                  disabled={saving}
                  onClick={() => void act("skip")}
                >
                  Skip
                </button>
                <Link href={href} className="text-link">
                  Open task
                </Link>
              </div>
              {item.category === "behavioral" && (
                <p className="companion-help">
                  Finish after rehearsing. Editing a story does not record
                  practice.
                </p>
              )}
              {item.problem_id && !item.live && (
                <p className="companion-help">
                  Start to link a new coding attempt. Saving a recorded outcome
                  finishes practice, including failed or guided attempts.
                </p>
              )}
              <p className="companion-next">
                Next:{" "}
                {next
                  ? `${next.item.title} · ${datedTime(next.item.start)}${next.day !== planner.today ? " (provisional)" : ""}`
                  : "No further session scheduled"}
              </p>
            </>
          ) : (
            <p>
              <Link href="/plan">Set study availability</Link> to schedule your
              next session.
            </p>
          )}
          <p className="companion-help">
            Hidden or closed sessions pause after reconciliation. Resume when
            you return.
          </p>
        </div>
      )}
      {(error || planner.error) && (
        <p role="alert" className="danger">
          {error || planner.error}{" "}
          <button
            className="text-link"
            onClick={() => {
              setError("");
              void planner.refresh();
            }}
          >
            Retry
          </button>
        </p>
      )}
    </aside>
  );
}
