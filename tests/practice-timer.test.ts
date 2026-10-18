import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PracticeClock,
  IDLE_MS,
  durationMinutes,
  formatDuration,
} from "../src/lib/practice-timer";
import {
  readTestEvidence,
  serializeEvidence,
} from "../src/lib/coding-workspace";

afterEach(() => vi.useRealTimers());
describe("active practice clock", () => {
  function setup() {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    return new PracticeClock(0, () => Date.now());
  }
  it("starts on activity and never counts twice across display reads", () => {
    const clock = setup();
    expect(clock.seconds()).toBe(0);
    clock.activity();
    vi.advanceTimersByTime(1250);
    for (let i = 0; i < 20; i++) expect(clock.seconds()).toBe(1.25);
    clock.activity();
    vi.advanceTimersByTime(750);
    expect(clock.seconds()).toBe(2);
  });
  it("excludes paused and background time; resumes explicitly or on editing", () => {
    const clock = setup();
    clock.activity();
    vi.advanceTimersByTime(2000);
    clock.pause("Paused · tab hidden");
    vi.advanceTimersByTime(600000);
    expect(clock.seconds()).toBe(2);
    expect(clock.running).toBe(false);
    clock.activity();
    vi.advanceTimersByTime(1000);
    expect(clock.seconds()).toBe(3);
    clock.pause();
    vi.advanceTimersByTime(4000);
    expect(clock.seconds()).toBe(3);
  });
  it("caps idle time exactly at five minutes even if the interval was throttled", () => {
    const clock = setup();
    clock.activity();
    vi.advanceTimersByTime(1000);
    clock.activity();
    vi.advanceTimersByTime(IDLE_MS + 60000);
    expect(clock.seconds()).toBe(301);
    expect(clock.reason).toBe("Paused · inactive");
    clock.activity();
    vi.advanceTimersByTime(1000);
    expect(clock.seconds()).toBe(302);
  });
  it("restores exact seconds paused; new attempts have independent clocks", () => {
    const clock = setup();
    clock.activity();
    vi.advanceTimersByTime(61250);
    clock.pause();
    const evidence = serializeEvidence([], "legacy evidence", {
      seconds: clock.seconds(),
      source: "measured",
    });
    const timing = readTestEvidence(evidence).timing!;
    vi.advanceTimersByTime(900000);
    const restored = new PracticeClock(timing.seconds, () => Date.now());
    expect(restored.seconds()).toBe(61.25);
    expect(restored.running).toBe(false);
    expect(new PracticeClock().seconds()).toBe(0);
    expect(durationMinutes(restored.seconds())).toBe(2);
    expect(readTestEvidence("historical evidence").timing).toBeUndefined();
  });
  it("rounds database minutes up and formats hours", () => {
    expect([0, 0.1, 59, 60, 60.01, 3600].map(durationMinutes)).toEqual([
      0, 1, 1, 1, 2, 60,
    ]);
    expect(formatDuration(61)).toBe("01:01");
    expect(formatDuration(3661)).toBe("01:01:01");
  });
});
