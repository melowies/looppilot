"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import {
  attemptSchema,
  patterns,
  type Attempt,
  type Problem,
} from "@/lib/domain";
import {
  newAttempt,
  readTestEvidence,
  serializeEvidence,
  type PythonTestCase,
  type PythonExecutionResult,
} from "@/lib/coding-workspace";
import { save } from "@/lib/repository";
import {
  liveAttemptLink,
  signalStudyChange,
  subscribeStudy,
  type StudySessionLink,
} from "@/lib/live-study";
import { LinkedStudyIndicator } from "./linked-study-indicator";
import { message } from "@/lib/form";
import { Badge, Field } from "./ui";
import { pythonProblem } from "@/lib/python-problems";
import { executePython } from "@/lib/python-runner";
import {
  durationMinutes,
  formatDuration,
  type Timing,
} from "@/lib/practice-timer";
import { usePracticeTimer } from "./use-practice-timer";

const PythonEditor = dynamic(() => import("./python-editor"), { ssr: false });
type Draft = Omit<Attempt, "id">;
type View = "Problem" | "Code" | "Tests" | "Reflection";

function useUnsavedWarning(dirty: boolean) {
  const dirtyRef = useRef(dirty);
  const clearGuardRef = useRef<() => Promise<void>>(() => Promise.resolve());
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const click = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('button[aria-label="Sign out"]') && dirtyRef.current) {
        if (
          !window.confirm("You have unsaved changes. Sign out without saving?")
        ) {
          event.preventDefault();
          event.stopPropagation();
        } else {
          event.preventDefault();
          event.stopPropagation();
          const button = target.closest<HTMLButtonElement>(
            'button[aria-label="Sign out"]',
          );
          void clearGuardRef.current().then(() => button?.click());
        }
        return;
      }
      const link = target.closest("a[href]");
      if (!link || !dirtyRef.current) return;
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
        return;
      const href = link.getAttribute("href");
      if (
        !href ||
        href.startsWith("#") ||
        link.getAttribute("target") === "_blank"
      )
        return;
      if (!window.confirm("You have unsaved changes. Leave without saving?")) {
        event.preventDefault();
        event.stopPropagation();
      } else {
        event.preventDefault();
        event.stopPropagation();
        void clearGuardRef.current().then(() => (link as HTMLElement).click());
      }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", click, true);
    };
  }, []);
  useEffect(() => {
    if (!dirty) return;
    // A same-URL history entry lets Back ask before the router leaves this page.
    history.pushState({ ...history.state, loopPilotGuard: true }, "");
    let atGuard = true;
    let removing = false;
    let removal: Promise<void> | undefined;
    let resolveRemoval: (() => void) | undefined;
    const pop = () => {
      if (removing) {
        atGuard = false;
        removing = false;
        resolveRemoval?.();
        return;
      }
      if (history.state?.loopPilotGuard) {
        atGuard = true;
        return;
      }
      atGuard = false;
      if (
        !dirtyRef.current ||
        window.confirm("You have unsaved changes. Leave without saving?")
      ) {
        dirtyRef.current = false;
        history.back();
      } else history.forward();
    };
    clearGuardRef.current = () => {
      if (removal) return removal;
      dirtyRef.current = false;
      if (!atGuard || !history.state?.loopPilotGuard) return Promise.resolve();
      removing = true;
      removal = new Promise<void>((resolve) => {
        resolveRemoval = resolve;
      });
      history.back();
      return removal;
    };
    window.addEventListener("popstate", pop);
    return () => {
      clearGuardRef.current = () => Promise.resolve();
      window.removeEventListener("popstate", pop);
      resolveRemoval?.();
      if (atGuard && history.state?.loopPilotGuard) history.back();
    };
  }, [dirty]);
  return useCallback(() => clearGuardRef.current(), []);
}

function Tabs({
  labels,
  active,
  onChange,
  label,
}: {
  labels: string[];
  active: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="practice-tabs"
      onKeyDown={(event) => {
        const index = labels.indexOf(active);
        const next =
          event.key === "ArrowRight"
            ? (index + 1) % labels.length
            : event.key === "ArrowLeft"
              ? (index + labels.length - 1) % labels.length
              : event.key === "Home"
                ? 0
                : event.key === "End"
                  ? labels.length - 1
                  : -1;
        if (next < 0) return;
        event.preventDefault();
        onChange(labels[next]);
        (event.currentTarget.children[next] as HTMLElement).focus();
      }}
    >
      {labels.map((name) => (
        <button
          key={name}
          type="button"
          role="tab"
          aria-selected={active === name}
          tabIndex={active === name ? 0 : -1}
          onClick={() => onChange(name)}
        >
          {name}
        </button>
      ))}
    </div>
  );
}

