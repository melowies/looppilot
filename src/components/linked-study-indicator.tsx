"use client";
import { useSyncExternalStore } from "react";
import {
  subscribeStudy,
  studySnapshot,
  serverStudySnapshot,
} from "@/lib/live-study";
import type { StudySessionLink } from "@/lib/live-study";

// Subscribe here, not in the controlled editor, to keep heartbeat renders local.
export function LinkedStudyIndicator({
  owner,
  link,
}: {
  owner: string;
  link: StudySessionLink;
}) {
  const snapshot = useSyncExternalStore(
    subscribeStudy,
    studySnapshot,
    serverStudySnapshot,
  );
  const item =
    snapshot?.owner === owner
      ? snapshot.state.days
          .find((d) => d.day === link.day)
          ?.items.find(
            (i) => i.key === link.key && i.live?.started_at === link.startedAt,
          )
      : undefined;
  return (
    <button
      className="secondary"
      aria-label="Open linked study session"
      onClick={() =>
        window.dispatchEvent(new Event("looppilot-open-companion"))
      }
    >
      Study session · {item?.live?.state ?? item?.status ?? "saved"} ↗
    </button>
  );
}
