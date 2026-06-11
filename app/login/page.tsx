"use client";

import { useState } from "react";
import { PageHeading } from "@/components/InfoAside";
import { useAuth } from "@/components/providers/AuthProvider";

type AuthMode = "login" | "register";

function redirectTarget() {
  const params = new URLSearchParams(window.location.search);
  const next = params.get("next");
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return "/generate";
}

export default function LoginPage() {
  const { user, hydrated, login, register, logout } = useAuth();
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    if (mode === "register" && password !== confirmPassword) {
      setMessage("Passwords do not match.");
      return;
    }

    setBusy(true);
    const result =
      mode === "login"
        ? await login({ email, password })
        : await register({ email, displayName, password });
    setBusy(false);

    if (!result.ok) {
      setMessage(result.reason);
      return;
    }
    window.location.assign(redirectTarget());
  }

  if (hydrated && user) {
    return (
      <div className="mx-auto w-full max-w-md space-y-4 px-3 sm:px-4">
        <section className="eg-card space-y-4 text-center">
          <PageHeading className="justify-center" title="Account" info={<p>You are signed in.</p>} />
          <div className="rounded-xl border border-[var(--eg-border)] bg-[var(--eg-bg)] px-3 py-3 text-sm">
            <p className="font-medium text-[var(--eg-fg)]">{user.displayName}</p>
            <p className="font-mono text-xs text-[var(--eg-muted)]">{user.email}</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
            <a className="eg-btn w-full sm:w-auto" href="/generate">
              Continue
            </a>
            <button
              type="button"
              className="eg-btn-ghost w-full sm:w-auto"
              onClick={() => void logout()}
            >
              Sign out
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md space-y-4 px-3 sm:px-4">
      <section className="eg-card space-y-5">
        <PageHeading
          title={mode === "login" ? "Sign in" : "Create account"}
          info={<p>Use an email and password to keep an ExamGPT session on this device.</p>}
        />

        <div className="grid grid-cols-2 gap-2 rounded-xl border border-[var(--eg-border)] bg-[var(--eg-bg)] p-1">
          {[
            ["login", "Sign in"],
            ["register", "Register"],
          ].map(([id, label]) => {
            const active = mode === id;
            return (
              <button
                key={id}
                type="button"
                className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                  active
                    ? "bg-[var(--eg-accent)] text-[var(--eg-on-accent)]"
                    : "text-[var(--eg-muted)] hover:bg-[var(--eg-surface)]"
                }`}
                onClick={() => {
                  setMode(id as AuthMode);
                  setMessage(null);
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          {mode === "register" && (
            <div>
              <label className="eg-label" htmlFor="display-name">
                Name
              </label>
              <input
                id="display-name"
                className="eg-input"
                autoComplete="name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Steven"
              />
            </div>
          )}

          <div>
            <label className="eg-label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              className="eg-input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@connect.hku.hk"
              required
            />
          </div>

          <div>
            <label className="eg-label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              className="eg-input"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={8}
            />
          </div>

          {mode === "register" && (
            <div>
              <label className="eg-label" htmlFor="confirm-password">
                Confirm password
              </label>
              <input
                id="confirm-password"
                className="eg-input"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
                minLength={8}
              />
            </div>
          )}

          {message && (
            <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
              {message}
            </p>
          )}

          <button type="submit" className="eg-btn w-full" disabled={busy || !hydrated}>
            {busy ? "Working…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>
      </section>
    </div>
  );
}
