"use client";

import { useState } from "react";
import { PageHeading, SectionHeading } from "@/components/InfoAside";
import { useExamGPT } from "@/components/providers/ExamGPTProvider";
import { CREDITS } from "@/lib/constants";

export default function SettingsPage() {
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
  const [keyInput, setKeyInput] = useState("");

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-3 sm:space-y-6 sm:px-4">
      <PageHeading
        title="Credits / BYOK"
        info={
          <>
            <p>
              BYOK: use your own OpenAI or Claude key so hosted generation costs 0 credits. In
              production, keys belong in a vault with encryption (e.g. AES-256); this demo stores
              them in plain localStorage — do not use production secrets.
            </p>
            <p>Credit top-ups here are fake buttons; Stripe / PayMe would wire in later.</p>
          </>
        }
      />

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">
        <div className="eg-card space-y-4 p-4 sm:p-6">
          <SectionHeading
            title="BYOK"
            info={
              <p>
                Toggle on to skip credit charges for generation and partial regen. Saving a key only
                marks that you intend to call your provider from a future integrated client — this
                UI does not call the API yet.
              </p>
            }
          />
          <label className="flex cursor-pointer items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--eg-accent)]"
              checked={byok}
              onChange={(e) => setByok(e.target.checked)}
            />
            <span>Use my key</span>
          </label>
          <div>
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <label className="text-sm font-medium text-[var(--eg-muted)]" htmlFor="apikey">
                Key
              </label>
            </div>
            <input
              id="apikey"
              type="password"
              autoComplete="off"
              className="eg-input font-mono text-sm"
              placeholder="sk-…"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
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
        </div>

        <div className="eg-card space-y-4 p-4 sm:p-6">
          <SectionHeading
            title="Top-up (demo)"
            info={
              <p>
                Simulates buying credits. Reference prices: generate {CREDITS.generateMock}, regen{" "}
                {CREDITS.regenerateQuestions}, ask {CREDITS.answerInquiry}, feedback +
                {CREDITS.realExamFeedback}, question +{CREDITS.questionContribution}, paper +
                {CREDITS.pastPaperContribution}.
              </p>
            }
          />
          <p className="text-sm">
            Balance: <strong>{!hydrated ? "…" : credits}</strong>
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="eg-btn text-sm" onClick={() => topUpDemo(50)}>
              +50
            </button>
            <button type="button" className="eg-btn-ghost text-sm" onClick={() => topUpDemo(200)}>
              +200
            </button>
          </div>
        </div>
      </div>

      <div className="eg-card space-y-3 p-4 sm:space-y-4 sm:p-6">
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
          {professorStyleNotes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      </div>

      <div className="eg-card space-y-3 p-4 sm:space-y-4 sm:p-6">
        <SectionHeading
          title="Ledger"
          info={<p>Append-only credit log for this browser profile.</p>}
        />
        {ledger.length === 0 ? (
          <p className="text-sm text-[var(--eg-muted)]">Empty.</p>
        ) : (
          <div className="overflow-x-auto -mx-4 px-4 sm:-mx-6 sm:px-6">
            <table className="w-full min-w-[320px] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--eg-border)] text-[var(--eg-muted)]">
                  <th className="py-2 pr-2 font-medium">When</th>
                  <th className="py-2 pr-2 font-medium">What</th>
                  <th className="py-2 font-medium">Δ</th>
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
                        row.delta >= 0 ? "text-emerald-600 dark:text-emerald-300" : "text-red-600 dark:text-red-300"
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
      </div>
    </div>
  );
}
