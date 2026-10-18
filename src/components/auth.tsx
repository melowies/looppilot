"use client";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, Loader2, ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { get, message } from "@/lib/form";
import { Field } from "./ui";
import { Brand } from "./brand";
export function Auth({
  error: initialError,
  recovering,
  onRecovered,
}: {
  error: string;
  recovering: boolean;
  onRecovered: () => void;
}) {
  const [mode, setMode] = useState<"login" | "signup" | "reset" | "password">(
      recovering ? "password" : "login",
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(initialError),
    [notice, setNotice] = useState("");
  useEffect(() => {
    const { data } = supabase!.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setMode("password");
    });
    return () => data.subscription.unsubscribe();
  }, []);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const f = new FormData(e.currentTarget);
    try {
      let result;
      if (mode === "signup")
        result = await supabase!.auth.signUp({
          email: get(f, "email"),
          password: get(f, "password"),
          options: { emailRedirectTo: window.location.origin },
        });
      else if (mode === "reset")
        result = await supabase!.auth.resetPasswordForEmail(get(f, "email"), {
          redirectTo: window.location.origin + "?recovery=1",
        });
      else if (mode === "password")
        result = await supabase!.auth.updateUser({
          password: get(f, "password"),
        });
      else
        result = await supabase!.auth.signInWithPassword({
          email: get(f, "email"),
          password: get(f, "password"),
        });
      if (result.error) throw result.error;
      if (mode === "signup")
        setNotice("Check your email to confirm your account, then sign in.");
      if (mode === "reset")
        setNotice("If an account exists, a password reset link is on its way.");
      if (mode === "password") {
        setNotice("Password updated.");
        onRecovered();
      }
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <div className="auth-brand">
        <Brand />
      </div>
      <section className="auth-card">
        <h1>
          {mode === "signup"
            ? "Create an account"
            : mode === "reset"
              ? "Reset password"
              : mode === "password"
                ? "Choose a new password"
                : "Sign in"}
        </h1>
        <p>
          {mode === "signup"
            ? "Keep your coding practice and interview stories in one place."
            : mode === "reset"
              ? "Enter your email to receive a reset link."
              : mode === "password"
                ? "Use at least eight characters."
                : "Open your study journal."}
        </p>
        {error && (
          <div role="alert" className="alert error">
            {error}
          </div>
        )}
        {notice && (
          <div role="status" className="alert success">
            {notice}
          </div>
        )}
        <form onSubmit={(e) => void submit(e)}>
          {mode !== "password" && (
            <Field label="Email address">
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
              />
            </Field>
          )}
          {mode !== "reset" && (
            <Field label="Password">
              <input
                name="password"
                type="password"
                required
                minLength={mode === "login" ? 1 : 8}
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
              />
            </Field>
          )}
          <button className="primary" disabled={busy}>
            {busy ? (
              <Loader2 size={16} className="spin" />
            ) : (
              <ArrowRight size={16} />
            )}{" "}
            {mode === "signup"
              ? "Create account"
              : mode === "reset"
                ? "Send reset link"
                : mode === "password"
                  ? "Update password"
                  : "Sign in"}
          </button>
        </form>
        <div className="auth-links">
          <button
            className="text-link"
            onClick={() => {
              setMode(mode === "signup" ? "login" : "signup");
              setError("");
              setNotice("");
            }}
          >
            {mode === "signup"
              ? "Already have an account? Sign in"
              : "Create an account"}
          </button>
          <button className="text-link" onClick={() => setMode("reset")}>
            Forgot password?
          </button>
        </div>
        <div className="panel-note">
          <ShieldCheck size={16} />
          Your data is accessible only to your authenticated account.
        </div>
      </section>
    </main>
  );
}