export function TestPanel({
  cases,
  onChange,
  evidence,
  onEvidenceChange,
  result = null,
  runState = "",
  inputHelp = "Custom input and expected output are saved with this attempt. Execution requires a supported problem adapter.",
}: {
  cases: PythonTestCase[];
  onChange: (cases: PythonTestCase[]) => void;
  evidence: string;
  onEvidenceChange: (value: string) => void;
  result?: PythonExecutionResult | null;
  runState?: string;
  inputHelp?: string;
}) {
  const [tab, setTab] = useState("Test Cases");
  useEffect(() => {
    if (runState === "Loading Python runtime…") {
      // A run brings its live results into view, including on mobile.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTab("Test Results");
    }
  }, [runState]);
  return (
    <section className="practice-tests" aria-label="Testing panel">
      <Tabs
        labels={["Test Cases", "Test Results", "Console"]}
        active={tab}
        onChange={setTab}
        label="Test panel views"
      />
      <div className="practice-panel-scroll" role="tabpanel" aria-label={tab}>
        {tab === "Test Cases" && (
          <>
            <div className="practice-test-heading">
              <p>{inputHelp}</p>
              <button
                type="button"
                className="secondary"
                disabled={cases.length >= 50}
                onClick={() =>
                  onChange([
                    ...cases,
                    { id: crypto.randomUUID(), input: "", expectedOutput: "" },
                  ])
                }
              >
                Add test case
              </button>
            </div>
            {!cases.length && (
              <p>
                No saved test cases. On supported problems, Run Code uses the
                curated samples without changing this attempt. Add your own edge
                cases here.
              </p>
            )}
            {cases.map((c, index) => (
              <div className="practice-case" key={c.id}>
                <div className="practice-case-title">
                  <strong>
                    Case {index + 1} ·{" "}
                    {c.origin === "curated" ? "curated sample" : "custom"}
                  </strong>
                  <button
                    className="text-link danger"
                    type="button"
                    onClick={() => onChange(cases.filter((v) => v.id !== c.id))}
                  >
                    Remove case {index + 1}
                  </button>
                </div>
                <div className="form-grid">
                  <Field label={`Input ${index + 1}`}>
                    <textarea
                      rows={2}
                      maxLength={10000}
                      value={c.input}
                      onChange={(e) =>
                        onChange(
                          cases.map((v) =>
                            v.id === c.id
                              ? {
                                  ...v,
                                  input: e.target.value,
                                  origin: undefined,
                                }
                              : v,
                          ),
                        )
                      }
                    />
                  </Field>
                  <Field label={`Expected output ${index + 1}`}>
                    <textarea
                      rows={2}
                      maxLength={10000}
                      value={c.expectedOutput}
                      onChange={(e) =>
                        onChange(
                          cases.map((v) =>
                            v.id === c.id
                              ? {
                                  ...v,
                                  expectedOutput: e.target.value,
                                  origin: undefined,
                                }
                              : v,
                          ),
                        )
                      }
                    />
                  </Field>
                </div>
              </div>
            ))}
          </>
        )}
        {tab === "Test Results" && (
          <>
            <p>
              {result
                ? "Sample results only · self-reported outcome unchanged."
                : runState ||
                  "Not run. Run Code on a supported Python problem to view actual outputs."}
            </p>
            {result && !runState.startsWith("Execution complete.") && (
              <p role="status">{runState}</p>
            )}
            {result?.results.map((r) => (
              <div className="practice-case" key={r.caseId}>
                <strong>{r.status}</strong>
                <p>Expected output</p>
                <pre>{r.expectedOutput}</pre>
                <p>Actual output</p>
                <pre>{r.actualOutput || "No output returned"}</pre>
                {r.errorMessage && <p role="alert">Error: {r.errorMessage}</p>}
              </div>
            ))}
            {!result && (
              <dl>
                <dt>Actual output</dt>
                <dd>Unavailable until execution</dd>
                <dt>Error messages</dt>
                <dd>No execution errors to display</dd>
              </dl>
            )}
            <Field label="Test results / correctness evidence (self-reported)">
              <textarea
                rows={3}
                maxLength={45000}
                value={evidence}
                onChange={(e) => onEvidenceChange(e.target.value)}
              />
            </Field>
          </>
        )}
        {tab === "Console" && (
          <>
            <p>
              {result
                ? "Console output"
                : "No console output. Code has not been executed."}
            </p>
            {result && (
              <>
                <pre aria-label="Standard output">
                  {result.stdout || "(empty stdout)"}
                </pre>
                <pre aria-label="Standard error">
                  {result.stderr || "(empty stderr)"}
                </pre>
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}

export function CodingPractice({
  userId,
  problem,
  attempts,
  today,
  onSaved,
  onEditProblem,
  onDeleteProblem,
}: {
  userId: string;
  problem: Problem;
  attempts: Attempt[];
  today: string;
  onSaved: () => Promise<void>;
  onEditProblem: () => void;
  onDeleteProblem: () => void;
}) {
  const supported = pythonProblem(problem);
  const initialCases = supported?.cases ?? [];
  const initial = {
    ...newAttempt(problem, today),
    solution: supported?.starter ?? "",
    test_results: serializeEvidence(initialCases, ""),
  };
  const [draft, setDraft] = useState<Draft>(initial);
  const [attemptId, setAttemptId] = useState<string>();
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const [cases, setCases] = useState<PythonTestCase[]>(initialCases);
  const [evidence, setEvidence] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  // Identity-only subscription: heartbeat updates must not rerender Monaco.
  const activeIdentity = useSyncExternalStore(
    subscribeStudy,
    () => JSON.stringify(liveAttemptLink(userId, problem.id) ?? null),
    () => "null",
  );
  const [boundSession, setBoundSession] = useState<StudySessionLink>();
  const studyLink =
    readTestEvidence(draft.test_results).studySession ?? boundSession;
  const timer = usePracticeTimer(Boolean(studyLink));
  const {
    snapshot: timerSnapshot,
    pause: timerPause,
    reset: timerReset,
  } = timer;
  const [timing, setTiming] = useState<Timing>();
  const [result, setResult] = useState<PythonExecutionResult | null>(null);
  const [runState, setRunState] = useState("");
  const [running, setRunning] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const [recovered, setRecovered] = useState(false);
  const [storageError, setStorageError] = useState("");
  const storageKey = `looppilot:practice:v1:${userId}:${problem.id}`;
  const [view, setView] = useState<View>("Code");
  const [leftTab, setLeftTab] = useState("Problem");
  const [theme, setTheme] = useState<"light" | "vs-dark">("vs-dark");
  const [fontSize, setFontSize] = useState(15);
  const [width, setWidth] = useState(36);
  const [editorHeight, setEditorHeight] = useState(66);
  const gridRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  function showView(next: View) {
    setView(next);
    // Mobile has one workspace scroll region. Explicit tab/run actions bring
    // its panel below the sticky tabs instead of leaving outputs below toolbars.
    requestAnimationFrame(() => {
      if (!window.matchMedia("(max-width: 760px)").matches) return;
      const grid = gridRef.current;
      const content = grid?.closest<HTMLElement>(".practice-content");
      const tabs = content?.querySelector<HTMLElement>(".practice-mobile-tabs");
      if (!grid || !content || !tabs) return;
      content.scrollTop +=
        grid.getBoundingClientRect().top -
        content.getBoundingClientRect().top -
        tabs.getBoundingClientRect().height -
        12;
    });
  }
  useEffect(() => {
    const content = gridRef.current?.closest<HTMLElement>(".practice-content");
    if (!content) return;
    const measure = () =>
      content.style.setProperty(
        "--practice-top",
        `${content.getBoundingClientRect().top}px`,
      );
    const observer = new ResizeObserver(measure);
    observer.observe(document.documentElement);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  const value: Draft = useMemo(
    () => ({
      ...draft,
      test_results: serializeEvidence(cases, evidence, timing, studyLink),
    }),
    [draft, cases, evidence, timing, studyLink],
  );
  useEffect(() => {
    if (!recovered || attemptId || studyLink || activeIdentity === "null")
      return;
    // Capture once on opening/new attempt, never infer a link at save time.
    const link = JSON.parse(activeIdentity) as StudySessionLink;
    /* eslint-disable react-hooks/set-state-in-effect */
    setBoundSession(link);
    // Linking an untouched draft does not itself constitute unsaved user work.
    if (JSON.stringify(value) === saved)
      setSaved(
        JSON.stringify({
          ...value,
          test_results: serializeEvidence(cases, evidence, timing, link),
        }),
      );
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [
    activeIdentity,
    recovered,
    attemptId,
    studyLink,
    value,
    saved,
    cases,
    evidence,
    timing,
  ]);
  const recovery = useRef({ draft: value, attemptId, saved });
  useEffect(() => {
    recovery.current = { draft: value, attemptId, saved };
  }, [value, attemptId, saved]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const stored = JSON.parse(raw);
        const parsed = attemptSchema.parse(stored.draft);
        if (
          parsed.problem_id !== problem.id ||
          typeof stored.saved !== "string" ||
          (stored.attemptId && !attempts.some((a) => a.id === stored.attemptId))
        )
          throw new Error("Stale draft");
        /* eslint-disable react-hooks/set-state-in-effect */
        const tests = readTestEvidence(parsed.test_results);
        // An untouched blank preview from before an adapter was added is safe
        // to initialize. Never replace edited drafts or saved historical code.
        if (
          !stored.attemptId &&
          !parsed.solution &&
          !tests.cases.length &&
          !tests.evidence &&
          !tests.timing &&
          !stored.timing &&
          stored.saved === JSON.stringify(stored.draft) &&
          supported
        ) {
          setRecovered(true);
          return;
        }
        const restoredTiming = readTestEvidence(
          serializeEvidence([], "", stored.timing),
        ).timing;
        // Restore the client-only draft after hydration. Never count time while closed.
        setDraft(parsed);
        setAttemptId(stored.attemptId);
        setCases(tests.cases);
        setEvidence(tests.evidence);
        setTiming(tests.timing);
        setSaved(stored.saved);
        timer.reset(
          restoredTiming ?? tests.timing,
          Boolean(stored.attemptId && !restoredTiming && !tests.timing),
        );
      }
    } catch {
      /* Invalid/stale local recovery never replaces database history. */
    }
    setRecovered(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    // Restore once per account/problem; later database refreshes must not reset editing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
  useEffect(() => {
    if (!recovered) return;
    const persist = () => {
      try {
        localStorage.setItem(
          storageKey,
          JSON.stringify({ ...recovery.current, timing: timerSnapshot() }),
        );
      } catch {
        setStorageError(
          "Local recovery is unavailable in this browser. Save your attempt before leaving.",
        );
      }
    };
    const interval = window.setInterval(persist, 1000);
    const leave = () => {
      timerPause("Paused · workspace closed");
      persist();
    };
    const visibility = () => {
      if (document.hidden) persist();
    };
    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", visibility);
    persist();
    return () => {
      clearInterval(interval);
      window.removeEventListener("pagehide", leave);
      document.removeEventListener("visibilitychange", visibility);
      persist();
      controller.current?.abort();
    };
  }, [recovered, storageKey, timerSnapshot, timerPause]);
  const dirty = JSON.stringify(value) !== saved;
  const clearUnsavedGuard = useUnsavedWarning(dirty);
  function update<K extends keyof Draft>(key: K, v: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: v }));
    setStatus("");
    if (key === "solution") {
      timer.activity();
      if (result)
        setRunState(
          "Results are from the previous code. Run Code again for current outputs.",
        );
    }
  }
  async function runCode() {
    if (!supported || running || controller.current) return;
    timer.activity();
    const abort = new AbortController();
    controller.current = abort;
    setResult(null);
    setError("");
    setRunning(true);
    setRunState("Loading Python runtime…");
    showView("Tests");
    const loadingTimeout = window.setTimeout(() => abort.abort(), 30000);
    try {
      const output = await executePython(
        {
          language: "python",
          source: draft.solution,
          cases: (cases.length ? cases : supported.cases).map((c) => ({
            ...c,
          })),
          method: supported.method,
        },
        abort.signal,
        () => {
          if (controller.current === abort) setRunState("Running samples…");
        },
      );
      if (controller.current !== abort) return;
      setResult(output);
      setRunState(
        "Execution complete. Results describe the code and cases at the time of this run.",
      );
    } catch (e) {
      if (controller.current !== abort) return;
      setError(
        abort.signal.aborted
          ? "Execution stopped. Retry Run Code; your code and cases are preserved."
          : message(e),
      );
      setRunState(
        "Execution unavailable. Your code and test cases are preserved; retry Run Code.",
      );
    } finally {
      clearTimeout(loadingTimeout);
      if (controller.current === abort) {
        setRunning(false);
        controller.current = null;
      }
    }
  }
  const saveAttempt = useCallback(async () => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      timerPause("Paused · saving");
      const measured = timerSnapshot();
      const toSave = {
        ...value,
        duration_minutes: measured
          ? durationMinutes(measured.seconds)
          : value.duration_minutes,
        test_results: serializeEvidence(
          cases,
          evidence,
          measured,
          readTestEvidence(value.test_results).studySession,
        ),
      };
      const parsed = attemptSchema.parse(toSave);
      const id = attemptId ?? crypto.randomUUID();
      await save(
        "coding_attempts",
        attemptId ? parsed : { ...parsed, id },
        attemptId,
      );
      // The same-URL Back used to remove the guard must finish before we
      // advertise a completed save or allow an immediate reload/navigation.
      await clearUnsavedGuard();
      const savedValue = JSON.stringify(toSave);
      // Checkpoint the returned record identity before showing success, so an
      // immediate reload cannot recover it as a new draft and insert twice.
      recovery.current = { draft: toSave, attemptId: id, saved: savedValue };
      try {
        localStorage.setItem(
          storageKey,
          JSON.stringify({ ...recovery.current, timing: measured }),
        );
      } catch {
        setStorageError(
          "Local recovery is unavailable in this browser. Your attempt was saved to your account.",
        );
      }
      setAttemptId(id);
      timerPause("Paused · saved");
      // Freeze the persisted snapshot; later editing resumes this attempt's timer.
      timerReset(measured, !measured);
      setTiming(measured);
      setDraft(toSave);
      setSaved(savedValue);
      setStatus("Attempt saved. Correctness remains self-reported.");
      signalStudyChange();
      await onSaved();
    } catch (e) {
      setError(message(e));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }, [
    value,
    attemptId,
    onSaved,
    cases,
    evidence,
    timerSnapshot,
    timerPause,
    timerReset,
    clearUnsavedGuard,
    storageKey,
  ]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveAttempt();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [saveAttempt]);
  async function reopen(id: string) {
    if (
      busy ||
      (dirty &&
        !window.confirm(
          "You have unsaved changes. Discard them and open another attempt?",
        ))
    )
      return;
    await clearUnsavedGuard();
    const a = attempts.find((a) => a.id === id);
    const next = a
      ? { ...a }
      : {
          ...newAttempt(problem, today),
          solution: supported?.starter ?? "",
          test_results: serializeEvidence(
            initialCases,
            "",
            undefined,
            liveAttemptLink(userId, problem.id),
          ),
        };
    const tests = readTestEvidence(next.test_results);
    const nextValue = {
      ...next,
      test_results: serializeEvidence(
        tests.cases,
        tests.evidence,
        tests.timing,
        tests.studySession,
      ),
    };
    setDraft(next);
    setBoundSession(undefined);
    setCases(tests.cases);
    setEvidence(tests.evidence);
    setAttemptId(a?.id);
    setSaved(JSON.stringify(nextValue));
    timer.reset(tests.timing, Boolean(a && !tests.timing));
    setTiming(tests.timing);
    controller.current?.abort();
    controller.current = null;
    setRunning(false);
    setResult(null);
    setRunState("");
    setStatus("");
    setError("");
  }
  const resize = (axis: "horizontal" | "vertical", position: number) => {
    const box = (
      axis === "horizontal" ? gridRef : rightRef
    ).current?.getBoundingClientRect();
    if (!box) return;
    if (axis === "horizontal")
      setWidth(
        Math.min(55, Math.max(25, ((position - box.left) / box.width) * 100)),
      );
    else
      setEditorHeight(
        Math.min(85, Math.max(35, ((position - box.top) / box.height) * 100)),
      );
  };
  function splitter(axis: "horizontal" | "vertical") {
    const horizontal = axis === "horizontal";
    return (
      <div
        role="separator"
        tabIndex={0}
        aria-label={horizontal ? "Resize problem panel" : "Resize test panel"}
        aria-orientation={horizontal ? "vertical" : "horizontal"}
        aria-valuemin={horizontal ? 25 : 35}
        aria-valuemax={horizontal ? 55 : 85}
        aria-valuenow={Math.round(horizontal ? width : editorHeight)}
        className={`practice-splitter ${horizontal ? "column" : "row"}`}
        onKeyDown={(e) => {
          const delta = ["ArrowLeft", "ArrowUp"].includes(e.key)
            ? -2
            : ["ArrowRight", "ArrowDown"].includes(e.key)
              ? 2
              : 0;
          if (!delta) return;
          e.preventDefault();
          if (horizontal) setWidth(Math.min(55, Math.max(25, width + delta)));
          else
            setEditorHeight(Math.min(85, Math.max(35, editorHeight + delta)));
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            resize(axis, horizontal ? e.clientX : e.clientY);
        }}
        onPointerUp={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
        }}
      />
    );
  }
  return (
    <div className="coding-practice" data-mobile-view={view}>
      <div className="practice-heading">
        <div>
          <Link className="text-link" href="/coding">
            ← Coding practice
          </Link>
          <h1>{problem.title}</h1>
        </div>
        <div className="button-group">
          {studyLink ? (
            <LinkedStudyIndicator owner={userId} link={studyLink} />
          ) : (
            <div className="practice-timer" aria-label="Practice timer">
              <span>Attempt time</span>
              <output aria-label="Active practice duration">
                {timer.known
                  ? formatDuration(timer.seconds)
                  : draft.duration_minutes != null
                    ? `${draft.duration_minutes} min`
                    : attemptId
                      ? "Unknown"
                      : "00:00"}
              </output>
              <span>
                {timer.known
                  ? `${timer.reason}${timer.source === "manual" ? " · manually adjusted" : ""}`
                  : attemptId
                    ? "Exact timing unknown"
                    : "Ready"}
              </span>
              {(!attemptId || timer.known) && (
                <button
                  className="secondary"
                  onClick={() =>
                    timer.running ? timer.pause() : timer.activity()
                  }
                >
                  {timer.running ? "Pause" : "Resume"}
                </button>
              )}
            </div>
          )}
          <span className="practice-save-state" role="status">
            {dirty ? "Unsaved changes" : "No unsaved changes"}
          </span>
          <button
            className="primary"
            disabled={busy}
            onClick={() => void saveAttempt()}
          >
            {busy ? "Saving…" : "Save attempt"}
          </button>
        </div>
      </div>
      <div className="practice-toolbar">
        <Field label="Attempt">
          <select
            value={attemptId ?? ""}
            disabled={busy}
            onChange={(e) => reopen(e.target.value)}
          >
            <option value="">New attempt</option>
            <optgroup label="Previous attempts — opens saved code">
              {attempts.map((a, i) => (
                <option value={a.id} key={a.id}>
                  {a.attempted_on} · {a.correctness} · {a.language} · #
                  {attempts.length - i}
                </option>
              ))}
            </optgroup>
          </select>
        </Field>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => reopen("")}
        >
          New attempt
        </button>
        <p>
          {supported
            ? `${supported.signature} · Runs locally in an isolated worker. JSON input; 5-second sample-suite limit.`
            : "Execution is not supported for this problem yet. Code and custom cases can still be saved."}
        </p>
        <button
          className="secondary"
          disabled={
            !supported ||
            draft.language.toLowerCase() !== "python" ||
            (!cases.length && !supported?.cases.length) ||
            busy ||
            running
          }
          onClick={() => void runCode()}
        >
          {running ? "Running…" : "Run Code"}
        </button>
        {running && (
          <button
            className="secondary"
            onClick={() => controller.current?.abort()}
          >
            Stop execution
          </button>
        )}
      </div>
      {status && (
        <p role="status" className="alert success">
          {status}
        </p>
      )}
      {error && (
        <p role="alert" className="alert error">
          {error}
        </p>
      )}
      {storageError && (
        <p role="alert" className="alert error">
          {storageError}
        </p>
      )}
      <div className="practice-mobile-tabs">
        <Tabs
          labels={["Problem", "Code", "Tests", "Reflection"]}
          active={view}
          onChange={(v) => showView(v as View)}
          label="Workspace views"
        />
      </div>
      <div
        className="practice-grid"
        ref={gridRef}
        style={
          {
            "--problem-width": `${width}%`,
            "--editor-height": `${editorHeight}%`,
          } as CSSProperties
        }
      >
        <section
          className="practice-details"
          aria-label="Problem and reflection"
        >
          <div className="practice-desktop-tabs">
            <Tabs
              labels={["Problem", "Reflection"]}
              active={leftTab}
              onChange={setLeftTab}
              label="Problem panel views"
            />
          </div>
          <div
            className={`practice-description practice-panel-scroll ${leftTab === "Problem" ? "desktop-active" : ""}`}
          >
            <div className="tags">
              <Badge>{problem.difficulty}</Badge>
              <Badge>{problem.pattern}</Badge>
              {problem.topic_tags?.map((tag) => (
                <Badge key={tag}>{tag}</Badge>
              ))}
            </div>
            <h2>Problem details</h2>
            <p>
              {supported?.description ??
                "The library stores problem metadata. Read the original source for the statement and examples."}
            </p>
            {supported && (
              <>
                <h2>Input and output</h2>
                <p>{supported.input}</p>
                <p>{supported.output}</p>
                <h2>Constraints</h2>
                <ul>
                  {supported.constraints.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </>
            )}
            {problem.url || supported?.url ? (
              <a
                className="text-link"
                href={problem.url || supported?.url}
                target="_blank"
                rel="noreferrer"
              >
                Read original problem ↗
              </a>
            ) : (
              <p>No source URL recorded. Use Edit problem to add one.</p>
            )}
            <h2>Examples</h2>
            {(supported?.cases ?? cases).length ? (
              (supported?.cases ?? cases).map((c, i) => (
                <div className="practice-case" key={c.id}>
                  <strong>
                    Case {i + 1} ·{" "}
                    {c.origin === "curated" ? "curated sample" : "custom"}
                  </strong>
                  <p>Input</p>
                  <pre>{c.input || "Not entered"}</pre>
                  <p>Expected output</p>
                  <pre>{c.expectedOutput || "Not entered"}</pre>
                </div>
              ))
            ) : (
              <p>
                Add statement examples or edge cases in Test Cases. No examples
                have been supplied yet.
              </p>
            )}
            <h2>Notes</h2>
            <p className="practice-notes">
              {draft.notes ||
                "Write your approach and observations in Reflection."}
            </p>
            <div className="button-group">
              <button
                className="secondary"
                disabled={busy || dirty}
                onClick={onEditProblem}
              >
                Edit problem
              </button>
              <button
                className="text-link danger"
                disabled={busy || dirty}
                onClick={onDeleteProblem}
              >
                Delete problem
              </button>
            </div>
          </div>
          <div
            className={`practice-reflection practice-panel-scroll ${leftTab === "Reflection" ? "desktop-active" : ""}`}
          >
            <h2>Reflection</h2>
            <p>
              Saving code does not count as a solve. Record assistance and
              outcomes honestly.
            </p>
            <div className="form-grid">
              <Field label="Attempt date">
                <input
                  type="date"
                  value={draft.attempted_on}
                  onChange={(e) => update("attempted_on", e.target.value)}
                />
              </Field>
              <div>
                <p>
                  Attempt duration:{" "}
                  <strong>
                    {timer.known
                      ? formatDuration(timer.seconds)
                      : draft.duration_minutes != null
                        ? `${draft.duration_minutes} minutes recorded · exact timing unknown`
                        : "Unknown"}
                  </strong>
                  {timer.source === "manual" && timer.known
                    ? " · manually adjusted"
                    : ""}
                </p>
                <p>
                  {studyLink
                    ? "Study-session active time is recorded separately in the companion. This attempt’s previous duration is retained; a new linked attempt has no separate measured duration."
                    : "Measured active practice time; total reasoning time may differ. Pauses when hidden or after 5 minutes idle."}
                </p>
                {attemptId && !timer.known && (
                  <p>
                    Historical duration stays unchanged. Start a new attempt to
                    measure fresh practice.
                  </p>
                )}
                <details>
                  <summary>Correct duration manually</summary>
                  <Field label="Manual duration correction (minutes)">
                    <input
                      type="number"
                      min={0}
                      max={1440}
                      step={1}
                      defaultValue=""
                      key={attemptId ?? "new"}
                      onChange={(e) => {
                        if (e.target.value === "" || !e.target.validity.valid)
                          return;
                        const adjusted = {
                          seconds: Number(e.target.value) * 60,
                          source: "manual" as const,
                        };
                        timer.correct(adjusted.seconds);
                        setTiming(adjusted);
                        update("duration_minutes", Number(e.target.value));
                      }}
                    />
                  </Field>
                  <p>Exceptional corrections are saved as manually adjusted.</p>
                </details>
              </div>
              <Field label="Programming language">
                <input
                  maxLength={200}
                  value={draft.language}
                  onChange={(e) => update("language", e.target.value)}
                />
              </Field>
              <Field label="Assistance used">
                <select
                  value={draft.assistance}
                  onChange={(e) =>
                    update("assistance", e.target.value as Draft["assistance"])
                  }
                >
                  {["independent", "hinted", "guided", "solution-viewed"].map(
                    (v) => (
                      <option key={v}>{v}</option>
                    ),
                  )}
                </select>
              </Field>
              <Field label="Number of hints">
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={draft.hints ?? ""}
                  placeholder="Unknown"
                  onChange={(e) =>
                    update(
                      "hints",
                      e.target.value === "" ? null : Number(e.target.value),
                    )
                  }
                />
              </Field>
              <Field label="Result (self-reported)">
                <select
                  value={draft.correctness}
                  onChange={(e) =>
                    update(
                      "correctness",
                      e.target.value as Draft["correctness"],
                    )
                  }
                >
                  {["unverified", "passed", "partial", "failed"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </Field>
              <Field label="Difficulty at attempt">
                <select
                  value={draft.difficulty}
                  onChange={(e) =>
                    update("difficulty", e.target.value as Draft["difficulty"])
                  }
                >
                  {["Easy", "Medium", "Hard"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </Field>
              <Field label="Pattern at attempt">
                <select
                  value={draft.pattern}
                  onChange={(e) =>
                    update("pattern", e.target.value as Draft["pattern"])
                  }
                >
                  {patterns.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </Field>
              <Field label="Time complexity">
                <input
                  maxLength={200}
                  value={draft.time_complexity}
                  onChange={(e) => update("time_complexity", e.target.value)}
                />
              </Field>
              <Field label="Space complexity">
                <input
                  maxLength={200}
                  value={draft.space_complexity}
                  onChange={(e) => update("space_complexity", e.target.value)}
                />
              </Field>
              <Field label="Confidence">
                <select
                  value={draft.confidence ?? ""}
                  onChange={(e) =>
                    update(
                      "confidence",
                      e.target.value === "" ? null : Number(e.target.value),
                    )
                  }
                >
                  <option value="">Unassessed</option>
                  {[1, 2, 3, 4, 5].map((v) => (
                    <option key={v} value={v}>
                      {v} / 5
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Personal notes" wide>
                <textarea
                  rows={6}
                  maxLength={50000}
                  value={draft.notes}
                  onChange={(e) => update("notes", e.target.value)}
                />
              </Field>
            </div>
          </div>
        </section>
        {splitter("horizontal")}
        <div className="practice-right" ref={rightRef}>
          <section className="practice-code" aria-label="Code editor panel">
            <div className="practice-editor-toolbar">
              <strong>
                {draft.language.toLowerCase() === "python"
                  ? "solution.py"
                  : `${draft.language} · plain text`}
              </strong>
              <Field label="Editor theme">
                <select
                  value={theme}
                  onChange={(e) => setTheme(e.target.value as typeof theme)}
                >
                  <option value="vs-dark">Dark</option>
                  <option value="light">Light</option>
                </select>
              </Field>
              <Field label="Font size">
                <select
                  value={fontSize}
                  onChange={(e) => setFontSize(Number(e.target.value))}
                >
                  {[12, 14, 15, 16, 18, 20, 24].map((v) => (
                    <option key={v} value={v}>
                      {v}px
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <PythonEditor
              value={draft.solution}
              language={draft.language}
              onChange={(v) => update("solution", v)}
              onSave={() => void saveAttempt()}
              theme={theme}
              fontSize={fontSize}
              readOnly={busy}
            />
            <p className="practice-editor-help">
              Ctrl/Cmd+S saves · Tab indents · Shift+Tab outdents · Ctrl+M
              toggles Tab focus navigation
            </p>
          </section>
          {splitter("vertical")}
          <TestPanel
            cases={cases}
            onChange={(updated) => {
              setCases(updated);
              if (result)
                setRunState(
                  "Test cases changed. Run Code again for current outputs.",
                );
            }}
            evidence={evidence}
            onEvidenceChange={setEvidence}
            result={result}
            runState={runState}
            inputHelp={
              supported
                ? `${supported.input} ${supported.output} Cases are saved with this attempt.`
                : undefined
            }
          />
        </div>
      </div>
    </div>
  );
}
