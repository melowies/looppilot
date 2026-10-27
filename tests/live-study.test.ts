import { describe, expect, it } from "vitest";
import {
  defaultPlannerConfig,
  type DayPlan,
  type PlannerState,
} from "../src/lib/adaptive-types";
import {
  generateAdaptiveWeek,
  remainingStudyMinutes,
} from "../src/lib/adaptive-planner";
import { currentStudy, liveSeconds } from "../src/lib/live-study";
import { emptyData } from "../src/lib/domain";
const day = "2026-10-19";
const config = {
  ...defaultPlannerConfig(),
  timezone: "UTC",
  weekly: Array.from({ length: 7 }, () => [{ start: "20:00", end: "22:00" }]),
  dailyMinutes: 120,
};
const evidence = {
  ...emptyData,
  problems: [1, 2, 3, 4].map((n) => ({
    id: `p${n}`,
    title: `Problem ${n}`,
    difficulty: "Medium" as const,
    pattern: "Graphs" as const,
    url: "",
    created_at: "2026-10-01T00:00:00Z",
  })),
};
const initial = () =>
  generateAdaptiveWeek(evidence, config, [], `${day}T20:00:00Z`);
function finish(plan: DayPlan[], end: string, seconds: number) {
  const item = plan[0].items[0];
  Object.assign(item, {
    status: "completed",
    completed_at: end,
    live: {
      state: "finished",
      started_at: item.start,
      heartbeat_at: end,
      elapsed_seconds: seconds,
      owner_token: "tab",
    },
  });
  return item;
}
describe("live study deterministic scheduling", () => {
  it("reports only remaining availability before an interview or hard end", () => {
    expect(remainingStudyMinutes(emptyData, config, `${day}T21:45:00Z`)).toBe(
      15,
    );
    expect(
      remainingStudyMinutes(
        emptyData,
        {
          ...config,
          interviewTimezone: "UTC",
          rounds: [
            {
              id: "round",
              title: "Interview",
              date: day,
              time: "21:00",
              duration: 60,
              format: "coding",
            },
          ],
        },
        `${day}T20:30:00Z`,
      ),
    ).toBe(30);
    expect(
      remainingStudyMinutes(
        {
          ...emptyData,
          profile: { ...emptyData.profile, interview_date: day },
        },
        config,
        `${day}T20:30:00Z`,
      ),
    ).toBe(0);
  });
  it.each([
    ["20:21", 21 * 60],
    ["21:05", 65 * 60],
  ])(
    "replans at the actual %s completion with no overlap or extension",
    (time, seconds) => {
      const old = initial(),
        end = `${day}T${time}:00Z`,
        item = finish(old, end, seconds);
      const next = generateAdaptiveWeek(evidence, config, old, end)[0];
      expect(next.items).toContainEqual(item);
      const work = next.items.filter(
        (i) => i.status === "planned" && i.category !== "break",
      );
      for (const i of work) {
        expect(Date.parse(i.start)).toBeGreaterThanOrEqual(
          Date.parse(end) + config.breakMinutes * 60000,
        );
        expect(Date.parse(i.end)).toBeLessThanOrEqual(
          Date.parse(`${day}T22:00:00Z`),
        );
      }
      expect(next.changes.join()).toContain("than scheduled");
      expect(
        next.items.some(
          (i) => i.category === "break" && i.status === "planned",
        ),
      ).toBe(true);
    },
  );
  it("keeps running tasks past their estimates and reserves the remaining day", () => {
    const old = initial(),
      item = old[0].items[0];
    item.live = {
      state: "running",
      started_at: item.start,
      heartbeat_at: `${day}T21:05:00Z`,
      elapsed_seconds: 3900,
      owner_token: "tab",
    };
    const result = generateAdaptiveWeek(
      evidence,
      config,
      old,
      `${day}T21:05:00Z`,
    );
    expect(result[0].items).toContainEqual(item);
    expect(
      result[0].items.filter(
        (i) => i.status === "planned" && !i.live && !i.pinned,
      ),
    ).toEqual([]);
    expect(
      currentStudy(
        { config, revision: 1, days: result },
        Date.parse(`${day}T21:05:00Z`),
      ).current?.item.key,
    ).toBe(item.key);
  });
  it("keeps paused tasks and pins, and flags changed interview constraints", () => {
    const old = initial(),
      item = old[0].items[0];
    item.live = {
      state: "paused",
      started_at: item.start,
      heartbeat_at: item.start,
      elapsed_seconds: 60,
      owner_token: "tab",
    };
    const pin = old[0].items.find(
      (i) => i.category !== "break" && i.key !== item.key,
    )!;
    pin.pinned = true;
    const result = generateAdaptiveWeek(
      evidence,
      {
        ...config,
        rounds: [
          {
            id: "round",
            title: "Interview",
            date: day,
            time: "20:10",
            duration: 60,
            format: "coding",
          },
        ],
      },
      old,
      `${day}T20:05:00Z`,
    )[0];
    expect(result.items).toContainEqual(item);
    expect(result.items).toContainEqual(pin);
    expect(result.warnings.join()).toContain("Pinned session");
  });
  it("leaves insufficient time free and defers lower priority work", () => {
    const old = initial(),
      end = `${day}T21:55:00Z`;
    finish(old, end, 6900);
    const result = generateAdaptiveWeek(evidence, config, old, end);
    expect(
      result[0].items.filter(
        (i) => i.status === "planned" && i.category !== "break",
      ),
    ).toEqual([]);
    expect(
      result.slice(1).some((p) => p.items.some((i) => i.category === "coding")),
    ).toBe(true);
    expect(result[0].changes.join()).toContain("deferred");
  });
  it("bounds display interpolation, freezes paused time, and does not invent closed-app time", () => {
    const item = initial()[0].items[0];
    item.live = {
      state: "running",
      started_at: item.start,
      heartbeat_at: item.start,
      elapsed_seconds: 40,
      owner_token: "tab",
    };
    expect(liveSeconds(item, Date.parse(item.start) + 3600000)).toBe(40);
    expect(
      liveSeconds(
        item,
        Date.parse(item.start) + 3600000,
        Date.parse(item.start),
      ),
    ).toBe(50);
    item.live.state = "paused";
    expect(liveSeconds(item, Date.parse(item.start) + 3600000)).toBe(40);
  });
  it("selects canonical sessions regardless of legacy recommendations and across dates", () => {
    const days = initial(),
      state: PlannerState = { config, revision: 1, days };
    expect(
      currentStudy(state, Date.parse(`${day}T20:00:00Z`)).current?.item,
    ).toEqual(days[0].items[0]);
    expect(
      currentStudy(state, Date.parse(`${day}T23:00:00Z`)).current?.day,
    ).toBe("2026-10-20");
    expect(emptyData.attempts).toEqual([]);
  });
});
