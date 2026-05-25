"use client";

import { useMemo, useState } from "react";
import { InfoAside, PageHeading } from "@/components/InfoAside";
import { useExamGPT } from "@/components/providers/ExamGPTProvider";
import { isExamInRepository } from "@/lib/examStatus";
import { CREDITS } from "@/lib/constants";

export default function HistoryPage() {
  const { mockExams, feedbackEntries, submitFeedback, updateFeedback, credits, hydrated } = useExamGPT();
  const [feedbackExamId, setFeedbackExamId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [similarity, setSimilarity] = useState(7);
  const [difficulty, setDifficulty] = useState(6);
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const rows = useMemo(
    () => [...mockExams].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [mockExams],
  );

  function getExistingFeedback(examId: string) {
    return feedbackEntries.find((f) => f.examId === examId);
  }

  function openFeedback(examId: string, editing = false) {
    const existing = getExistingFeedback(examId);
    setFeedbackExamId(examId);
    setIsEditing(editing);
    if (existing) {
      setSimilarity(existing.similarity);
      setDifficulty(existing.difficulty);
      setNotes(existing.notes);
    } else {
      setSimilarity(7);
      setDifficulty(6);
      setNotes("");
    }
    setMessage(null);
  }

  function closeFeedback() {
    setFeedbackExamId(null);
    setIsEditing(false);
    setMessage(null);
  }

  function onSubmitFeedback(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!feedbackExamId) return;
    
    const result = isEditing
      ? updateFeedback({ examId: feedbackExamId, similarity, difficulty, notes })
      : submitFeedback({ examId: feedbackExamId, similarity, difficulty, notes });
      
    if (!result.ok) {
      setMessage(result.reason);
      return;
    }
    
    const successMsg = isEditing 
      ? "Feedback updated successfully"
      : `Saved · +${CREDITS.realExamFeedback} cr · paper in repository`;
    setMessage(successMsg);
    
    setTimeout(() => {
      closeFeedback();
    }, 1500);
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 px-3 sm:space-y-6 sm:px-4">
      <PageHeading
        title="History"
        info={
          <>
            <p>Every mock you generate is listed here (stored locally).</p>
            <p>
              &ldquo;In repository&rdquo; means you already submitted feedback for that paper.
              You can edit your feedback anytime.
            </p>
          </>
        }
      />

      {rows.length === 0 ? (
        <div className="eg-card text-sm text-[var(--eg-muted)]">
          <a className="text-[var(--eg-accent-strong)] underline" href="/generate">
            Generate
          </a>{" "}
          a mock first.
        </div>
      ) : (
        <ul className="space-y-2 sm:space-y-3">
          {rows.map((e) => {
            const synced = isExamInRepository(e.id, feedbackEntries);
            const pendingReview = e.questions.filter(
              (q) => (q.reviewStatus ?? "pending") !== "accepted",
            ).length;
            const isFeedbackOpen = feedbackExamId === e.id;
            const existingFeedback = getExistingFeedback(e.id);
            
            return (
              <li key={e.id} className={`eg-card p-4 transition hover:border-[var(--eg-accent)]/40 sm:p-6 ${isFeedbackOpen ? 'ring-2 ring-[var(--eg-accent)]/20' : ''}`}>
                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                  <a href={`/exam/${e.id}`} className="min-w-0 flex-1">
                    <div>
                      <p className="font-mono text-sm font-semibold text-[var(--eg-accent-strong)]">
                        {e.courseCode}
                      </p>
                      <p className="text-xs text-[var(--eg-muted)]">
                        {new Date(e.createdAt).toLocaleString()}
                        {e.contentRevision ? ` · ${e.contentRevision}× regen` : ""}
                      </p>
                      {!synced && pendingReview > 0 && (
                        <p className="mt-0.5 text-xs text-[var(--eg-muted)]">{pendingReview} not accepted</p>
                      )}
                      {synced && existingFeedback && (
                        <p className="mt-0.5 text-xs text-emerald-700 dark:text-emerald-300">
                          Similarity: {existingFeedback.similarity}/10 · Difficulty: {existingFeedback.difficulty}/10
                        </p>
                      )}
                    </div>
                  </a>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-medium sm:px-2.5 ${
                        synced
                          ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200"
                          : "bg-[var(--eg-border)] text-[var(--eg-muted)]"
                      }`}
                    >
                      {synced ? "Repository" : "No feedback yet"}
                    </span>
                    
                    {synced ? (
                      <button
                        type="button"
                        onClick={() => openFeedback(e.id, true)}
                        className="rounded-full border border-[var(--eg-border)] bg-[var(--eg-surface)] px-2.5 py-1 text-xs font-medium text-[var(--eg-muted)] hover:text-[var(--eg-fg)] sm:px-3"
                      >
                        Edit
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openFeedback(e.id, false)}
                        className="rounded-full bg-[var(--eg-accent)] px-2.5 py-1 text-xs font-medium text-[var(--eg-on-accent)] hover:opacity-90 sm:px-3"
                      >
                        Feedback (+{CREDITS.realExamFeedback})
                      </button>
                    )}
                    
                    <InfoAside ariaLabel="Status meaning">
                      <p>
                        <strong>No feedback yet:</strong> still on device only until you file
                        feedback.
                      </p>
                      <p>
                        <strong>Repository:</strong> feedback submitted; you can edit it anytime.
                      </p>
                    </InfoAside>
                  </div>
                </div>

                {/* Feedback Form */}
                {isFeedbackOpen && (
                  <form onSubmit={onSubmitFeedback} className="mt-4 space-y-4 border-t border-[var(--eg-border)] pt-4 sm:mt-6 sm:space-y-5 sm:pt-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold">
                        {isEditing ? "Edit Feedback" : "Submit Feedback"}
                      </h3>
                      <button
                        type="button"
                        onClick={closeFeedback}
                        className="text-xs text-[var(--eg-muted)] hover:text-[var(--eg-fg)]"
                      >
                        Cancel
                      </button>
                    </div>
                    
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-[var(--eg-muted)]" htmlFor={`sim-${e.id}`}>
                          Similarity to real exam (1–10)
                        </label>
                        <input
                          id={`sim-${e.id}`}
                          type="range"
                          min={1}
                          max={10}
                          value={similarity}
                          onChange={(ev) => setSimilarity(Number(ev.target.value))}
                          className="w-full accent-[var(--eg-accent)]"
                        />
                        <p className="text-xs text-[var(--eg-muted)]">{similarity}</p>
                      </div>
                      
                      <div>
                        <label className="mb-1 block text-xs font-medium text-[var(--eg-muted)]" htmlFor={`diff-${e.id}`}>
                          Real exam difficulty (1–10)
                        </label>
                        <input
                          id={`diff-${e.id}`}
                          type="range"
                          min={1}
                          max={10}
                          value={difficulty}
                          onChange={(ev) => setDifficulty(Number(ev.target.value))}
                          className="w-full accent-[var(--eg-accent)]"
                        />
                        <p className="text-xs text-[var(--eg-muted)]">{difficulty}</p>
                      </div>
                    </div>
                    
                    <div>
                      <label className="mb-1 block text-xs font-medium text-[var(--eg-muted)]" htmlFor={`notes-${e.id}`}>
                        Notes (optional)
                      </label>
                      <textarea
                        id={`notes-${e.id}`}
                        className="eg-input min-h-[60px] resize-y text-sm"
                        value={notes}
                        onChange={(ev) => setNotes(ev.target.value)}
                        placeholder="How did the real exam compare?"
                      />
                    </div>
                    
                    {message && (
                      <p className={`rounded-lg border px-3 py-2 text-sm ${
                        message.includes("error") || message.includes("Not enough")
                          ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
                          : "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
                      }`}>
                        {message}
                      </p>
                    )}
                    
                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                      <p className="text-xs text-[var(--eg-muted)]">
                        {isEditing 
                          ? "Editing existing feedback" 
                          : `+${CREDITS.realExamFeedback} cr · ${!hydrated ? "…" : credits}`}
                      </p>
                      <button type="submit" className="eg-btn w-full text-sm sm:w-auto">
                        {isEditing ? "Update Feedback" : "Submit Feedback"}
                      </button>
                    </div>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
