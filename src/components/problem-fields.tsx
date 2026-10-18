"use client";
import { useEffect, useRef, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { type Problem, patterns } from "@/lib/domain";
import {
  duplicateProblem,
  fetchLeetcodeMetadata,
  parseLeetcodeNumber,
  suggestPatterns,
} from "@/lib/leetcode";
import { Badge, Field } from "./ui";

export function ProblemFields({
  problem,
  problems,
  onPendingChange,
}: {
  problem?: Problem;
  problems: Problem[];
  onPendingChange?: (pending: boolean) => void;
}) {
  const [number, setNumber] = useState(String(problem?.leetcode_id ?? ""));
  const [title, setTitle] = useState(problem?.title ?? "");
  const [url, setUrl] = useState(problem?.url ?? "");
  const [difficulty, setDifficulty] = useState<string>(
    problem?.difficulty ?? "Medium",
  );
  const [pattern, setPattern] = useState(problem?.pattern ?? "");
  const [tags, setTags] = useState(problem?.topic_tags ?? []);
  const [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [loaded, setLoaded] = useState<number | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const fromLookup = useRef(false);
  const suggestions = suggestPatterns(tags);
  useEffect(() => () => onPendingChange?.(false), [onPendingChange]);
  let parsedNumber: number | null = null;
  try {
    parsedNumber = number ? parseLeetcodeNumber(number) : null;
  } catch {
    /* Native input validation explains invalid input. */
  }
  const duplicate = duplicateProblem(
    problems,
    { leetcode_id: parsedNumber, url },
    problem?.id,
  );

  useEffect(() => {
    if (!requestVersion || !number.trim()) return;
    try {
      parseLeetcodeNumber(number);
    } catch {
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    const timer = setTimeout(() => {
      void fetchLeetcodeMetadata(number, abort.signal)
        .then((metadata) => {
          if (abort.signal.aborted) return;
          setTitle(metadata.title);
          setUrl(`https://leetcode.com/problems/${metadata.slug}/`);
          setDifficulty(metadata.difficulty);
          setTags(metadata.tags);
          const candidates = suggestPatterns(metadata.tags);
          setPattern(candidates.length === 1 ? candidates[0] : "");
          setLoaded(metadata.number);
          fromLookup.current = true;
        })
        .catch((e) => {
          if (!abort.signal.aborted)
            setError(
              e instanceof Error
                ? e.message
                : "Lookup failed. Enter details manually.",
            );
        })
        .finally(() => {
          if (!abort.signal.aborted) {
            setPending(false);
            onPendingChange?.(false);
          }
        });
    }, 450);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [number, requestVersion, onPendingChange]);
  function lookup(next: string) {
    controller.current?.abort();
    setNumber(next);
    setError("");
    setLoaded(null);
    setTags([]);
    if (fromLookup.current) {
      setTitle("");
      setUrl("");
      setPattern("");
      fromLookup.current = false;
    }
    let valid = false;
    try {
      parseLeetcodeNumber(next);
      valid = true;
    } catch {
      /* Manual entry remains available. */
    }
    setPending(valid);
    onPendingChange?.(valid);
    setRequestVersion((v) => v + 1);
  }
  return (
    <>
      <div className="problem-lookup" aria-busy={pending} style={{display:'block'}}>
        <div
          className="problem-lookup-controls"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) auto",
            alignItems: "end",
            columnGap: 12,
            marginBottom: 12,
          }}
        >
          <Field label="LeetCode problem number">
            <input
              name="leetcode_id"
              inputMode="numeric"
              pattern="[0-9]{1,10}"
              maxLength={10}
              value={number}
              onChange={(e) => lookup(e.target.value)}
              placeholder="e.g. 200"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  lookup(number);
                }
              }}
            />
          </Field>
          <button
            type="button"
            className="secondary"
            disabled={!parsedNumber || pending}
            onClick={() => lookup(number)}
          >
            {pending ? (
              <Loader2 size={16} className="spin" />
            ) : (
              <Search size={16} />
            )}{" "}
            {pending ? "Looking up…" : "Look up"}
          </button>
        </div>
        <p className="lookup-help">
          Enter the number shown on LeetCode. Details fill in automatically, and
          you can edit them below.
        </p>
        {pending && (
          <p role="status" className="lookup-help">
            Finding problem {number}…
          </p>
        )}
        {loaded && (
          <p role="status" className="lookup-help">
            LeetCode {loaded} loaded. Review the details before saving.
          </p>
        )}
        {error && (
          <p role="alert" className="lookup-error">
            {error}
          </p>
        )}
        {duplicate && (
          <p role="alert" className="lookup-error">
            Already in your library: {duplicate.title}. Open that problem to
            record another attempt.
          </p>
        )}
      </div>
      <input type="hidden" name="topic_tags" value={JSON.stringify(tags)} />
      <input type="hidden" name="lookup_pending" value={String(pending)} />
      <fieldset className="problem-details" disabled={pending}>
        <legend>
          Problem details <span>or enter manually</span>
        </legend>
        <div className="form-grid">
          <Field label="Problem title" wide>
            <input
              name="title"
              required
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Two Sum"
            />
          </Field>
          <Field label="Problem URL" wide>
            <input
              name="url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://leetcode.com/problems/…"
            />
          </Field>
          <Field label="Difficulty">
            <select
              name="difficulty"
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value)}
            >
              {["Easy", "Medium", "Hard"].map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </Field>
          <Field label="Pattern">
            <select
              name="pattern"
              required
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
            >
              <option value="">Choose a pattern</option>
              {patterns.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </Field>
          {tags.length > 0 && (
            <div className="wide">
              <p className="lookup-help">LeetCode topics</p>
              <div className="tags">
                {tags.map((t) => (
                  <Badge key={t}>{t}</Badge>
                ))}
              </div>
              {suggestions.length !== 1 && (
                <p className="lookup-help">
                  {suggestions.length
                    ? `Possible patterns: ${suggestions.join(", ")}. `
                    : ""}
                  Choose the pattern that fits your approach.
                </p>
              )}
            </div>
          )}
        </div>
      </fieldset>
    </>
  );
}
