"use client";
import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import {
  Activity,
  BookOpen,
  Check,
  Code2,
  Compass,
  Layers3,
  X,
} from "lucide-react";
import type { Attempt, Data } from "@/lib/domain";
import { patternPerformance } from "@/lib/planner";
import { pretty } from "@/lib/form";

// Keep viewport geometry with the rendered component. Older global styles can
// otherwise reset dialog margins to zero, even while newer dialog JS is running.
const dialogViewportStyle: CSSProperties = {
  position: "fixed",
  inset: "auto",
  top: "50%",
  left: "50%",
  margin: 0,
  transform: "translate(-50%, -50%)",
  width: "min(760px, calc(100vw - 28px))",
  maxWidth: "calc(100vw - 28px)",
  maxHeight: "calc(100dvh - 32px)",
  overflow: "auto",
  overscrollBehavior: "contain",
  zIndex: 100,
};
export function Field({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const labelId = useId();
  return (
    <label className={wide ? "field wide" : "field"}>
      <span id={labelId}>{label}</span>
      {isValidElement(children)
        ? cloneElement(
            children as ReactElement<{ "aria-labelledby"?: string }>,
            { "aria-labelledby": labelId },
          )
        : children}
    </label>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Empty({
  icon: Icon = Compass,
  title,
  children,
  action,
}: {
  icon?: typeof Compass;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={24} />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function SectionTitle({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}

export function PatternChart({ attempts }: { attempts: Attempt[] }) {
  const rows = patternPerformance(attempts).filter((p) => p.total);
  return (
    <div className="pattern-chart">
      {rows.length ? (
        rows.map((p) => (
          <div className="pattern-row" key={p.pattern}>
            <div>
              <span>{p.pattern}</span>
              <small>
                {p.independent}/{p.total} independent
              </small>
            </div>
            <div className="bar">
              <span style={{ width: `${(p.independent / p.total) * 100}%` }} />
            </div>
          </div>
        ))
      ) : (
        <Empty icon={Layers3} title="No pattern history yet">
          Record a coding attempt to see independent passes by pattern.
        </Empty>
      )}
      <div className="chart-legend">
        <span className="status-dot" />
        Independent passes <span className="legend-line" />
        All attempts
      </div>
    </div>
  );
}
export function TaskList({
  tasks,
  busy,
  enabled,
  onToggle,
}: {
  tasks: Data["tasks"];
  busy: boolean;
  enabled: boolean;
  onToggle: (t: Data["tasks"][number]) => void;
}) {
  return (
    <div className="task-list">
      {tasks.map((t) => (
        <div
          className={`task-row ${t.status === "completed" ? "done" : ""}`}
          key={t.id}
        >
          <button
            aria-label={`${t.status === "completed" ? "Reopen" : "Complete"} ${t.title}`}
            className="task-check"
            disabled={busy || !enabled}
            onClick={() => onToggle(t)}
          >
            {t.status === "completed" && <Check size={14} />}
          </button>
          <div>
            <strong>{t.title}</strong>
            <p>{t.reason}</p>
            <small>{t.due_on}</small>
          </div>
          <Badge tone={t.status === "completed" ? "rose" : "neutral"}>
            {t.status}
          </Badge>
        </div>
      ))}
    </div>
  );
}
export function Recent({ data }: { data: Data }) {
  const events = [
    ...data.attempts.map((a) => ({
      id: a.id,
      date: a.attempted_on,
      title:
        data.problems.find((p) => p.id === a.problem_id)?.title ??
        "Coding attempt",
      detail: `${pretty(a.assistance)} · ${a.correctness}`,
      icon: Code2,
    })),
    ...data.stories.map((s) => ({
      id: s.id,
      date: s.updated_at.slice(0, 10),
      title: s.title,
      detail: `Story updated · ${s.status}`,
      icon: BookOpen,
    })),
  ]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 4);
  return (
    <div className="recent">
      {events.length ? (
        events.map((e) => (
          <div className="recent-row" key={e.id}>
            <span>
              <e.icon size={16} />
            </span>
            <div>
              <strong>{e.title}</strong>
              <small>{e.detail}</small>
            </div>
            <time>{e.date}</time>
          </div>
        ))
      ) : (
        <div className="quiet-empty">
          <Activity size={22} />
          <p>
            No recent work
            <br />
            <span>Recorded attempts and story updates will appear here.</span>
          </p>
        </div>
      )}
    </div>
  );
}

export function Dialog({
  title,
  children,
  onClose,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [opener] = useState(() =>
    typeof document !== "undefined" &&
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  useEffect(() => {
    const d = ref.current;
    const previousFocus = opener;
    const scrollY = window.scrollY;
    const bodyStyle = document.body.style;
    const saved = {
      position: bodyStyle.position,
      top: bodyStyle.top,
      left: bodyStyle.left,
      right: bodyStyle.right,
      width: bodyStyle.width,
      overflow: bodyStyle.overflow,
    };
    const rootOverflow = document.documentElement.style.overflow;
    Object.assign(bodyStyle, {
      position: "fixed",
      top: `-${scrollY}px`,
      left: "0",
      right: "0",
      width: "100%",
      overflow: "hidden",
    });
    document.documentElement.style.overflow = "hidden";
    d?.showModal();
    return () => {
      d?.close();
      Object.assign(bodyStyle, saved);
      document.documentElement.style.overflow = rootOverflow;
      window.scrollTo(0, scrollY);
      previousFocus?.focus({ preventScroll: true });
    };
  }, [opener]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <dialog
      ref={ref}
      className={`dialog ${className}`}
      style={dialogViewportStyle}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button, [href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])',
          ),
        ).filter(
          (el) => !el.matches(":disabled") && el.getClientRects().length > 0,
        );
        const first = controls[0],
          last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      aria-labelledby="dialog-title"
    >
      <div className="dialog-header">
        <div>
          <h2 id="dialog-title">{title}</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>,
    document.body,
  );
}
