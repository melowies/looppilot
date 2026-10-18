"use client";

import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  CheckCheck,
  Code2,
} from "lucide-react";
import type { Data } from "@/lib/domain";
import { principles } from "@/lib/domain";
import { readiness } from "@/lib/planner";
import { Badge, Empty, PatternChart, Recent, TaskList } from "./ui";

export function Overview({
  data,
  today,
  enabled,
  busy,
  onToggle,
}: {
  data: Data;
  today: string;
  enabled: boolean;
  busy: boolean;
  onToggle: (task: Data["tasks"][number]) => void;
}) {
  const due = data.tasks.filter((t) => t.due_on <= today);
  const upcoming = data.tasks
    .filter((t) => t.status === "planned" && t.due_on > today)
    .slice(0, 3);
  const solved = new Set(
    data.attempts
      .filter(
        (a) => a.assistance === "independent" && a.correctness === "passed",
      )
      .map((a) => a.problem_id),
  ).size;
  const attempted = new Set(data.attempts.map((a) => a.problem_id)).size;
  const ready = data.stories.filter((s) => s.status === "ready").length;
  const score = readiness(data.attempts, data.stories);
  const days = data.profile.interview_date
    ? Math.ceil(
        (Date.parse(data.profile.interview_date) - Date.parse(today)) /
          86400000,
      )
    : null;
  const formattedDate = new Date(today + "T12:00:00Z").toLocaleDateString(
    "en-US",
    { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" },
  );
  return (
    <div className="overview">
      <div className="journal-heading">
        <span className="journal-date">{formattedDate}</span>
      </div>
      <section className="welcome-hero" aria-labelledby="welcome-title">
        <div className="welcome-copy">
          <h1 id="welcome-title">
            {data.profile.display_name
              ? `${data.profile.display_name}’s study journal`
              : "Your study journal"}
          </h1>
          <p>
            Coding practice, interview stories, and the next thing to work on. A
            place to keep your Amazon preparation together.
          </p>
          <div className="hero-actions">
            <Link
              className="primary button"
              href={enabled ? "/coding" : "/settings"}
            >
              {enabled ? "Open coding practice" : "Connect your workspace"}
              <ArrowRight size={17} />
            </Link>
          </div>
        </div>
        <div className="milestone-wrap">
          <div className="milestone-card">
            <span className="milestone-tab" aria-hidden="true" />
            <CalendarDays size={22} strokeWidth={1.5} />
            {days === null ? (
              <>
                <h2>Interview date</h2>
                <p>Add a date to see how much preparation time you have.</p>
              </>
            ) : (
              <>
                <strong className="milestone-days">
                  {Math.max(0, days)}
                  <small>
                    {days < 0
                      ? "interview date has passed"
                      : "days until your interview"}
                  </small>
                </strong>
                <p>
                  {new Date(
                    data.profile.interview_date + "T12:00:00Z",
                  ).toLocaleDateString("en-US", {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                    timeZone: "UTC",
                  })}
                </p>
              </>
            )}
            <Link href="/settings" className="text-link">
              {days === null ? "Choose your date" : "Update date"}
              <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </section>
      <div className="overview-columns">
        <div className="journal-main">
          <section className="panel focus-panel">
            <div className="panel-header">
              <h2>Today’s focus</h2>
              <Badge>
                {due.filter((t) => t.status === "planned").length} to do
              </Badge>
            </div>
            {due.length ? (
              <TaskList
                tasks={due}
                busy={busy}
                enabled={enabled}
                onToggle={onToggle}
              />
            ) : (
              <Empty
                icon={CalendarDays}
                title="No tasks for today"
                action={
                  <Link
                    href={enabled ? "/coding" : "/settings"}
                    className="secondary button"
                  >
                    {enabled
                      ? "Add your first problem"
                      : "Connect your workspace"}
                    <ArrowRight size={15} />
                  </Link>
                }
              >
                Record a practice attempt, then add a recommended review to your
                plan.
              </Empty>
            )}
            <div className="panel-note">
              <Link href="/plan" className="text-link">
                See study plan
                <ArrowRight size={14} />
              </Link>
            </div>
          </section>
          <section className="panel recent-panel">
            <div className="panel-header">
              <h2>Recent work</h2>
            </div>
            <Recent data={data} />
          </section>
          <section className="panel patterns-panel">
            <div className="panel-header">
              <h2>Pattern performance</h2>
              <Link href="/analytics" className="text-link">
                Explore patterns
                <ArrowRight size={14} />
              </Link>
            </div>
            <PatternChart attempts={data.attempts} />
          </section>
        </div>
        <aside
          className="journal-aside"
          aria-label="Your preparation at a glance"
        >
          <section className="progress-card">
            <h2>Practice so far</h2>
            <div className="progress-entry">
              <span className="entry-icon">
                <Code2 size={18} />
              </span>
              <div>
                <strong>{attempted} problems attempted</strong>
                <span>{data.attempts.length} recorded attempts</span>
              </div>
            </div>
            <div className="progress-entry">
              <span className="entry-icon">
                <CheckCheck size={18} />
              </span>
              <div>
                <strong>{solved} independently solved</strong>
                <span>Passed without hints or guidance</span>
              </div>
            </div>
            <div className="progress-entry">
              <span className="entry-icon">
                <BookOpen size={18} />
              </span>
              <div>
                <strong>
                  {ready} of {data.stories.length} stories ready
                </strong>
                <span>
                  {new Set(data.stories.flatMap((s) => s.principles)).size} of{" "}
                  {principles.length} Leadership Principles
                </span>
              </div>
            </div>
            <Link href="/stories" className="text-link">
              Open story bank
              <ArrowRight size={14} />
            </Link>
          </section>
          <section className="panel gentle-readiness">
            <h2>{score ? `Readiness · ${score.score}%` : "Readiness"}</h2>
            <Badge>
              {score ? "Current evidence index" : "Not enough data"}
            </Badge>
            <p>
              {score
                ? "Based on your recorded coding attempts and ready stories."
                : "Record more practice and stories before viewing a readiness score."}
            </p>
            <Link href="/analytics" className="text-link">
              See your readiness
              <ArrowRight size={14} />
            </Link>
          </section>
          <section className="upcoming-card">
            <div className="card-kicker">
              <CalendarDays size={18} />
              <h2>Upcoming tasks</h2>
            </div>
            {upcoming.length ? (
              <ul>
                {upcoming.map((t) => (
                  <li key={t.id}>
                    <span>{t.title}</span>
                    <time dateTime={t.due_on}>{t.due_on}</time>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No upcoming tasks scheduled.</p>
            )}
            <Link href="/plan" className="text-link">
              Open study plan
              <ArrowRight size={14} />
            </Link>
          </section>
        </aside>
      </div>
    </div>
  );
}
