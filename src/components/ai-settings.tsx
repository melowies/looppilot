"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Badge, Dialog, Field } from "./ui";

type Provider = "rules" | "chatgpt" | "openai";
type Status = {
  provider: Provider;
  active?: string;
  notice?: string;
  apiConfigured: boolean;
  profiles: {
    id: string;
    label: string;
    email?: string;
    verified: boolean;
    connected: boolean;
    authorized: boolean;
    model?: string;
    issue?: string;
    welcome: boolean;
  }[];
};
type Model = { slug: string; display_name: string };
async function aiRequest(body?: object) {
  const {
    data: { session },
  } = await supabase!.auth.getSession();
  if (!session) throw new Error("Sign in to LoopPilot first.");
  const response = await fetch("/api/ai/settings", {
    method: body ? "POST" : "GET",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error ?? "AI settings are unavailable.");
  return result;
}
export function AISettings({ enabled }: { enabled: boolean }) {
  const [status, setStatus] = useState<Status | null>(null),
    [models, setModels] = useState<Model[]>([]);
  const [provider, setProvider] = useState<Provider>("rules"),
    [model, setModel] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const active = status?.profiles.find((p) => p.id === status.active);
  const load = useCallback(async () => {
    try {
      const result: Status = await aiRequest();
      setStatus(result);
      setProvider(result.provider);
      const selected = result.profiles.find((p) => p.id === result.active);
      setModel(selected?.model ?? "");
      setError("");
      if (selected?.authorized)
        setModels((await aiRequest({ action: "models" })).models);
      else setModels([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI settings are unavailable.");
    }
  }, []);
  useEffect(() => {
    if (!enabled) return;
    const initialLoad = window.setTimeout(() => {
      void load();
    }, 0);
    const focus = () => {
      void load();
    };
    window.addEventListener("focus", focus);
    return () => {
      window.clearTimeout(initialLoad);
      window.removeEventListener("focus", focus);
    };
  }, [enabled, load]);
  async function act(body: object) {
    setBusy(true);
    setError("");
    try {
      const result = await aiRequest(body);
      if (result.url) {
        window.location.assign(result.url);
        return;
      }
      await load();
      window.dispatchEvent(new Event("looppilot-ai-settings"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI settings are unavailable.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="panel settings-panel ai-settings"
      aria-labelledby="ai-settings-title"
    >
      <h2 id="ai-settings-title">AI provider & ChatGPT connection</h2>
      <p>
        Supabase signs you into LoopPilot. ChatGPT connects only as an optional
        AI provider. Your schedule always uses the rule-based engine.
      </p>
      {!enabled && (
        <p className="panel-note">
          Sign in to LoopPilot to manage your local AI connection.
        </p>
      )}
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      {enabled && !status && (
        <button className="secondary" onClick={() => void load()}>
          Retry AI settings
        </button>
      )}
      {enabled && status && (
        <>
          <Field label="Saved ChatGPT account">
            <select
              disabled={busy}
              value={status.active ?? ""}
              onChange={(e) =>
                void act({ action: "select", profileId: e.target.value })
              }
            >
              <option value="" disabled>
                Select an account
              </option>
              {status.profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {p.email ? ` · ${p.email}` : " · Registration pending"}
                </option>
              ))}
            </select>
          </Field>
          <Badge tone={active?.authorized ? "rose" : "amber"}>
            {active?.connected
              ? active.authorized
                ? "Connected · plan permission granted"
                : "Identity connected · inference disabled"
              : "Disconnected"}
          </Badge>
          {active?.email && (
            <p>
              ChatGPT account: {active.email} · {active.label}
            </p>
          )}
          {status.notice && <p role="status">{status.notice}</p>}
          {active?.issue && (
            <p className="alert error" role="alert">
              {active.issue}
            </p>
          )}
          {typeof window !== "undefined" &&
            new URLSearchParams(window.location.search).get("chatgpt") ===
              "failed" &&
            !status.notice && (
              <p role="alert">
                ChatGPT sign-in did not complete. Start a fresh sign-in from
                this local window.
              </p>
            )}
          <div className="button-group">
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void act({
                  action: "connect",
                  ...(active ? { profileId: active.id } : {}),
                })
              }
            >
              Continue with ChatGPT
            </button>
            {!!status.profiles.length && (
              <button
                className="text-link"
                disabled={busy}
                onClick={() => void act({ action: "connect" })}
              >
                Add another account or workspace
              </button>
            )}
            {active?.connected && !active.authorized && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void act({
                    action: "connect",
                    profileId: active.id,
                    reconsent: true,
                  })
                }
              >
                Enable ChatGPT plan permission
              </button>
            )}
            {active?.connected && (
              <button
                className="text-link"
                disabled={busy}
                onClick={() => void act({ action: "disconnect" })}
              >
                Disconnect ChatGPT
              </button>
            )}
            <a
              className="text-link"
              href="https://chatgpt.com/settings/usage"
              target="_blank"
              rel="noreferrer"
            >
              Manage usage
            </a>
          </div>
          <p className="muted">
            Eligible ChatGPT Plus/Pro accounts can use their existing plan
            allowance or credits, subject to account, app, and preview limits.
            No OpenAI API key is required for ChatGPT plan mode. Connection
            alone does not enable coaching.
          </p>
          {active?.authorized && (
            <>
              <Field label="Available ChatGPT model">
                <select
                  value={model}
                  disabled={busy}
                  onChange={(e) => setModel(e.target.value)}
                >
                  <option value="">Select an available model</option>
                  {model && !models.some((m) => m.slug === model) && (
                    <option value={model} disabled>
                      {model} · unavailable
                    </option>
                  )}
                  {models.map((m) => (
                    <option key={m.slug} value={m.slug}>
                      {m.display_name}
                    </option>
                  ))}
                </select>
              </Field>
              {!models.length && (
                <p>
                  No models are currently available to this account. Refresh or
                  check eligibility.
                </p>
              )}
              <div className="button-group">
                <button
                  className="secondary"
                  disabled={busy || !models.some((m) => m.slug === model)}
                  onClick={() => void act({ action: "select", model })}
                >
                  Save ChatGPT model
                </button>
                <button
                  className="text-link"
                  disabled={busy}
                  onClick={() => void load()}
                >
                  Refresh models
                </button>
              </div>
            </>
          )}
          <Field label="AI provider">
            <select
              value={provider}
              disabled={busy}
              onChange={(e) => setProvider(e.target.value as Provider)}
            >
              <option value="rules">Rule-based planner · no AI usage</option>
              <option value="chatgpt">ChatGPT plan · existing allowance</option>
              <option value="openai">OpenAI API · separately billed</option>
            </select>
          </Field>
          {provider === "openai" && (
            <p className="panel-note">
              OpenAI API usage incurs separate API charges.{" "}
              {status.apiConfigured
                ? "A server API key is configured."
                : "OPENAI_API_KEY is not configured."}
            </p>
          )}
          {provider === "chatgpt" && (
            <p>
              {active?.authorized && active.model
                ? `Selected model: ${active.model}.`
                : "Connect an eligible account, grant plan permission, and save an available model first."}{" "}
              Requests use your ChatGPT plan allowance.
            </p>
          )}
          <button
            className="primary"
            disabled={
              busy ||
              (provider === "chatgpt" &&
                (!active?.authorized || !active.model)) ||
              (provider === "openai" && !status.apiConfigured)
            }
            onClick={() => void act({ action: "select", provider })}
          >
            Use selected provider
          </button>
          <p>
            Current provider:{" "}
            <strong>
              {status.provider === "chatgpt"
                ? "ChatGPT plan"
                : status.provider === "openai"
                  ? "OpenAI API · separately billed"
                  : "Rule-based planner"}
            </strong>
            . Failed requests never switch providers.
          </p>
          <p className="muted">
            To request coaching, also allow the structured summary in Study plan
            → Edit availability → AI coaching. Code, story text, notes, and
            personal names are excluded. Five requests per UTC day, one minute
            apart; validated results are cached for 12 hours.
          </p>
          {active?.welcome && (
            <Dialog
              title="You’re using your ChatGPT plan"
              onClose={() => void act({ action: "select", welcomed: true })}
            >
              <p>
                Eligible requests use your ChatGPT plan allowance or credits
                when you select ChatGPT plan and allow coaching. Manage limits
                in ChatGPT settings.
              </p>
              <a
                className="text-link"
                href="https://chatgpt.com/settings/usage"
                target="_blank"
                rel="noreferrer"
              >
                Manage usage
              </a>
              <div className="form-footer">
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => void act({ action: "select", welcomed: true })}
                >
                  Got it
                </button>
              </div>
            </Dialog>
          )}
        </>
      )}
    </section>
  );
}
