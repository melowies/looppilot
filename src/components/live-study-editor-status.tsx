"use client";
import { useState, useSyncExternalStore } from "react";
import {
  currentStudy,
  liveSeconds,
  serverStudySnapshot,
  studySnapshot,
  subscribeStudy,
  signalStudyChange,
} from "@/lib/live-study";
import { liveStudyAction } from "@/lib/planner-repository";
import { message } from "@/lib/form";
import { useStudyClock } from "./use-study-clock";
// Native dialogs occupy the browser's top layer. Keep the canonical task
// visible inside the story editor while the floating panel is behind it.
export function LiveStudyEditorStatus({ userId }: { userId?: string }) {
  const snapshot = useSyncExternalStore(
      subscribeStudy,
      studySnapshot,
      serverStudySnapshot,
    ),
    now = useStudyClock(1000);
  const item = currentStudy(
    snapshot?.owner === userId ? (snapshot?.state ?? null) : null,
    now,
  ).current?.item;
  const [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  async function edit(action: "pause" | "resume" | "finish" | "skip") {
    if (!snapshot || snapshot.owner !== userId) return;
    const target = currentStudy(snapshot.state, now).current;
    if (!target) return;
    setSaving(true);
    setError("");
    try {
      await liveStudyAction(
        snapshot.state.revision,
        target.day,
        target.item.key,
        action,
        sessionStorage.getItem("looppilot-study-tab") ?? "manual",
      );
      signalStudyChange();
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
    }
  }
  return item ? (
    <div
      className="panel-note live-study-editor-status"
      aria-label="Current study session"
    >
      <strong>{item.title}</strong>
      <p>
        {item.live?.state ?? "planned"} ·{" "}
        {Math.floor(liveSeconds(item, now) / 60)} min active / {item.minutes}{" "}
        min planned. Editing a story does not record rehearsal.
      </p>
      <div className="companion-actions">
        {item.live?.state === "running" && (
          <button
            type="button"
            className="text-link"
            disabled={saving}
            onClick={() => void edit("pause")}
          >
            Pause study
          </button>
        )}
        {item.live?.state === "paused" && (
          <button
            type="button"
            className="text-link"
            disabled={saving}
            onClick={() => void edit("resume")}
          >
            Resume study
          </button>
        )}
        <button
          type="button"
          className="text-link"
          disabled={saving}
          onClick={() => void edit("finish")}
        >
          {item.category === "behavioral" ? "Finish rehearsal" : "Finish task"}
        </button>
        <button
          type="button"
          className="text-link"
          disabled={saving}
          onClick={() => void edit("skip")}
        >
          Skip task
        </button>
      </div>
      {error && (
        <p className="danger" role="alert">
          {error}
        </p>
      )}
    </div>
  ) : null;
}
