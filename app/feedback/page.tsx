"use client";

import { useMemo, useState } from "react";
import { InfoAside, PageHeading } from "@/components/InfoAside";
import { useExamGPT } from "@/components/providers/ExamGPTProvider";
import { CREDITS } from "@/lib/constants";

export default function FeedbackPage() {
  const { mockExams, feedbackEntries, submitFeedback, credits, hydrated } = useExamGPT();
  const [examId, setExamId] = useState("");
  const [similarity, setSimilarity] = useState(7);
  const [difficulty, setDifficulty] = useState(6);
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const awaitingFeedback = useMemo(
    () => mockExams.filter((e) => !feedbackEntries.some((f) => f.examId === e.id)),
    [mockExams, feedbackEntries],
  );

  const options = useMemo(
    () =>
      awaitingFeedback.map((e) => ({
        id: e.id,
        label: `${e.courseCode} · ${new Date(e.createdAt).toLocaleString()}`,
      })),
    [awaitingFeedback],
  );

  const firstId = awaitingFeedback[0]?.id ?? "";
  const resolvedExamId =
    examId && awaitingFeedback.some((e) => e.id === examId) ? examId : firstId;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!resolvedExamId) {
      setMessage("Nothing waiting for feedback.");
      return;
    }
    const result = submitFeedback({ examId: resolvedExamId, similarity, difficulty, notes });
    if (!result.ok) {
      setMessage(result.reason);
      return;
    }
    setMessage(`Saved · +${CREDITS.realExamFeedback} cr · paper in repository`);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeading
        title="Feedback"
        info={
          <>
            <p>
              After the real exam, score how close the mock was and how hard the real paper felt.
              That updates the simulated professor-style profile.
            </p>
            <p>
              Submitting feedback also promotes that mock into the repository (demo behaviour).
              Only papers without feedback yet appear in the list.
            </p>
          </>
        }
      />

      {mockExams.length === 0 ? (
        <div className="eg-card text-sm text-[var(--eg-muted)]">
          <a className="text-[var(--eg-accent-strong)] underline" href="/generate">
            Generate
          </a>{" "}
          a mock first.
        </div>
      ) : awaitingFeedback.length === 0 ? (
        <div className="eg-card text-sm text-[var(--eg-muted)]">
          All caught up.{" "}
          <a className="text-[var(--eg-accent-strong)] underline" href="/history">
            History
          </a>{" "}
          ·{" "}
          <a className="text-[var(--eg-accent-strong)] underline" href="/generate">
            New mock
          </a>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="eg-card space-y-5">
          <div>
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <label className="text-sm font-medium text-[var(--eg-muted)]" htmlFor="exam">
                Paper
              </label>
              <InfoAside ariaLabel="About paper selection">
                <p>Mocks that already have feedback are hidden here.</p>
              </InfoAside>
            </div>
            <select
              id="exam"
              className="eg-input"
              value={resolvedExamId}
              onChange={(e) => setExamId(e.target.value)}
            >
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="eg-label" htmlFor="sim">
              Similarity (1–10)
            </label>
            <input
              id="sim"
              type="range"
              min={1}
              max={10}
              value={similarity}
              onChange={(e) => setSimilarity(Number(e.target.value))}
              className="w-full accent-[var(--eg-accent)]"
            />
            <p className="text-xs text-[var(--eg-muted)]">{similarity}</p>
          </div>

          <div>
            <label className="eg-label" htmlFor="diff">
              Real exam difficulty (1–10)
            </label>
            <input
              id="diff"
              type="range"
              min={1}
              max={10}
              value={difficulty}
              onChange={(e) => setDifficulty(Number(e.target.value))}
              className="w-full accent-[var(--eg-accent)]"
            />
            <p className="text-xs text-[var(--eg-muted)]">{difficulty}</p>
          </div>

          <div>
            <label className="eg-label" htmlFor="notes">
              Notes (optional)
            </label>
            <textarea
              id="notes"
              className="eg-input min-h-[80px] resize-y"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--eg-border)] pt-4">
            <p className="text-sm text-[var(--eg-muted)]">
              +{CREDITS.realExamFeedback} cr · {!hydrated ? "…" : credits}
            </p>
            <button type="submit" className="eg-btn">
              Submit
            </button>
          </div>
        </form>
      )}

      {message && (
        <p className="rounded-xl border border-[var(--eg-border)] bg-[var(--eg-surface)] px-4 py-3 text-sm">
          {message}
        </p>
      )}
    </div>
  );
}
