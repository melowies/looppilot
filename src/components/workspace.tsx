"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowDownToLine,
  ArrowRight,
  BookOpen,
  Check,
  Code2,
  Loader2,
  Plus,
  ShieldCheck,
  Target,
  Trash2,
  X,
} from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import {
  type Data,
  emptyData,
  importSchema,
  localDate,
  patterns,
  principles,
  storySchema,
} from "@/lib/domain";
import { readiness } from "@/lib/planner";
import { configured, supabase } from "@/lib/supabase";
import { loadData, remove, save } from "@/lib/repository";
import { importHistory } from "@/lib/history-import";
import { clearStudy } from "@/lib/live-study";
import { LiveStudyEditorStatus } from "./live-study-editor-status";

import { CodingPractice } from "./coding-practice";
import { Navigation } from "./navigation";
import { Overview } from "./overview";
import { Auth } from "./auth";
import { Settings } from "./settings";
import { AdaptivePlannerHost } from "./adaptive-planner-host";
import { EditorFields, type Editor } from "./editor-fields";
import { Badge, Dialog, Empty, PatternChart, SectionTitle } from "./ui";
import { get, num, message } from "@/lib/form";
import {
  duplicateProblem,
  parseLeetcodeNumber,
  problemFormSchema,
} from "@/lib/leetcode";

