"use client";
import { useId, useRef, useState } from "react";
import { ZodError } from "zod";
import type { PlannerConfig } from "@/lib/adaptive-types";
import { plannerConfigSchema } from "@/lib/adaptive-types";
import { zonedInstant } from "@/lib/study-time";
import { message } from "@/lib/form";
import { Dialog, Field } from "./ui";

const weekdays = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
function periodTime(value: string, timezone: string) {
  try {
    return new Date(value).toLocaleString("en-GB", { timeZone: timezone });
  } catch {
    return value;
  }
}
type Window = PlannerConfig["weekly"][number][number];
const sections = [
  ["schedule", "Study schedule"],
  ["interviews", "Interview rounds"],
  ["exceptions", "Days off & exceptions"],
  ["advanced", "Advanced settings"],
  ["coaching", "AI coaching"],
] as const;
type Section = (typeof sections)[number][0];
function Windows({
  value,
  onChange,
  label,
}: {
  value: Window[];
  onChange: (v: Window[]) => void;
  label: string;
}) {
  return (
    <fieldset className="availability-windows">
      <legend>{label}</legend>
      <div className="availability-window-list">
        {!value.length && <p className="muted">Unavailable</p>}
        {value.map((w, i) => (
          <div className="availability-window" key={i}>
            <Field label={`${label} start ${i + 1}`}>
              <input
                type="time"
                required
                value={w.start}
                onChange={(e) =>
                  onChange(
                    value.map((v, j) =>
                      j === i ? { ...v, start: e.target.value } : v,
                    ),
                  )
                }
              />
            </Field>
            <Field label={`${label} end ${i + 1}`}>
              <input
                type="time"
                required
                value={w.end === "24:00" ? "00:00" : w.end}
                onChange={(e) =>
                  onChange(
                    value.map((v, j) =>
                      j === i
                        ? {
                            ...v,
                            end:
                              e.target.value === "00:00"
                                ? "24:00"
                                : e.target.value,
                          }
                        : v,
                    ),
                  )
                }
              />
            </Field>
            <button
              type="button"
              className="text-link"
              aria-label={`Remove ${label} window ${i + 1}`}
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="text-link"
        disabled={value.length >= 6}
        onClick={() => onChange([...value, { start: "18:00", end: "20:00" }])}
      >
        Add time window
      </button>
    </fieldset>
  );
}
export function PlannerAvailability({
  config,
  onClose,
  onSave,
}: {
  config: PlannerConfig;
  onClose: () => void;
  onSave: (c: PlannerConfig) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => structuredClone(config));
  const [section, setSection] = useState<Section>("schedule");
  const tabId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const selectSection = (next: Section) => {
    setSection(next);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  };
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [blockStart, setBlockStart] = useState(""),
    [blockEnd, setBlockEnd] = useState("");
  const patch = (v: Partial<PlannerConfig>) =>
    setDraft((d) => ({ ...d, ...v }));
  return (
    <Dialog
      title="Availability & interviews"
      className="planner-dialog"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="planner-preferences"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const invalid = Array.from(e.currentTarget.elements).find(
            (el): el is HTMLInputElement | HTMLSelectElement =>
              (el instanceof HTMLInputElement ||
                el instanceof HTMLSelectElement) &&
              !el.validity.valid,
          );
          if (invalid) {
            selectSection(
              invalid.closest<HTMLElement>("[data-settings-section]")!.dataset
                .settingsSection as Section,
            );
            requestAnimationFrame(() => {
              invalid.focus();
              invalid.reportValidity();
            });
            return;
          }
          setError("");
          setBusy(true);
          void (async () => {
            try {
              const parsed = plannerConfigSchema.parse(draft);
              for (const r of parsed.rounds)
                if (
                  zonedInstant(r.date, r.time, parsed.interviewTimezone) ===
                  null
                )
                  throw new Error(
                    "That interview time does not exist during a daylight-saving transition.",
                  );
              await onSave(parsed);
              onClose();
            } catch (e) {
              if (e instanceof ZodError) {
                const issue = e.issues[0];
                const field = String(issue.path[0] ?? "");
                selectSection(
                  !field
                    ? section
                    : field === "rounds" || field === "interviewTimezone"
                      ? "interviews"
                      : field === "overrides" || field === "unavailable"
                        ? "exceptions"
                        : field === "phaseDays" ||
                            field === "sessionMinutes" ||
                            field === "breakMinutes"
                          ? "advanced"
                          : field === "aiConsent"
                            ? "coaching"
                            : "schedule",
                );
                setError(issue.message);
              } else setError(message(e));
            } finally {
              setBusy(false);
            }
          })();
        }}
      >
        <div
          className="planner-settings-tabs"
          role="tablist"
          aria-label="Availability sections"
        >
          {sections.map(([id, label], index) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`${tabId}-${id}-tab`}
              aria-controls={`${tabId}-${id}-panel`}
              aria-selected={section === id}
              tabIndex={section === id ? 0 : -1}
              onClick={() => selectSection(id)}
              onKeyDown={(event) => {
                let next = index;
                if (event.key === "ArrowRight")
                  next = (index + 1) % sections.length;
                else if (event.key === "ArrowLeft")
                  next = (index + sections.length - 1) % sections.length;
                else if (event.key === "Home") next = 0;
                else if (event.key === "End") next = sections.length - 1;
                else return;
                event.preventDefault();
                selectSection(sections[next][0]);
                document
                  .getElementById(`${tabId}-${sections[next][0]}-tab`)
                  ?.focus();
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="planner-settings-scroll" ref={scrollRef}>
          <fieldset className="planner-settings-fields" disabled={busy}>
            <section
              id={`${tabId}-schedule-panel`}
              role="tabpanel"
              aria-labelledby={`${tabId}-schedule-tab`}
              hidden={section !== "schedule"}
              data-settings-section="schedule"
              className="planner-settings-panel"
              tabIndex={0}
            >
              <div className="planner-section-heading">
                <h3>Study schedule</h3>
                <p>Choose when you can study. Empty days stay unavailable.</p>
              </div>
              <div className="planner-form-grid">
                <Field label="Study timezone">
                  <input
                    required
                    value={draft.timezone}
                    onChange={(e) => patch({ timezone: e.target.value })}
                  />
                </Field>
                <Field label="Daily study limit (hours)">
                  <input
                    required
                    type="number"
                    min="0"
                    max="12"
                    step="0.25"
                    value={draft.dailyMinutes / 60}
                    onChange={(e) =>
                      patch({
                        dailyMinutes: Math.round(Number(e.target.value) * 60),
                      })
                    }
                  />
                </Field>
                <Field label="Study intensity">
                  <select
                    value={draft.intensity}
                    onChange={(e) =>
                      patch({
                        intensity: e.target.value as PlannerConfig["intensity"],
                      })
                    }
                  >
                    <option value="gentle">
                      Gentle · use 75% of daily hours
                    </option>
                    <option value="balanced">Balanced</option>
                    <option value="intensive">
                      Intensive · use full daily hours
                    </option>
                  </select>
                </Field>
              </div>
              <p className="planner-help">
                The daily limit caps focused study; it does not create
                availability. Breaks also need room in your windows.
              </p>
              <h3>Recurring weekly availability</h3>
              <p className="muted">
                An end time of 00:00 means midnight at the end of that day.
                Split overnight windows across two days.
              </p>
              {[1, 2, 3, 4, 5, 6, 0].map((day) => (
                <Windows
                  key={day}
                  label={weekdays[day]}
                  value={draft.weekly[day]}
                  onChange={(windows) =>
                    patch({
                      weekly: draft.weekly.map((v, i) =>
                        i === day ? windows : v,
                      ),
                    })
                  }
                />
              ))}
            </section>
            <section
              id={`${tabId}-interviews-panel`}
              role="tabpanel"
              aria-labelledby={`${tabId}-interviews-tab`}
              hidden={section !== "interviews"}
              data-settings-section="interviews"
              className="planner-settings-panel"
              tabIndex={0}
            >
              <div className="planner-section-heading">
                <h3>Interview rounds</h3>
                <p>
                  Priorities follow the next round’s format. Past rounds stay
                  recorded.
                </p>
              </div>
              <Field label="Interview timezone">
                <input
                  required
                  value={draft.interviewTimezone}
                  onChange={(e) => patch({ interviewTimezone: e.target.value })}
                />
              </Field>
              <p className="planner-help">
                Enter each round’s exact date and time in this timezone.
              </p>
              {draft.rounds.map((r, i) => (
                <fieldset className="planner-round" key={r.id}>
                  <legend>Interview round {i + 1}</legend>
                  <div className="planner-form-grid">
                    <Field label={`Round ${i + 1} title`}>
                      <input
                        required
                        maxLength={200}
                        value={r.title}
                        onChange={(e) =>
                          patch({
                            rounds: draft.rounds.map((v, j) =>
                              j === i ? { ...v, title: e.target.value } : v,
                            ),
                          })
                        }
                      />
                    </Field>
                    <Field label={`Round ${i + 1} format`}>
                      <select
                        value={r.format}
                        onChange={(e) =>
                          patch({
                            rounds: draft.rounds.map((v, j) =>
                              j === i
                                ? {
                                    ...v,
                                    format: e.target.value as typeof r.format,
                                  }
                                : v,
                            ),
                          })
                        }
                      >
                        <option value="mixed">Coding & behavioral</option>
                        <option value="coding">Coding</option>
                        <option value="behavioral">Behavioral</option>
                      </select>
                    </Field>
                    <Field label={`Round ${i + 1} date`}>
                      <input
                        required
                        type="date"
                        value={r.date}
                        onChange={(e) =>
                          patch({
                            rounds: draft.rounds.map((v, j) =>
                              j === i ? { ...v, date: e.target.value } : v,
                            ),
                          })
                        }
                      />
                    </Field>
                    <Field label={`Round ${i + 1} time`}>
                      <input
                        required
                        type="time"
                        value={r.time}
                        onChange={(e) =>
                          patch({
                            rounds: draft.rounds.map((v, j) =>
                              j === i ? { ...v, time: e.target.value } : v,
                            ),
                          })
                        }
                      />
                    </Field>
                    <Field label={`Round ${i + 1} duration minutes`}>
                      <input
                        required
                        type="number"
                        min="15"
                        max="480"
                        value={r.duration}
                        onChange={(e) =>
                          patch({
                            rounds: draft.rounds.map((v, j) =>
                              j === i
                                ? { ...v, duration: Number(e.target.value) }
                                : v,
                            ),
                          })
                        }
                      />
                    </Field>
                  </div>
                  <button
                    type="button"
                    className="text-link"
                    onClick={() =>
                      patch({ rounds: draft.rounds.filter((_, j) => j !== i) })
                    }
                  >
                    Remove round {i + 1}
                  </button>
                </fieldset>
              ))}
              <button
                type="button"
                className="secondary"
                disabled={draft.rounds.length >= 20}
                onClick={() =>
                  patch({
                    rounds: [
                      ...draft.rounds,
                      {
                        id: crypto.randomUUID(),
                        title: "Interview",
                        date: "",
                        time: "",
                        duration: 60,
                        format: "mixed",
                      },
                    ],
                  })
                }
              >
                Add interview round
              </button>
            </section>
            <section
              id={`${tabId}-exceptions-panel`}
              role="tabpanel"
              aria-labelledby={`${tabId}-exceptions-tab`}
              hidden={section !== "exceptions"}
              data-settings-section="exceptions"
              className="planner-settings-panel"
              tabIndex={0}
            >
              <div className="planner-section-heading">
                <h3>Days off & exceptions</h3>
                <p>
                  Adjust individual dates without changing your weekly schedule.
                </p>
              </div>
              <h3>Date overrides & days off</h3>
              <p className="muted">
                An override replaces that date’s weekly windows. Leave its
                windows empty for a day off.
              </p>
              {draft.overrides.map((o, i) => (
                <div className="planner-override" key={i}>
                  <Field label={`Override ${i + 1} date`}>
                    <input
                      required
                      type="date"
                      value={o.date}
                      onChange={(e) =>
                        patch({
                          overrides: draft.overrides.map((v, j) =>
                            i === j ? { ...v, date: e.target.value } : v,
                          ),
                        })
                      }
                    />
                  </Field>
                  <Windows
                    label={`Override ${i + 1}`}
                    value={o.windows}
                    onChange={(windows) =>
                      patch({
                        overrides: draft.overrides.map((v, j) =>
                          i === j ? { ...v, windows } : v,
                        ),
                      })
                    }
                  />
                  <button
                    type="button"
                    className="text-link"
                    onClick={() =>
                      patch({
                        overrides: draft.overrides.filter((_, j) => i !== j),
                      })
                    }
                  >
                    Remove override
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  patch({
                    overrides: [...draft.overrides, { date: "", windows: [] }],
                  })
                }
              >
                Add date override
              </button>
              <h3>Unavailable periods</h3>
              <p className="muted">
                Entered in your study timezone. Repeated daylight-saving times
                use the earlier occurrence.
              </p>
              {draft.unavailable.map((b, i) => (
                <div className="button-group" key={i}>
                  <span>
                    {periodTime(b.start, draft.timezone)} –{" "}
                    {periodTime(b.end, draft.timezone)}
                  </span>
                  <button
                    type="button"
                    className="text-link"
                    onClick={() =>
                      patch({
                        unavailable: draft.unavailable.filter(
                          (_, j) => j !== i,
                        ),
                      })
                    }
                  >
                    Remove period {i + 1}
                  </button>
                </div>
              ))}
              <div className="planner-form-grid">
                <Field label="Unavailable start">
                  <input
                    type="datetime-local"
                    value={blockStart}
                    onChange={(e) => setBlockStart(e.target.value)}
                  />
                </Field>
                <Field label="Unavailable end">
                  <input
                    type="datetime-local"
                    value={blockEnd}
                    onChange={(e) => setBlockEnd(e.target.value)}
                  />
                </Field>
              </div>
              <button
                type="button"
                className="secondary"
                disabled={!blockStart || !blockEnd}
                onClick={() => {
                  try {
                    const a = zonedInstant(
                        blockStart.slice(0, 10),
                        blockStart.slice(11, 16),
                        draft.timezone,
                      ),
                      b = zonedInstant(
                        blockEnd.slice(0, 10),
                        blockEnd.slice(11, 16),
                        draft.timezone,
                      );
                    if (a === null || b === null || b <= a)
                      throw new Error("Choose a valid unavailable period.");
                    patch({
                      unavailable: [
                        ...draft.unavailable,
                        {
                          start: new Date(a).toISOString(),
                          end: new Date(b).toISOString(),
                        },
                      ],
                    });
                    setBlockStart("");
                    setBlockEnd("");
                    setError("");
                  } catch (e) {
                    setError(message(e));
                  }
                }}
              >
                Add unavailable period
              </button>
            </section>
            <section
              id={`${tabId}-advanced-panel`}
              role="tabpanel"
              aria-labelledby={`${tabId}-advanced-tab`}
              hidden={section !== "advanced"}
              data-settings-section="advanced"
              className="planner-settings-panel"
              tabIndex={0}
            >
              <div className="planner-section-heading">
                <h3>Advanced settings</h3>
                <p>Set session length, breaks, and preparation phases.</p>
              </div>
              <div className="planner-form-grid">
                {" "}
                <Field label="Maximum session minutes">
                  <input
                    type="number"
                    required
                    min="15"
                    max="90"
                    value={draft.sessionMinutes}
                    onChange={(e) =>
                      patch({ sessionMinutes: Number(e.target.value) })
                    }
                  />
                </Field>{" "}
                <Field label="Break minutes">
                  <input
                    type="number"
                    required
                    min="5"
                    max="30"
                    value={draft.breakMinutes}
                    onChange={(e) =>
                      patch({ breakMinutes: Number(e.target.value) })
                    }
                  />
                </Field>
              </div>
              <h3>Preparation phase boundaries</h3>
              <p>
                Days before the next round. Performance can shorten sessions or
                increase review even in an earlier phase.
              </p>
              <div className="planner-form-grid">
                {(
                  [
                    ["foundations", "Begin focused practice", 8, 120],
                    ["focused", "Begin interview rehearsal", 3, 60],
                    ["taper", "Begin light review", 1, 3],
                  ] as const
                ).map(([key, label, min, max]) => (
                  <Field key={key} label={label}>
                    <input
                      type="number"
                      required
                      min={min}
                      max={max}
                      value={draft.phaseDays[key]}
                      onChange={(e) =>
                        patch({
                          phaseDays: {
                            ...draft.phaseDays,
                            [key]: Number(e.target.value),
                          },
                        })
                      }
                    />
                  </Field>
                ))}
              </div>
            </section>
            <section
              id={`${tabId}-coaching-panel`}
              role="tabpanel"
              aria-labelledby={`${tabId}-coaching-tab`}
              hidden={section !== "coaching"}
              data-settings-section="coaching"
              className="planner-settings-panel"
              tabIndex={0}
            >
              <div className="planner-section-heading">
                <h3>AI coaching</h3>
                <p>
                  Optional coaching notes alongside your deterministic schedule.
                </p>
              </div>
              <label className="planner-consent">
                <input
                  type="checkbox"
                  checked={draft.aiConsent}
                  onChange={(e) => patch({ aiConsent: e.target.checked })}
                />{" "}
                Allow a structured performance summary and plan to be sent to
                OpenAI for coaching notes.
              </label>
              <p className="muted">
                Off by default. Excludes code, story text, and personal names.
                Choose a provider in Settings: ChatGPT plan uses your existing
                allowance; OpenAI API requires a server key and separate
                billing. Scheduling works without AI. Requests never switch
                providers.
              </p>
            </section>
          </fieldset>
        </div>
        <div className="planner-settings-footer">
          {error && (
            <p className="alert error" role="alert">
              {error}
            </p>
          )}
          <div className="form-footer">
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </button>
            <button className="primary" disabled={busy}>
              {busy ? "Saving…" : "Save availability"}
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
