"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CalendarDays, Check, Pin, RefreshCw, Settings2 } from "lucide-react";
import type { Data } from "@/lib/domain";
import type { ScheduleItem } from "@/lib/adaptive-types";
import { editPlannerItem, savePlannerConfig } from "@/lib/planner-repository";
import { studyWeek, zonedInstant } from "@/lib/study-time";
import { message } from "@/lib/form";
import { supabase } from "@/lib/supabase";
import type { useAdaptivePlanner } from "./use-adaptive-planner";
import { PlannerAvailability } from "./planner-availability";
import { Badge, Dialog, Empty, Field, SectionTitle, TaskList } from "./ui";

export function StudyPlan({
  planner,
  data,
  enabled,
  onLogSession,
  onSettingsSaved,
  onLegacyToggle,
}: {
  planner: ReturnType<typeof useAdaptivePlanner>;
  data: Data;
  enabled: boolean;
  onLogSession: () => void;
  onSettingsSaved: () => Promise<void>;
  onLegacyToggle: (t: Data["tasks"][number]) => void;
}) {
  const { state, busy, today } = planner;
  const [selected, setSelected] = useState<string | null>(null),
    [editing, setEditing] = useState(false);
  const [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const [reschedule, setReschedule] = useState<{
      day: string;
      item: ScheduleItem;
    } | null>(null),
    [newTime, setNewTime] = useState(""),
    [newDay, setNewDay] = useState("");
  const [storedCoach, setCoach] = useState<{
    key: string;
    note: string;
    focus: { key: string; reason: string }[];
    status: string;
    provider: "chatgpt" | "openai";
    model: string;
  } | null>(null);
  const [coachRequest, setCoachRequest] = useState(0);
  const [storedCoachError, setCoachError] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const day = state?.days.find((p) => p.day === (selected ?? today));
  const zone = state?.config.timezone ?? data.profile.timezone;
  const time = (value: string) =>
    new Date(value).toLocaleTimeString("en-GB", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
    });
  const todayPlan = state?.days.find((p) => p.day === today);
  const coachKey =
    state?.config.aiConsent && todayPlan
      ? `${today}:${todayPlan.sourceRevision}:${coachRequest}`
      : "";
  const coach = storedCoach?.key === coachKey ? storedCoach : null;
  const coachError =
    storedCoachError?.key === coachKey ? storedCoachError.message : "";
  useEffect(() => {
    if (!coachKey || !supabase) return;
    const abort = new AbortController();
    void (async () => {
      try {
        const {
          data: { session },
        } = await supabase!.auth.getSession();
        if (!session) return;
        const response = await fetch("/api/planner/coach", {
          method: "POST",
          headers: { Authorization: `Bearer ${session.access_token}` },
          signal: abort.signal,
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(
            result.error ??
              "OpenAI coaching is unavailable. Your deterministic schedule is ready.",
          );
        if (!abort.signal.aborted) setCoach({ ...result, key: coachKey });
      } catch (e) {
        if (!abort.signal.aborted)
          setCoachError({ key: coachKey, message: message(e) });
      }
    })();
    return () => abort.abort();
  }, [coachKey]);
  const edit = async (
    planDay: string,
    item: ScheduleItem,
    action: "complete" | "skip" | "pin" | "reschedule",
    start?: string,
  ) => {
    if (!state) return;
    setSaving(true);
    setError("");
    try {
      await editPlannerItem(state.revision, planDay, item.key, action, start);
      await planner.refresh(true);
      return true;
    } catch (e) {
      setError(message(e));
      await planner.refresh();
      return false;
    } finally {
      setSaving(false);
    }
  };
  const disabled = !enabled || busy || saving;
  const [
    evidenceReason,
    phaseReason,
    allocationReason,
    futureReason,
    ...otherReasons
  ] = day?.explanation ?? [];
  const yesterday = state?.days.find(
    (d) =>
      d.day ===
      new Date(Date.parse(today + "T00:00:00Z") - 86400000)
        .toISOString()
        .slice(0, 10),
  );
  return (
    <div className="study-plan">
      <SectionTitle
        title="Your study plan"
        description="A schedule shaped by your time, recorded progress, and next interview."
        action={
          <div className="button-group">
            <button
              className="secondary"
              disabled={!enabled || !state || busy}
              onClick={() => setEditing(true)}
            >
              <Settings2 size={16} /> Edit availability
            </button>
            <button
              className="secondary"
              disabled={!enabled}
              onClick={onLogSession}
            >
              Log study session
            </button>
          </div>
        }
      />
      {!enabled && (
        <div className="panel-note">
          Connect your workspace in <Link href="/settings">Settings</Link> to
          enter availability and generate a personal schedule.
        </div>
      )}
      {(planner.error || error) && (
        <p className="alert error" role="alert">
          {error || planner.error}{" "}
          <button
            className="text-link"
            disabled={busy}
            onClick={() => void planner.refresh(true)}
          >
            Retry planner
          </button>
        </p>
      )}
      {enabled && !state && !planner.error && (
        <p role="status">Building your schedule…</p>
      )}
      <div className="planner-stats">
        <section className="panel">
          <span>Today’s study windows</span>
          <strong>{todayPlan?.availableMinutes ?? 0} min</strong>
          <small>
            Daily study limit: {state?.config.dailyMinutes ?? 0} min.
            Availability comes from your windows, not this limit.
          </small>
        </section>
        <section className="panel">
          <span>Preparation phase</span>
          <strong>{todayPlan?.phase ?? "Awaiting availability"}</strong>
          <small>
            {todayPlan?.daysRemaining == null
              ? "Interview deadline not set"
              : `${todayPlan.daysRemaining} days until the next interview`}
          </small>
        </section>
        <section className="panel">
          <span>Reviews needing attention</span>
          <strong>{todayPlan?.overdue ?? 0}</strong>
          <small>Due or overdue from recorded attempts</small>
        </section>
      </div>
      <section
        className="panel planner-week"
        aria-label="Weekly study calendar"
      >
        <div className="panel-header">
          <h2>Your week</h2>
          <CalendarDays size={19} />
        </div>
        <p className="planner-calendar-help">
          Study times in {zone}. Select a date to see its sessions.
        </p>
        <div className="planner-week-grid">
          {studyWeek(new Date().toISOString(), zone).map((date) => {
            const p = state?.days.find((d) => d.day === date),
              study = p?.items.filter((i) => i.category !== "break") ?? [],
              completed = study.filter((i) => i.status === "completed").length,
              remaining = study
                .filter((i) => i.status === "planned")
                .reduce((sum, i) => sum + i.minutes, 0),
              noAvailability = !p?.availableMinutes;
            return (
              <button
                key={date}
                type="button"
                className={`planner-week-day ${noAvailability ? "unavailable" : ""} ${(selected ?? today) === date ? "selected" : ""}`}
                aria-label={`${date}${date === today ? ", today" : ""}: ${p?.availableMinutes ?? 0} min available, ${p?.studyMinutes ?? 0} min planned, ${completed} completed sessions, ${remaining} min study remaining`}
                aria-pressed={(selected ?? today) === date}
                onClick={() => setSelected(date)}
              >
                <span className="planner-week-date">
                  {new Date(date + "T12:00:00Z").toLocaleDateString("en-GB", {
                    timeZone: "UTC",
                    weekday: "short",
                  })}
                  <strong>{date.slice(8)}</strong>
                  {date === today && (
                    <span className="planner-today">Today</span>
                  )}
                </span>
                <span className="planner-day-metrics">
                  <span className="planner-day-available">
                    {noAvailability
                      ? "No availability"
                      : `${p.availableMinutes} min available`}
                  </span>
                  <span className="planner-day-planned">
                    {p?.studyMinutes ?? 0} min planned
                  </span>
                  <span className="planner-day-completed">
                    <Check size={13} aria-hidden="true" />
                    {completed} completed
                  </span>
                  <span>{remaining} min remaining</span>
                </span>
              </button>
            );
          })}
        </div>
        <p className="planner-calendar-help">
          Planned time includes completed sessions; remaining time is the study
          still planned. These are estimates, not recorded durations. Future
          days adapt after real results.
        </p>
      </section>
      <div className="two-columns planner-columns">
        <section className="panel planner-schedule">
          <div className="panel-header">
            <h2>
              {(selected ?? today) === today
                ? "Today’s schedule"
                : `Schedule for ${selected}`}
            </h2>
            <button
              className="text-link"
              disabled={disabled}
              onClick={() => void planner.refresh(true)}
            >
              <RefreshCw size={15} /> Regenerate remaining plan
            </button>
          </div>
          {day?.baseline && (
            <div className="planner-baseline">
              <Badge tone="amber">Baseline assessment</Badge>
              <p>No coding history yet; weaknesses are unknown.</p>
            </div>
          )}
          {day?.warnings.map((w) => (
            <p className="panel-note" key={w}>
              {w}
            </p>
          ))}
          {!day?.items.length ? (
            <Empty
              title="No sessions scheduled"
              action={
                enabled && state ? (
                  <button
                    className="text-link"
                    onClick={() => setEditing(true)}
                  >
                    Edit availability
                  </button>
                ) : undefined
              }
            >
              {state
                ? "Add study windows or choose another date. Short gaps under 15 minutes stay free."
                : "Your schedule appears here after setup."}
            </Empty>
          ) : (
            <ol className="planner-timeline">
              {day.items.map((item) => (
                <li
                  key={item.key}
                  className={`planner-session ${item.category === "break" ? "planner-break" : ""} ${item.status === "completed" ? "planner-session-completed" : ""}`}
                >
                  <div className="planner-session-time">
                    {item.status === "completed" ? (
                      <>
                        <time dateTime={item.completed_at!}>
                          {time(item.completed_at!)}
                        </time>
                        <small>Finished</small>
                      </>
                    ) : (
                      <>
                        <time dateTime={item.start}>{time(item.start)}</time>
                        <span>– {time(item.end)}</span>
                      </>
                    )}
                  </div>
                  <div className="planner-session-content">
                    <div className="planner-session-title">
                      <h3>{item.title}</h3>
                      {item.pinned && <Pin size={14} aria-label="Pinned" />}
                      <Badge
                        tone={item.status === "completed" ? "rose" : "neutral"}
                      >
                        {item.status}
                      </Badge>
                    </div>
                    <p>
                      {item.minutes} min planned · {item.category} · priority{" "}
                      {item.priority}
                    </p>
                    <details>
                      <summary>Why this session?</summary>
                      <p>{item.reason}</p>
                    </details>
                    <div className="planner-session-actions">
                      {item.problem_id && (
                        <Link
                          className="text-link"
                          href={`/coding/${item.problem_id}/practice`}
                        >
                          Open problem
                        </Link>
                      )}
                      {item.story_id && (
                        <Link className="text-link" href="/stories">
                          Open story bank
                        </Link>
                      )}
                      {item.status === "planned" && (
                        <>
                          <button
                            className="text-link"
                            disabled={disabled}
                            onClick={() => void edit(day.day, item, "complete")}
                          >
                            Complete
                          </button>
                          <button
                            className="text-link"
                            disabled={disabled}
                            onClick={() => void edit(day.day, item, "skip")}
                          >
                            Skip
                          </button>
                          <button
                            className="text-link"
                            disabled={disabled}
                            aria-label={`${item.pinned ? "Unpin" : "Pin"} ${item.title}`}
                            onClick={() => void edit(day.day, item, "pin")}
                          >
                            {item.pinned ? "Unpin" : "Pin"}
                          </button>
                          <button
                            className="text-link"
                            disabled={disabled}
                            onClick={() => {
                              setNewTime("");
                              setNewDay(day.day);
                              setReschedule({ day: day.day, item });
                            }}
                          >
                            Reschedule
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
        <section className="panel planner-reasoning">
          <h2>Why this plan?</h2>
          <section className="planner-reason-group">
            <h3>
              {(selected ?? today) === today
                ? "Today's priorities"
                : "Priorities for this date"}
            </h3>
            <p>{phaseReason ?? "Add study windows to build your plan."}</p>
            {otherReasons.map((reason) => (
              <p key={reason}>{reason}</p>
            ))}
          </section>
          <section className="planner-reason-group">
            <h3>Why these tasks?</h3>
            <p>
              {day?.baseline
                ? "No coding results yet. The plan starts with a baseline assessment; weaknesses are unknown."
                : "Recent results, review dates, and your next interview guide task selection."}
            </p>
            <details>
              <summary>Evidence & planning limits</summary>
              {evidenceReason && <p>{evidenceReason}</p>}
              {futureReason && <p>{futureReason}</p>}
              <p>Completing a session does not record an independent solve.</p>
            </details>
          </section>
          <section className="planner-reason-group">
            <h3>Study time allocation</h3>
            <p>Planned minutes by activity, including completed sessions.</p>
            <dl className="planner-allocation">
              {(
                [
                  ["coding", "Coding"],
                  ["review", "Spaced review"],
                  ["behavioral", "Behavioral"],
                  ["mock", "Rehearsal"],
                  ["debugging", "Debugging"],
                  ["break", "Breaks"],
                ] as const
              ).map(([category, label]) => (
                <div className="planner-balance" key={category}>
                  <dt>{label}</dt>
                  <dd>
                    {day?.items
                      .filter(
                        (i) =>
                          i.category === category &&
                          i.status !== "skipped" &&
                          i.status !== "missed",
                      )
                      .reduce((s, i) => s + i.minutes, 0) ?? 0}{" "}
                    min
                  </dd>
                </div>
              ))}
            </dl>
            <details>
              <summary>Study limits & recorded time</summary>
              <p>
                Breaks need extra window time. Scheduled minutes are estimates.
              </p>
              {allocationReason && <p>{allocationReason}</p>}
            </details>
          </section>
          <section className="planner-reason-group">
            <h3>Changes from yesterday</h3>
            <p>
              {yesterday
                ? `Yesterday: ${yesterday.studyMinutes} scheduled study minutes. Today: ${todayPlan?.studyMinutes ?? 0}. Scheduled time is not recorded performance.`
                : "No saved plan from yesterday to compare."}
            </p>
            <details>
              <summary>Updates to this date’s plan</summary>
              {day?.changes.map((c) => (
                <p key={c}>{c}</p>
              ))}
              {!day?.changes.length && <p>No saved changes for this date.</p>}
            </details>
          </section>
          <section className="planner-reason-group">
            <h3>AI coaching status</h3>
            {coach ? (
              <>
                <p className="planner-coach-status">
                  {coach.status === "cached"
                    ? `${coach.provider === "chatgpt" ? "Using ChatGPT plan" : "OpenAI API · separately billed"} · cached · ${coach.model}`
                    : `${coach.provider === "chatgpt" ? "Using ChatGPT plan" : "OpenAI API · separately billed"} · ${coach.model}`}
                </p>
                <p>{coach.note}</p>
                {coach.focus.map((f) => (
                  <p key={f.key}>{f.reason}</p>
                ))}
              </>
            ) : (
              <p>
                {coachError ||
                  (state?.config.aiConsent
                    ? "Preparing optional coaching…"
                    : "OpenAI coaching is off. Scheduling and explanations use the deterministic engine.")}
              </p>
            )}
            {state?.config.aiConsent && (
              <button
                className="text-link"
                disabled={
                  !enabled || busy || (!!coachKey && !coach && !coachError)
                }
                onClick={() => setCoachRequest((value) => value + 1)}
              >
                Request coaching
              </button>
            )}
            <p>
              <Link className="text-link" href="/settings">
                AI provider settings
              </Link>
              {" · "}
              <a
                className="text-link"
                href="https://chatgpt.com/settings/usage"
                target="_blank"
                rel="noreferrer"
              >
                Manage usage
              </a>
            </p>
          </section>
        </section>
      </div>
      {!!data.tasks.length && (
        <section className="panel">
          <h2>Previously scheduled tasks</h2>
          <p>
            These original records are preserved. Completing a generated session
            does not change them or record a solve.
          </p>
          <TaskList
            tasks={data.tasks}
            enabled={enabled}
            busy={disabled}
            onToggle={onLegacyToggle}
          />
        </section>
      )}
      {editing && state && (
        <PlannerAvailability
          config={state.config}
          onClose={() => setEditing(false)}
          onSave={async (config) => {
            await savePlannerConfig(state.revision, config);
            await onSettingsSaved();
            await planner.refresh(true);
          }}
        />
      )}
      {reschedule && (
        <Dialog
          title="Reschedule session"
          onClose={() => {
            if (!saving) setReschedule(null);
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void (async () => {
                try {
                  const start = zonedInstant(newDay, newTime, zone);
                  if (start === null)
                    throw new Error(
                      "That time does not exist in your timezone.",
                    );
                  if (
                    await edit(
                      reschedule.day,
                      reschedule.item,
                      "reschedule",
                      new Date(start).toISOString(),
                    )
                  )
                    setReschedule(null);
                } catch (e) {
                  setError(message(e));
                }
              })();
            }}
          >
            <p>
              Choose a free window in {zone}. Rescheduled sessions are pinned.
              Moving to another day keeps the original session as skipped and
              preserves completed history.
            </p>
            <Field label="New date">
              <input
                required
                type="date"
                min={today}
                max={studyWeek(new Date().toISOString(), zone).at(-1)}
                value={newDay}
                onChange={(e) => setNewDay(e.target.value)}
              />
            </Field>
            <Field label="New start time">
              <input
                required
                type="time"
                value={newTime}
                onChange={(e) => setNewTime(e.target.value)}
              />
            </Field>
            {error && (
              <p role="alert" className="danger">
                {error}
              </p>
            )}
            <div className="form-footer">
              <button
                type="button"
                className="secondary"
                onClick={() => setReschedule(null)}
              >
                Cancel
              </button>
              <button className="primary" disabled={saving}>
                Reschedule
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
