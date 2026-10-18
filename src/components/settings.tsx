"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowDownToLine, ShieldCheck } from "lucide-react";
import { type Data, importSchema } from "@/lib/domain";
import { configured } from "@/lib/supabase";
import { message } from "@/lib/form";
import {
  downloadExport,
  exportWorkspace,
  importHistory,
  prepareHistoryImport,
  type ImportReport,
} from "@/lib/history-import";
import { Badge, Field, SectionTitle } from "./ui";
import { AISettings } from "./ai-settings";
export function Settings({
  data,
  enabled,
  busy,
  onSave,
  onImport,
}: {
  data: Data;
  enabled: boolean;
  busy: boolean;
  onSave: (f: FormData) => Promise<void>;
  onImport: (raw: string) => Promise<boolean>;
}) {
  const [raw, setRaw] = useState(""),
    [parseError, setParseError] = useState(""),
    [preview, setPreview] = useState<ReturnType<
      typeof importSchema.parse
    > | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [exported, setExported] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const working = busy || checking;
  return (
    <>
      <SectionTitle
        title="Settings & data"
        description="Manage your interview date, preferences, and study history."
      />
      <div className="two-columns">
        <section className="panel settings-panel">
          <h2>Interview preferences</h2>
          <form
            key={JSON.stringify(data.profile)}
            onSubmit={(e) => {
              e.preventDefault();
              void onSave(new FormData(e.currentTarget));
            }}
          >
            <Field label="Your name">
              <input
                name="display_name"
                maxLength={200}
                defaultValue={data.profile.display_name}
                placeholder="Your name"
              />
            </Field>
            <input
              type="hidden"
              name="interview_date"
              value={data.profile.interview_date ?? ""}
            />
            <input
              type="hidden"
              name="timezone"
              value={data.profile.timezone}
            />
            <p className="muted">
              Study timezone: {data.profile.timezone}. Manage exact interview
              rounds, weekly study windows, days off, and coaching consent in
              your study plan.
            </p>
            <Link className="text-link" href="/plan">
              Manage availability & interviews
            </Link>
            <button className="primary" disabled={!enabled || busy}>
              Save preferences
            </button>
          </form>
        </section>
        <section className="panel settings-panel">
          <h2>Connect Supabase</h2>
          <Badge tone={configured ? "rose" : "amber"}>
            {configured ? "Connection configured" : "Setup required"}
          </Badge>
          <ol className="setup-steps">
            <li>Create a Supabase project in your own account.</li>
            <li>
              Run the SQL files in <code>supabase/migrations/</code> in filename
              order using the SQL editor. Apply only new files to an existing
              database.
            </li>
            <li>
              Copy <code>.env.example</code> to <code>.env.local</code>. Add the
              project URL and public anon/publishable key.
            </li>
            <li>
              Enable Email authentication, set your local Site URL to{" "}
              <code>http://localhost:3000</code>, and restart the development
              server.
            </li>
          </ol>
          <div className="panel-note">
            <ShieldCheck size={17} />
            <span>
              All personal tables enforce Row Level Security. Never add a
              service-role or secret key to the browser environment.
            </span>
          </div>
        </section>
      </div>
      <AISettings enabled={enabled} />
      <section className="panel settings-panel import-panel">
        <div className="panel-header">
          <div>
            <h2>Import preparation notes</h2>
          </div>
          <ArrowDownToLine size={20} />
        </div>
        <p>
          Use the version 1 JSON format documented in{" "}
          <code>docs/import-format.md</code>. Import only supplied source
          material. Missing durations should be null; never guess dates or
          results. Unknown confidence and hint counts stay unknown. Existing
          problems are linked by identity; exact repeated attempts and stories
          are skipped. Existing records are never overwritten.
        </p>
        <div className="button-group">
          <button
            className="secondary"
            disabled={!enabled || working}
            onClick={() => {
              setChecking(true);
              void exportWorkspace()
                .then((value) => {
                  downloadExport(value);
                  setExported(true);
                  setParseError("");
                })
                .catch((e) => setParseError(message(e)))
                .finally(() => setChecking(false));
            }}
          >
            Export current workspace
          </button>
          <span>
            {exported
              ? "Account export downloaded. Keep it private."
              : "Download a copy of your current records before importing."}
          </span>
        </div>
        <Field label="Load a JSON source file">
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            disabled={working}
            onChange={(e) => {
              setPreview(null);
              setReport(null);
              setParseError("");
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > 5000000) {
                setParseError("Use a JSON file smaller than 5 MB.");
                return;
              }
              void file
                .text()
                .then(setRaw)
                .catch((e) => setParseError(message(e)));
            }}
          />
        </Field>
        <Field label="Import JSON">
          <textarea
            rows={7}
            value={raw}
            onChange={(e) => {
              setRaw(e.target.value);
              setPreview(null);
              setReport(null);
            }}
            disabled={working}
            placeholder={
              '{"version":1,"problems":[],"attempts":[],"stories":[]}'
            }
          />
        </Field>
        {parseError && (
          <p role="alert" className="danger">
            {parseError}
          </p>
        )}
        <div className="button-group">
          <button
            className="secondary"
            disabled={!raw || working}
            onClick={() => {
              setChecking(true);
              setPreview(null);
              setReport(null);
              void (async () => {
                try {
                  const parsed = await prepareHistoryImport(raw);
                  if (enabled) setReport(await importHistory(parsed, true));
                  setPreview(parsed);
                  setParseError("");
                } catch (e) {
                  setParseError(message(e));
                  setPreview(null);
                } finally {
                  setChecking(false);
                }
              })();
            }}
          >
            {checking ? "Checking…" : "Validate & preview"}
          </button>
          {preview && (
            <>
              <span>
                {preview.problems.length} problems · {preview.attempts.length}{" "}
                attempts · {preview.stories.length} stories
              </span>
              <button
                className="primary"
                disabled={
                  !enabled || working || !exported || !!report?.conflicts.length
                }
                onClick={() => {
                  void onImport(JSON.stringify(preview)).then((ok) => {
                    if (ok) {
                      setPreview(null);
                      setReport(null);
                      setRaw("");
                      if (fileRef.current) fileRef.current.value = "";
                    }
                  });
                }}
              >
                Import validated records
              </button>
            </>
          )}
        </div>
        {preview && !enabled && (
          <p>
            File validation passed. Sign in to check duplicates against your
            account before importing.
          </p>
        )}
        {preview && report && (
          <div className="import-preview" aria-live="polite">
            <h3>Import preview</h3>
            <p>
              {report.problems.inserted} new problems · {report.problems.linked}{" "}
              existing problems linked
            </p>
            <p>
              {report.attempts.inserted} new attempts ·{" "}
              {report.attempts.skipped} repeated attempts skipped
            </p>
            <p>
              {report.stories.inserted} new stories · {report.stories.skipped}{" "}
              repeated stories skipped
            </p>
            <p>
              {
                preview.attempts.filter((a) => a.data.confidence === null)
                  .length
              }{" "}
              attempts and{" "}
              {preview.stories.filter((s) => s.confidence === null).length}{" "}
              stories have unassessed confidence.{" "}
              {preview.attempts.filter((a) => a.data.hints === null).length}{" "}
              attempts have unknown hint counts.
            </p>
            {!exported && (
              <p>Export your current workspace to enable import.</p>
            )}
            {report.warnings.map((warning, i) => (
              <p key={`warning-${i}`}>{warning}</p>
            ))}
            {report.conflicts.map((conflict, i) => (
              <p className="danger" role="alert" key={`conflict-${i}`}>
                {conflict}
              </p>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
