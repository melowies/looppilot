export const IDLE_MS = 5 * 60 * 1000;
export type Timing = { seconds: number; source: "measured" | "manual" };

// Milliseconds accumulate between checkpoints; intervals only refresh the display.
export class PracticeClock {
  private elapsedMs: number;
  private startedAt: number | null = null;
  private lastActivity = 0;
  reason = "Ready";
  constructor(
    seconds = 0,
    private now: () => number = () => performance.now(),
  ) {
    this.elapsedMs = seconds * 1000;
  }
  get running() {
    return this.startedAt !== null;
  }
  seconds() {
    this.checkIdle();
    return (
      (this.elapsedMs +
        (this.startedAt === null
          ? 0
          : Math.max(0, this.now() - this.startedAt))) /
      1000
    );
  }
  activity() {
    this.checkIdle();
    this.lastActivity = this.now();
    if (this.startedAt === null) this.startedAt = this.lastActivity;
    this.reason = "Active";
  }
  pause(reason = "Paused") {
    this.checkIdle();
    if (this.startedAt !== null)
      this.elapsedMs += Math.max(0, this.now() - this.startedAt);
    this.startedAt = null;
    this.reason = reason;
  }
  checkIdle() {
    if (this.startedAt !== null && this.now() - this.lastActivity >= IDLE_MS) {
      this.elapsedMs += Math.max(
        0,
        this.lastActivity + IDLE_MS - this.startedAt,
      );
      this.startedAt = null;
      this.reason = "Paused · inactive";
    }
  }
}
export function durationMinutes(seconds: number) {
  return Math.ceil(seconds / 60);
}
export function formatDuration(seconds: number) {
  const total = Math.floor(seconds);
  const s = String(total % 60).padStart(2, "0");
  const m = String(Math.floor(total / 60) % 60).padStart(2, "0");
  return total >= 3600
    ? `${String(Math.floor(total / 3600)).padStart(2, "0")}:${m}:${s}`
    : `${m}:${s}`;
}
