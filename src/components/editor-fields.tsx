"use client";
import { type Problem, type Story, principles } from "@/lib/domain";
import { Field } from "./ui";
import { ProblemFields } from "./problem-fields";
export type Editor =
  | { kind: "problem"; value?: Problem }
  | { kind: "story"; value?: Story }
  | { kind: "session" };
export function EditorFields({
  editor,
  today,
  problems = [],
  onProblemLookupPendingChange,
}: {
  editor: Editor;
  today: string;
  problems?: Problem[];
  onProblemLookupPendingChange?: (pending: boolean) => void;
}) {
  if (editor.kind === "problem") {
    return (
      <ProblemFields
        problem={editor.value}
        problems={problems}
        onPendingChange={onProblemLookupPendingChange}
      />
    );
  }
  if (editor.kind === "story") {
    const s = editor.value;
    return (
      <div className="form-grid">
        <Field label="Story title" wide>
          <input
            name="title"
            required
            maxLength={200}
            defaultValue={s?.title}
            placeholder="e.g. Owning a production incident"
          />
        </Field>
        <fieldset className="principle-picker wide">
          <legend>Leadership Principles (choose at least one)</legend>
          {principles.map((p) => (
            <label key={p}>
              <input
                name="principles"
                type="checkbox"
                value={p}
                defaultChecked={s?.principles.includes(p)}
              />
              {p}
            </label>
          ))}
        </fieldset>
        {(
          [
            {
              key: "situation",
              label: "Situation",
              placeholder: "Set the context. What was happening?",
            },
            {
              key: "task",
              label: "Task",
              placeholder: "What were you responsible for?",
            },
            {
              key: "action",
              label: "Action",
              placeholder: "What did you personally do, and why?",
            },
            {
              key: "result",
              label: "Result",
              placeholder: "What changed? What did you learn?",
            },
            {
              key: "evidence",
              label: "Measurable evidence (if available)",
              placeholder: "Use only facts and metrics you can substantiate.",
            },
            {
              key: "follow_up_questions",
              label: "Follow-up questions",
              placeholder: "What might an interviewer probe further?",
            },
          ] as const
        ).map((f) => (
          <Field key={f.key} label={f.label} wide>
            <textarea
              name={f.key}
              rows={3}
              maxLength={50000}
              defaultValue={s?.[f.key]}
              placeholder={f.placeholder}
            />
          </Field>
        ))}
        <Field label="Confidence">
          <select name="confidence" defaultValue={s ? (s.confidence ?? "") : 3}>
            <option value="">Unassessed</option>
            {[1, 2, 3, 4, 5].map((v) => (
              <option key={v} value={v}>
                {v} / 5
              </option>
            ))}
          </select>
        </Field>
        <Field label="Readiness status">
          <select name="status" defaultValue={s?.status ?? "draft"}>
            {["draft", "practicing", "ready"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </Field>
      </div>
    );
  }
  return (
    <div className="form-grid">
      <Field label="Date">
        <input name="studied_on" type="date" required defaultValue={today} />
      </Field>
      <Field label="Duration in minutes">
        <input
          name="duration_minutes"
          type="number"
          min={1}
          max={1440}
          required
        />
      </Field>
      <Field label="Study focus" wide>
        <input
          name="focus"
          required
          maxLength={200}
          placeholder="e.g. Graph traversal review"
        />
      </Field>
      <Field label="Notes" wide>
        <textarea name="notes" rows={4} />
      </Field>
    </div>
  );
}
