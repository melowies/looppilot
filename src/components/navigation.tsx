"use client";

import Link from "next/link";
import { Brand } from "./brand";
import {
  BookOpen,
  CalendarDays,
  Code2,
  Home,
  LogOut,
  Settings2,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";

const destinations = [
  { href: "/", label: "Overview", short: "Home", icon: Home },
  { href: "/coding", label: "Coding practice", short: "Code", icon: Code2 },
  { href: "/stories", label: "Story bank", short: "Stories", icon: BookOpen },
  { href: "/plan", label: "Study plan", short: "Plan", icon: CalendarDays },
  {
    href: "/analytics",
    label: "Readiness",
    short: "Readiness",
    icon: TrendingUp,
  },
  { href: "/settings", label: "Settings", short: "Settings", icon: Settings2 },
];

export function Navigation({
  path,
  name,
  signedIn,
  onNavigate,
  onSignOut,
}: {
  path: string;
  name: string;
  signedIn: boolean;
  onNavigate: () => void;
  onSignOut: () => void;
}) {
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="app-header">
        <div className="header-inner">
          <Link href="/" className="brand" aria-label="LoopPilot home">
            <Brand />
          </Link>
          <nav className="desktop-nav" aria-label="Main navigation">
            {destinations.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                onClick={onNavigate}
                aria-current={path === n.href ? "page" : undefined}
                className={path === n.href ? "active" : ""}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="account-controls">
            <span className="privacy">
              <ShieldCheck size={15} />
              {signedIn ? "Just for you" : "Setup preview"}
            </span>
            {signedIn ? (
              <>
                <span className="avatar" aria-label={name || "Your account"}>
                  {name.slice(0, 1).toUpperCase() || "Y"}
                </span>
                <button
                  className="icon-button"
                  aria-label="Sign out"
                  onClick={onSignOut}
                >
                  <LogOut size={18} />
                </button>
              </>
            ) : null}
          </div>
        </div>
      </header>
      <nav className="bottom-nav" aria-label="Mobile navigation">
        {destinations.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            onClick={onNavigate}
            aria-label={n.label}
            aria-current={path === n.href ? "page" : undefined}
            className={path === n.href ? "active" : ""}
          >
            <n.icon size={19} strokeWidth={1.7} />
            <span>{n.short}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
