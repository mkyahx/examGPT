"use client";

import { useState } from "react";
import { PageHeading, SectionHeading } from "@/components/InfoAside";
import { useAuth } from "@/components/providers/AuthProvider";
import { useExamGPT } from "@/components/providers/ExamGPTProvider";
import { CREDITS } from "@/lib/constants";

type AuthMode = "login" | "register";

function redirectTarget() {
  const params = new URLSearchParams(window.location.search);
  const next = params.get("next");
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return "/account";
}

export default function AccountPage() {
  const { user, hydrated: authHydrated, login, register, logout } = useAuth();
  const {
    byok,
    setByok,
    saveByokKey,
    clearByokKey,
    hasStoredKey,
    topUpDemo,
    ledger,
    credits,
    hydrated,
    professorStyleNotes,
  } = useExamGPT();
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [keyInput, setKeyInput] = useState("");
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

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-3 sm:space-y-6 sm:px-4">
      <PageHeading
        title="Account"
        info={
          <p>
            Manage sign-in, BYOK, demo credits, and the local credit ledger from one place.
          </p>
        }
      />

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section className="eg-card space-y-5 p-4 sm:p-6">
          <SectionHeading
            title={user ? "Profile" : mode === "login" ? "Sign in" : "Create account"}
            info={
              <p>
                {user
                  ? "Your browser has an active ExamGPT session."
                  : "Use an email and password to keep an ExamGPT session on this device."}
              </p>
            }
          />

          {authHydrated && user ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-[var(--eg-border)] bg-[var(--eg-bg)] px-3 py-3 text-sm">
                <p className="font-medium text-[var(--eg-fg)]">{user.displayName}</p>
                <p className="font-mono text-xs text-[var(--eg-muted)]">{user.email}</p>
                <p className="mt-2 text-xs uppercase text-[var(--eg-muted)]">{user.role}</p>
              </div>
              <button type="button" className="eg-btn-ghost w-full" onClick={() => void logout()}>
                Sign out
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 rounded-lg border border-[var(--eg-border)] bg-[var(--eg-bg)] p-1">
                {[
                  ["login", "Sign in"],
                  ["register", "Register"],
                ].map(([id, label]) => {
                  const active = mode === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      className={`rounded-md px-3 py-2 text-sm font-medium transition ${
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
                  <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
                    {message}
                  </p>
                )}

                <button type="submit" className="eg-btn w-full" disabled={busy || !authHydrated}>
                  {busy ? "Working..." : mode === "login" ? "Sign in" : "Create account"}
                </button>
              </form>
            </>
          )}
        </section>

        <div className="grid gap-4 sm:gap-6">
          <section className="eg-card space-y-4 p-4 sm:p-6">
            <SectionHeading
              title="Credits"
              info={
                <p>
                  Demo balance. Generate {CREDITS.generateMock}, regen{" "}
                  {CREDITS.regenerateQuestions}, ask {CREDITS.answerInquiry}, feedback +
                  {CREDITS.realExamFeedback}, question +{CREDITS.questionContribution}, paper +
                  {CREDITS.pastPaperContribution}.
                </p>
              }
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm">
                Balance: <strong>{!hydrated ? "..." : credits}</strong>
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="eg-btn text-sm" onClick={() => topUpDemo(50)}>
                  +50
                </button>
                <button
                  type="button"
                  className="eg-btn-ghost text-sm"
                  onClick={() => topUpDemo(200)}
                >
                  +200
                </button>
              </div>
            </div>
          </section>

          <section className="eg-card space-y-4 p-4 sm:p-6">
            <SectionHeading
              title="BYOK"
              info={
                <p>
                  Toggle on to skip credit charges for generation and partial regen. Saved keys are
                  stored in localStorage for this demo.
                </p>
              }
            />
            <label className="flex cursor-pointer items-center gap-3 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--eg-accent)]"
                checked={byok}
                onChange={(event) => setByok(event.target.checked)}
              />
              <span>Use my key</span>
            </label>
            <div>
              <label className="eg-label" htmlFor="apikey">
                Key
              </label>
              <input
                id="apikey"
                type="password"
                autoComplete="off"
                className="eg-input font-mono text-sm"
                placeholder="sk-..."
                value={keyInput}
                onChange={(event) => setKeyInput(event.target.value)}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="eg-btn text-sm"
                  onClick={() => {
                    saveByokKey(keyInput);
                    setKeyInput("");
                  }}
                >
                  Save
                </button>
                <button type="button" className="eg-btn-ghost text-sm" onClick={clearByokKey}>
                  Clear
                </button>
              </div>
              <p className="mt-2 text-xs text-[var(--eg-muted)]">
                {hasStoredKey ? "Stored (demo)" : "None"}
              </p>
            </div>
          </section>
        </div>
      </div>

      <section className="eg-card space-y-3 p-4 sm:space-y-4 sm:p-6">
        <SectionHeading
          title="Style profile"
          info={
            <p>
              Short notes appended when you submit feedback or add bank items. A real system would
              tune retrieval and few-shot prompts from this signal.
            </p>
          }
        />
        <ul className="list-inside list-disc space-y-1 text-sm text-[var(--eg-fg)]">
          {professorStyleNotes.map((note, index) => (
            <li key={index}>{note}</li>
          ))}
        </ul>
      </section>

      <section className="eg-card space-y-3 p-4 sm:space-y-4 sm:p-6">
        <SectionHeading title="Ledger" info={<p>Append-only credit log for this browser profile.</p>} />
        {ledger.length === 0 ? (
          <p className="text-sm text-[var(--eg-muted)]">Empty.</p>
        ) : (
          <div className="-mx-4 overflow-x-auto px-4 sm:-mx-6 sm:px-6">
            <table className="w-full min-w-[320px] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--eg-border)] text-[var(--eg-muted)]">
                  <th className="py-2 pr-2 font-medium">When</th>
                  <th className="py-2 pr-2 font-medium">What</th>
                  <th className="py-2 font-medium">Delta</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((row) => (
                  <tr key={row.id} className="border-b border-[var(--eg-border)] last:border-0">
                    <td className="py-2 pr-2 text-xs text-[var(--eg-muted)]">
                      {new Date(row.at).toLocaleString()}
                    </td>
                    <td className="py-2 pr-2">{row.reason}</td>
                    <td
                      className={`py-2 font-mono ${
                        row.delta >= 0
                          ? "text-emerald-600 dark:text-emerald-300"
                          : "text-red-600 dark:text-red-300"
                      }`}
                    >
                      {row.delta > 0 ? `+${row.delta}` : row.delta}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
