"use client";
import type { ComponentProps } from "react";
import { StudyPlan } from "./study-plan";
import { useAdaptivePlanner } from "./use-adaptive-planner";
import { LiveStudyCompanion } from "./live-study-companion";

// Keep background revision/schedule state in a sibling of the IDE. Polling and
// generation must not rerender the controlled Monaco editor while it is typing.
export function AdaptivePlannerHost({
  userId,
  ready,
  visible,
  ...props
}: Omit<ComponentProps<typeof StudyPlan>, "planner"> & {
  userId?: string;
  ready: boolean;
  visible: boolean;
}) {
  const planner = useAdaptivePlanner(props.data, userId, ready);
  return (
    <>
      {visible && <StudyPlan {...props} planner={planner} />}
      {userId && planner.state && (
        <LiveStudyCompanion planner={planner} userId={userId} />
      )}
    </>
  );
}