export default function Workspace({
  practiceProblemId,
}: {
  practiceProblemId?: string;
}) {
  const router = useRouter();
  const path = usePathname();
  const [session, setSession] = useState<Session | null>(null),
    [authReady, setAuthReady] = useState(!configured);
  const [recovering, setRecovering] = useState(false);
  const [data, setData] = useState<Data>(emptyData),
    [loading, setLoading] = useState(configured),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null),
    [busy, setBusy] = useState(false);
  const [query, setQuery] = useState(""),
    [pattern, setPattern] = useState("All patterns"),
    [difficulty, setDifficulty] = useState("All difficulties"),
    [status, setStatus] = useState("All statuses"),
    [principle, setPrinciple] = useState("All principles");
  const [problemLookupPending, setProblemLookupPending] = useState(false);
  const activeProblem = data.problems.find(
    (problem) => problem.id === practiceProblemId,
  );
  const [today, setToday] = useState(() =>
    localDate(new Date(), "Europe/Istanbul"),
  );
  const sessionId = useRef<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    table: string;
    id: string;
    label: string;
  } | null>(null);
  const refresh = useCallback(async () => {
    const owner = sessionId.current;
    setLoading(true);
    try {
      const next = await loadData();
      if (sessionId.current === owner) setData(next);
    } catch (e) {
      if (sessionId.current === owner) setError(message(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    const recovery =
      new URLSearchParams(window.location.search).get("recovery") === "1" ||
      window.location.hash.includes("type=recovery");
    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) setError(error.message);
      sessionId.current = data.session?.user.id ?? null;
      setSession(data.session);
      setRecovering(recovery);
      setAuthReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, s) => {
      if (sessionId.current !== (s?.user.id ?? null)) {
        if (sessionId.current) clearStudy(sessionId.current);
        setData(emptyData);
        setEditor(null);
        setError("");
        setNotice("");
      }
      sessionId.current = s?.user.id ?? null;
      setSession(s);
      setAuthReady(true);
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
      if (!s) setData(emptyData);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);
  const userId = session?.user.id;
  useEffect(() => {
    if (!userId || practiceProblemId) return;
    const changed = (event: StorageEvent) => {
      if (
        event.key === "looppilot-evidence-signal" &&
        document.visibilityState === "visible"
      )
        void refresh();
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [userId, practiceProblemId, refresh]);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void loadData()
      .then((next) => {
        if (!cancelled) {
          setData(next);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(message(e));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);
  useEffect(() => {
    const update = () => setToday(localDate(new Date(), data.profile.timezone));
    update();
    const timer = setInterval(update, 60000);
    return () => clearInterval(timer);
  }, [data.profile.timezone]);
  const enabled = Boolean(session && configured);
  const score = readiness(data.attempts, data.stories);
  const independent = new Set(
    data.attempts
      .filter(
        (a) => a.assistance === "independent" && a.correctness === "passed",
      )
      .map((a) => a.problem_id),
  ).size;
  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(success);
      await refresh();
      return true;
    } catch (e) {
      setError(message(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function submitEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;
    const f = new FormData(event.currentTarget);
    const ok = await run(async () => {
      if (editor.kind === "problem") {
        if (get(f, "lookup_pending") === "true")
          throw new Error(
            "Wait for the metadata lookup to finish before saving.",
          );
        const value = problemFormSchema.parse({
          title: get(f, "title"),
          url: get(f, "url"),
          difficulty: get(f, "difficulty"),
          pattern: get(f, "pattern"),
          leetcode_id: get(f, "leetcode_id").trim()
            ? parseLeetcodeNumber(get(f, "leetcode_id"))
            : null,
          topic_tags: JSON.parse(get(f, "topic_tags") || "[]"),
        });
        const duplicate = duplicateProblem(
          data.problems,
          value,
          editor.value?.id,
        );
        if (duplicate)
          throw new Error(
            `Already in your library: ${duplicate.title}. Open that problem to record another attempt.`,
          );
        await save("coding_problems", value, editor.value?.id);
      }
      if (editor.kind === "story")
        await save(
          "behavioral_stories",
          {
            ...storySchema.parse({
              title: get(f, "title"),
              principles: f.getAll("principles"),
              situation: get(f, "situation"),
              task: get(f, "task"),
              action: get(f, "action"),
              result: get(f, "result"),
              evidence: get(f, "evidence"),
              follow_up_questions: get(f, "follow_up_questions"),
              confidence:
                get(f, "confidence") === "" ? null : num(f, "confidence"),
              status: get(f, "status"),
            }),
            updated_at: new Date().toISOString(),
          },
          editor.value?.id,
        );
      if (editor.kind === "session") {
        const duration = num(f, "duration_minutes");
        if (!Number.isInteger(duration) || duration < 1 || duration > 1440)
          throw new Error("Enter 1–1440 minutes.");
        await save("study_sessions", {
          studied_on: get(f, "studied_on"),
          duration_minutes: duration,
          focus: get(f, "focus"),
          notes: get(f, "notes"),
        });
      }
    }, "Saved to your private workspace.");
    if (ok) setEditor(null);
  }
  const addProblem = (
    <button
      className="primary"
      disabled={!enabled || busy || loading}
      onClick={() => setEditor({ kind: "problem" })}
    >
      <Plus size={16} /> Add problem
    </button>
  );
  if (!authReady)
    return (
      <main className="loading">
        <Loader2 className="spin" /> Opening LoopPilot…
      </main>
    );
  if (configured && (!session || recovering))
    return (
      <Auth
        error={error}
        recovering={recovering}
        onRecovered={() => {
          setRecovering(false);
          window.history.replaceState(null, "", window.location.pathname);
        }}
      />
    );
  return (
    <div className="shell">
      <Navigation
        path={practiceProblemId ? "/coding" : path}
        name={data.profile.display_name}
        signedIn={Boolean(session)}
        onNavigate={() => {}}
        onSignOut={() =>
          void supabase!.auth.signOut().then(({ error }) => {
            if (error) setError(error.message);
          })
        }
      />
      <div className="main-shell">
        <main
          className={practiceProblemId ? "content practice-content" : "content"}
          id="main-content"
          tabIndex={-1}
        >
          {!configured && (
            <div className="setup-banner">
              <div>
                <span className="setup-icon">
                  <ShieldCheck size={18} />
                </span>
                <div>
                  <strong>Your workspace is ready to connect.</strong>
                  <span>
                    Setup preview · No sample history. Saving is disabled until
                    Supabase is connected.
                  </span>
                </div>
              </div>
              <Link href="/settings">
                Finish setup <ArrowRight size={15} />
              </Link>
            </div>
          )}
          {error && (
            <div role="alert" className="alert error">
              {error}
              <button
                className="icon-button"
                onClick={() => setError("")}
                aria-label="Dismiss error"
              >
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className="alert success">
              {notice}
              <button
                className="icon-button"
                onClick={() => setNotice("")}
                aria-label="Dismiss notification"
              >
                <X size={16} />
              </button>
            </div>
          )}
          {loading && (
            <div role="status" className="loading-inline">
              <Loader2 size={14} className="spin" /> Syncing your workspace…
            </div>
          )}
          {path === "/" && (
            <Overview
              userId={userId}
              data={data}
              today={today}
              enabled={enabled}
              busy={busy}
              onToggle={(t) =>
                void run(
                  () =>
                    save(
                      "daily_study_tasks",
                      {
                        status:
                          t.status === "completed" ? "planned" : "completed",
                        completed_at:
                          t.status === "completed"
                            ? null
                            : new Date().toISOString(),
                      },
                      t.id,
                    ),
                  "Study task updated.",
                )
              }
            />
          )}{" "}
          {path === "/coding" && (
            <>
              <SectionTitle
                title="Coding practice"
                description="Record solutions, attempts, and what you learned."
                action={addProblem}
              />
              <div className="mini-summary">
                <span>
                  <strong>{data.problems.length}</strong> problems in your
                  library
                </span>
                <span>
                  <strong>{independent}</strong> independently solved
                </span>
                <span>
                  <strong>
                    {data.attempts.reduce(
                      (n, a) => n + (a.duration_minutes ?? 0),
                      0,
                    )}
                  </strong>{" "}
                  recorded minutes
                </span>
              </div>
              <div className="filters">
                <input
                  aria-label="Search problems"
                  placeholder="Search problems…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <select
                  aria-label="Filter by pattern"
                  value={pattern}
                  onChange={(e) => setPattern(e.target.value)}
                >
                  <option>All patterns</option>
                  {patterns.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
                <select
                  aria-label="Filter by difficulty"
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value)}
                >
                  <option>All difficulties</option>
                  {["Easy", "Medium", "Hard"].map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
                <select
                  aria-label="Filter by status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  {[
                    "All statuses",
                    "Not attempted",
                    "Independently solved",
                    "Needs review",
                  ].map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </div>
              <section className="panel problem-list">
                {data.problems.length === 0 ? (
                  <Empty
                    icon={Code2}
                    title="No coding problems yet"
                    action={addProblem}
                  >
                    Add a problem to record attempts and keep your solutions
                    together.
                  </Empty>
                ) : (
                  <>
                    <div className="table-header">
                      <span>Problem</span>
                      <span>Difficulty</span>
                      <span>Attempts</span>
                      <span>Status</span>
                    </div>
                    {data.problems
                      .filter((p) => {
                        const attempts = data.attempts.filter(
                          (a) => a.problem_id === p.id,
                        );
                        const solved = attempts.some(
                          (a) =>
                            a.assistance === "independent" &&
                            a.correctness === "passed",
                        );
                        return (
                          p.title.toLowerCase().includes(query.toLowerCase()) &&
                          (pattern === "All patterns" ||
                            pattern === p.pattern) &&
                          (difficulty === "All difficulties" ||
                            difficulty === p.difficulty) &&
                          (status === "All statuses" ||
                            (status === "Not attempted" && !attempts.length) ||
                            (status === "Independently solved" && solved) ||
                            (status === "Needs review" &&
                              attempts.length > 0 &&
                              !solved))
                        );
                      })
                      .map((p) => {
                        const a = data.attempts.filter(
                          (a) => a.problem_id === p.id,
                        );
                        return (
                          <button
                            className="problem-row"
                            key={p.id}
                            onClick={() =>
                              router.push(`/coding/${p.id}/practice`)
                            }
                          >
                            <span>
                              <strong>{p.title}</strong>
                              <small>{p.pattern}</small>
                            </span>
                            <span>
                              <Badge
                                tone={
                                  p.difficulty === "Easy"
                                    ? "rose"
                                    : p.difficulty === "Hard"
                                      ? "red"
                                      : "amber"
                                }
                              >
                                {p.difficulty}
                              </Badge>
                            </span>
                            <span>{a.length}</span>
                            <span>
                              {a.some(
                                (v) =>
                                  v.assistance === "independent" &&
                                  v.correctness === "passed",
                              ) ? (
                                <Badge tone="rose">Independent</Badge>
                              ) : a.length ? (
                                <Badge tone="amber">Review</Badge>
                              ) : (
                                <Badge>Not attempted</Badge>
                              )}
                            </span>
                          </button>
                        );
                      })}
                  </>
                )}
              </section>
            </>
          )}
          {practiceProblemId &&
            (activeProblem ? (
              <CodingPractice
                userId={session!.user.id}
                key={`${session?.user.id}:${activeProblem.id}`}
                problem={activeProblem}
                attempts={data.attempts.filter(
                  (a) => a.problem_id === activeProblem.id,
                )}
                today={today}
                onSaved={refresh}
                onEditProblem={() =>
                  setEditor({ kind: "problem", value: activeProblem })
                }
                onDeleteProblem={() =>
                  setDeleteTarget({
                    table: "coding_problems",
                    id: activeProblem.id,
                    label: `"${activeProblem.title}" and all its attempts and linked tasks`,
                  })
                }
              />
            ) : (
              !loading && (
                <Empty title="Problem unavailable">
                  This problem was not found in your account.{" "}
                  <Link href="/coding">Return to coding practice</Link>
                </Empty>
              )
            ))}
          {path === "/stories" && (
            <>
              <SectionTitle
                title="Your story bank"
                description="Turn real experiences into clear, specific STAR stories."
                action={
                  <button
                    className="primary"
                    disabled={!enabled || busy}
                    onClick={() => setEditor({ kind: "story" })}
                  >
                    <Plus size={16} /> Add story
                  </button>
                }
              />
              <div className="filters">
                <input
                  aria-label="Search stories"
                  placeholder="Search your stories…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <select
                  aria-label="Filter Leadership Principle"
                  value={principle}
                  onChange={(e) => setPrinciple(e.target.value)}
                >
                  <option>All principles</option>
                  {principles.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </div>
              {!data.stories.length ? (
                <section className="panel">
                  <Empty icon={BookOpen} title="No stories yet">
                    Add an experience using Situation, Task, Action, and Result,
                    then link it to Leadership Principles.
                  </Empty>
                </section>
              ) : (
                <div className="story-grid">
                  {data.stories
                    .filter(
                      (s) =>
                        s.title.toLowerCase().includes(query.toLowerCase()) &&
                        (principle === "All principles" ||
                          s.principles.includes(
                            principle as (typeof principles)[number],
                          )),
                    )
                    .map((s) => (
                      <article
                        key={s.id}
                        id={`story-${s.id}`}
                        className="panel story-card"
                      >
                        <div className="story-top">
                          <BookOpen size={20} />
                          <Badge tone={s.status === "ready" ? "rose" : "amber"}>
                            {s.status}
                          </Badge>
                        </div>
                        <h2>{s.title}</h2>
                        <div className="tags">
                          {s.principles.map((p) => (
                            <Badge key={p}>{p}</Badge>
                          ))}
                        </div>
                        <p>{s.situation || "Situation not written yet."}</p>
                        <details>
                          <summary>Read STAR story</summary>
                          {(
                            [
                              "situation",
                              "task",
                              "action",
                              "result",
                              "evidence",
                              "follow_up_questions",
                            ] as const
                          ).map((k) => (
                            <div className="star-section" key={k}>
                              <span className="story-section-label">
                                {k.replaceAll("_", " ")}
                              </span>
                              <p>{s[k] || "Not recorded"}</p>
                            </div>
                          ))}
                        </details>
                        <div className="story-bottom">
                          <span>
                            {s.confidence === null
                              ? "Confidence unassessed"
                              : `Confidence ${s.confidence}/5`}
                          </span>
                          <button
                            className="text-link"
                            onClick={() =>
                              setEditor({ kind: "story", value: s })
                            }
                          >
                            Edit story <ArrowRight size={14} />
                          </button>
                          <button
                            className="icon-button danger"
                            aria-label={`Delete ${s.title}`}
                            onClick={() =>
                              setDeleteTarget({
                                table: "behavioral_stories",
                                id: s.id,
                                label: `“${s.title}”`,
                              })
                            }
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </article>
                    ))}
                </div>
              )}
            </>
          )}
          <AdaptivePlannerHost
            userId={userId}
            ready={!loading}
            visible={path === "/plan"}
            data={data}
            enabled={enabled}
            onLogSession={() => setEditor({ kind: "session" })}
            onSettingsSaved={refresh}
            onLegacyToggle={(t) =>
              void run(
                () =>
                  save(
                    "daily_study_tasks",
                    {
                      status:
                        t.status === "completed" ? "planned" : "completed",
                      completed_at:
                        t.status === "completed"
                          ? null
                          : new Date().toISOString(),
                    },
                    t.id,
                  ),
                "Study task updated.",
              )
            }
          />
          {path === "/analytics" && (
            <>
              <SectionTitle
                title="Preparation readiness"
                description="A transparent view of your evidence. Never a prediction of an offer."
                action={
                  <button
                    className="secondary"
                    disabled={!enabled || !score || busy}
                    onClick={() =>
                      void run(
                        () =>
                          save("readiness_snapshots", {
                            score: score!.score,
                            evidence: {
                              ...score,
                              attempts: data.attempts.length,
                              formula:
                                "70% independent problem ratio + 30% ready story ratio",
                            },
                            formula_version: 1,
                          }),
                        "Current evidence snapshot saved.",
                      )
                    }
                  >
                    <ArrowDownToLine size={16} /> Save snapshot
                  </button>
                }
              />
              <div className="two-columns">
                <section className="panel readiness-panel">
                  <Target size={30} />
                  <strong className="big-score">
                    {score ? `${score.score}%` : "—"}
                  </strong>
                  <h2>
                    {score
                      ? "Your current preparation signal"
                      : "Not enough data"}
                  </h2>
                  <p>
                    Requires 5 distinct attempted problems across 3 patterns and
                    2 behavioral stories. This is a planning heuristic, not a
                    validated interview assessment.
                  </p>
                  <div className="evidence-checks">
                    <span>
                      {new Set(data.attempts.map((a) => a.problem_id)).size}/5
                      distinct problems
                    </span>
                    <span>
                      {new Set(data.attempts.map((a) => a.pattern)).size}/3
                      patterns
                    </span>
                    <span>{data.stories.length}/2 stories</span>
                  </div>
                </section>
                <section className="panel">
                  <div className="panel-header">
                    <h2>Pattern performance</h2>
                    <Code2 size={19} />
                  </div>
                  <PatternChart attempts={data.attempts} />
                </section>
              </div>
              <section className="panel methodology">
                <h2>What goes into the index?</h2>
                <p>
                  <strong>70% coding:</strong> distinct independently passed
                  problems divided by distinct attempted problems. Hinted,
                  guided, and solution-viewed attempts do not count as
                  independent solves.
                </p>
                <p>
                  <strong>30% behavioral:</strong> stories marked ready divided
                  by total stories. Readiness is self-assessed; all four STAR
                  sections must be filled in before a story can be marked ready.
                </p>
                <p>
                  Correctness is self-reported. Browser sample execution is
                  separate evidence and does not prove full correctness.
                  Confidence and assistance affect planning priority; no
                  historical scores are generated. Snapshots are saved only when
                  you explicitly request them.
                </p>
              </section>
            </>
          )}
          {path === "/settings" && (
            <Settings
              data={data}
              enabled={enabled}
              busy={busy}
              onSave={async (f) => {
                await run(async () => {
                  if (!supabase) return;
                  const timezone = get(f, "timezone");
                  try {
                    localDate(new Date(), timezone);
                  } catch {
                    throw new Error(
                      "Enter a valid IANA timezone, such as Europe/Istanbul.",
                    );
                  }
                  const { error } = await supabase.from("profiles").upsert({
                    id: session!.user.id,
                    display_name: get(f, "display_name"),
                    interview_date: get(f, "interview_date") || null,
                    timezone,
                  });
                  if (error) throw error;
                }, "Workspace preferences saved.");
              }}
              onImport={async (raw) => {
                return run(async () => {
                  const payload = importSchema.parse(JSON.parse(raw));
                  await importHistory(payload, false);
                }, "History imported atomically. Existing records were kept and exact repeats skipped.");
              }}
            />
          )}
          {![
            "/",
            "/coding",
            "/stories",
            "/plan",
            "/analytics",
            "/settings",
          ].includes(path) &&
            !practiceProblemId && (
              <Empty title="This page isn’t in your workspace.">
                <Link href="/">Return to overview</Link>
              </Empty>
            )}
        </main>
      </div>
      {editor && (
        <Dialog
          title={
            editor.kind === "problem"
              ? editor.value
                ? "Edit problem"
                : "Add a problem"
              : editor.kind === "story"
                ? editor.value
                  ? "Edit story"
                  : "Add a STAR story"
                : "Log a study session"
          }
          onClose={() => {
            if (!busy) setEditor(null);
          }}
        >
          <form onSubmit={(e) => void submitEditor(e)} className="editor-form">
            {editor.kind === "story" && (
              <LiveStudyEditorStatus userId={userId} />
            )}
            {error && (
              <div className="alert error" role="alert">
                {error}
              </div>
            )}
            <EditorFields
              editor={editor}
              today={today}
              problems={data.problems}
              onProblemLookupPendingChange={setProblemLookupPending}
            />
            <div className="form-footer">
              <span>
                <ShieldCheck size={13} /> Saved privately to Supabase
              </span>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setEditor(null)}
              >
                Cancel
              </button>
              <button
                className="primary"
                disabled={
                  busy || (editor.kind === "problem" && problemLookupPending)
                }
              >
                {busy ? (
                  <Loader2 size={16} className="spin" />
                ) : (
                  <Check size={16} />
                )}{" "}
                Save {editor.kind === "session" ? "session" : editor.kind}
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {deleteTarget && (
        <Dialog
          title="Delete this record?"
          onClose={() => {
            if (!busy) setDeleteTarget(null);
          }}
        >
          <p className="delete-message">
            This permanently deletes {deleteTarget.label}. This cannot be
            undone.
          </p>
          <div className="form-footer">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setDeleteTarget(null)}
            >
              Keep record
            </button>
            <button
              className="primary destructive"
              disabled={busy}
              onClick={() =>
                void run(
                  () => remove(deleteTarget.table, deleteTarget.id),
                  "Record deleted.",
                ).then((ok) => {
                  if (ok) {
                    setDeleteTarget(null);
                    if (practiceProblemId) router.push("/coding");
                  }
                })
              }
            >
              Delete permanently
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
