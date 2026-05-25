"use client";

import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { InfoAside, SectionHeading } from "@/components/InfoAside";
import { useExamGPT } from "@/components/providers/ExamGPTProvider";
import { CREDITS } from "@/lib/constants";
import { isExamInRepository } from "@/lib/examStatus";
import type { QuestionReviewStatus } from "@/lib/types";

function statusLabel(s: QuestionReviewStatus | undefined) {
  switch (s) {
    case "accepted":
      return "Accepted";
    case "declined":
      return "Declined";
    default:
      return "Pending";
  }
}

function statusClass(s: QuestionReviewStatus | undefined) {
  switch (s) {
    case "accepted":
      return "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200";
    case "declined":
      return "bg-amber-500/15 text-amber-900 dark:text-amber-100";
    default:
      return "bg-[var(--eg-border)] text-[var(--eg-muted)]";
  }
}

export default function ExamDetailPage() {
  const params = useParams<{ id: string }>();
  const {
    mockExams,
    feedbackEntries,
    spendInquiry,
    credits,
    byok,
    hydrated,
    setQuestionReview,
    regenerateDeclinedQuestions,
  } = useExamGPT();
  const [inquiry, setInquiry] = useState<string | null>(null);
  const [inqError, setInqError] = useState<string | null>(null);
  const [regenNote, setRegenNote] = useState("");
  const [regenMsg, setRegenMsg] = useState<string | null>(null);

  const exam = useMemo(
    () => mockExams.find((e) => e.id === params.id),
    [mockExams, params.id],
  );

  const locked = exam ? isExamInRepository(exam.id, feedbackEntries) : false;

  const reviewCounts = useMemo(() => {
    if (!exam) return { pending: 0, accepted: 0, declined: 0 };
    let pending = 0;
    let accepted = 0;
    let declined = 0;
    for (const q of exam.questions) {
      const s = q.reviewStatus ?? "pending";
      if (s === "accepted") accepted += 1;
      else if (s === "declined") declined += 1;
      else pending += 1;
    }
    return { pending, accepted, declined };
  }, [exam]);

  const declinedCount = reviewCounts.declined;
  const canAffordRegen =
    byok || credits >= Math.abs(CREDITS.regenerateQuestions);

  if (!exam) {
    return (
      <div className="mx-auto w-full max-w-lg px-3">
        <div className="eg-card text-center text-sm text-[var(--eg-muted)]">
          Not found.{" "}
          <button
            type="button"
            className="text-[var(--eg-accent-strong)] underline"
            onClick={() => window.location.assign("/generate")}
          >
            New mock
          </button>{" "}
          ·{" "}
          <a href="/history" className="text-[var(--eg-accent-strong)] underline">
            History
          </a>
        </div>
      </div>
    );
  }

  const paper = exam;

  function runInquiry() {
    setInqError(null);
    const res = spendInquiry();
    if (!res.ok) {
      setInqError(res.reason);
      return;
    }
    setInquiry(
      "Step-by-step outline: (1) restate definitions from the prompt, (2) draw a labelled diagram or table if applicable, (3) show the main derivation or algorithm trace, (4) sanity-check units and limiting cases, (5) conclude with a one-line takeaway aligned with HKU mark schemes.",
    );
  }

  function onReview(questionId: string, status: QuestionReviewStatus) {
    if (locked) return;
    setRegenMsg(null);
    setQuestionReview(paper.id, questionId, status);
  }

  function onRegenerate() {
    setRegenMsg(null);
    const res = regenerateDeclinedQuestions(paper.id, regenNote);
    if (!res.ok) {
      setRegenMsg(res.reason);
      return;
    }
    setRegenMsg("Rewrote declined items → pending again.");
    setRegenNote("");
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 px-3 sm:space-y-6 sm:px-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{paper.courseCode}</h1>
            <InfoAside ariaLabel="About this mock">
              <p>{paper.sourceSummary}</p>
              <p className="text-[var(--eg-fg)]">
                Focus: <span className="whitespace-pre-wrap">{paper.focusHints}</span>
              </p>
              <p>
                {new Date(paper.createdAt).toLocaleString()} · {reviewCounts.accepted}✓ ·{" "}
                {reviewCounts.pending}… · {reviewCounts.declined}✗
              </p>
            </InfoAside>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href="/history" className="eg-btn-ghost text-sm">
            History
          </a>
          {!locked ? (
            <span className="rounded-full border border-[var(--eg-border)] bg-[var(--eg-surface)] px-3 py-2 text-xs text-[var(--eg-muted)]">
              Feedback in History
            </span>
          ) : (
            <span className="rounded-full border border-[var(--eg-border)] px-3 py-2 text-xs text-[var(--eg-muted)]">
              In repo
            </span>
          )}
          <a href="/generate" className="eg-btn-ghost text-sm">
            New
          </a>
        </div>
      </div>

      {!locked ? (
        <div className="flex flex-col gap-2 rounded-2xl border border-[var(--eg-border)] bg-[var(--eg-surface)] p-3 sm:flex-row sm:flex-wrap sm:items-start">
          <p className="min-w-0 flex-1 text-sm text-[var(--eg-muted)]">
            Local until you submit feedback — then it joins the repository (demo).
          </p>
          <InfoAside ariaLabel="Repository behaviour">
            <p>
              History always keeps the file. &ldquo;Repository&rdquo; here only means feedback was
              filed so downstream features can trust that signal.
            </p>
          </InfoAside>
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100 sm:flex-row sm:flex-wrap sm:items-start">
          <p className="min-w-0 flex-1">
            Synced
            {paper.repositorySyncedAt
              ? ` · ${new Date(paper.repositorySyncedAt).toLocaleString()}`
              : ""}
            . Review locked.
          </p>
          <InfoAside ariaLabel="Locked copy">
            <p>No further accept/decline or partial regen on this snapshot once feedback exists.</p>
          </InfoAside>
        </div>
      )}

      <section className="eg-card space-y-4">
        <SectionHeading
          title="Questions"
          info={
            <p>
              Accept to freeze a stem. Decline if you want only that item rewritten. Pending means
              you have not decided yet. Partial regen only touches declined rows.
            </p>
          }
        />
        <ol className="space-y-4 sm:space-y-5">
          {paper.questions.map((q, idx) => {
            const st = q.reviewStatus ?? "pending";
            return (
              <li
                key={q.id}
                className="border-b border-[var(--eg-border)] pb-4 last:border-0 last:pb-0 sm:pb-5"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-[var(--eg-accent-strong)]">
                      Q{idx + 1} · {q.marks}pt
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(st)}`}
                    >
                      {statusLabel(st)}
                    </span>
                  </div>
                  {!locked && (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded-full border border-[var(--eg-border)] px-2.5 py-1 text-xs font-medium hover:bg-[var(--eg-bg)] disabled:opacity-40 sm:px-3"
                        onClick={() => onReview(q.id, "accepted")}
                        disabled={st === "accepted"}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        className="rounded-full border border-[var(--eg-border)] px-2.5 py-1 text-xs font-medium hover:bg-[var(--eg-bg)] disabled:opacity-40 sm:px-3"
                        onClick={() => onReview(q.id, "declined")}
                        disabled={st === "declined"}
                      >
                        Decline
                      </button>
                      <button
                        type="button"
                        className="rounded-full border border-[var(--eg-border)] px-2.5 py-1 text-xs font-medium hover:bg-[var(--eg-bg)] disabled:opacity-40 sm:px-3"
                        onClick={() => onReview(q.id, "pending")}
                        disabled={st === "pending"}
                      >
                        Reset
                      </button>
                    </div>
                  )}
                </div>
                <p className="mt-1 text-xs text-[var(--eg-muted)]">{q.section}</p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{q.prompt}</p>
                {q.rubric && (
                  <p className="mt-2 text-xs text-[var(--eg-muted)]">Rubric: {q.rubric}</p>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      {!locked && (
        <section className="eg-card space-y-3">
          <SectionHeading
            title="Partial regen"
            info={
              <p>
                Only declined questions are replaced; others stay byte-for-byte. Optional note is
                woven into the simulated rewrite. Cost {CREDITS.regenerateQuestions} credits (0 with
                BYOK).
              </p>
            }
          />
          <textarea
            id="regen"
            className="eg-input min-h-[64px] resize-y"
            value={regenNote}
            onChange={(e) => setRegenNote(e.target.value)}
            placeholder="Optional note for the rewrite…"
            disabled={declinedCount === 0}
          />
          {regenMsg && (
            <p className="rounded-lg border border-[var(--eg-border)] bg-[var(--eg-bg)] px-3 py-2 text-sm">
              {regenMsg}
            </p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <p className="text-xs text-[var(--eg-muted)]">
              {byok ? "BYOK · 0 cr" : `${CREDITS.regenerateQuestions} cr · ${!hydrated ? "…" : credits}`}
            </p>
            <button
              type="button"
              className="eg-btn w-full text-sm sm:w-auto"
              onClick={onRegenerate}
              disabled={declinedCount === 0 || !canAffordRegen}
            >
              Regenerate declined
            </button>
          </div>
        </section>
      )}

      <section className="eg-card space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <SectionHeading
            title="Answer inquiry"
            info={
              <p>
                Demo template answer only. Production would stream a model grounded in your uploads
                and spend {CREDITS.answerInquiry} credits per run unless BYOK.
              </p>
            }
          />
          <span className="text-xs text-[var(--eg-muted)]">
            {byok ? "BYOK" : `${CREDITS.answerInquiry} cr`}
          </span>
        </div>
        {inqError && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100">
            {inqError}
          </p>
        )}
        <button type="button" className="eg-btn w-full text-sm sm:w-auto" onClick={runInquiry}>
          Explain approach
        </button>
        {inquiry && (
          <div className="rounded-xl border border-[var(--eg-border)] bg-[var(--eg-bg)] p-3 text-sm leading-relaxed">
            {inquiry}
          </div>
        )}
      </section>

      <section className="eg-card space-y-2">
        <SectionHeading
          title="Marking scheme"
          info={<p>Rubric text regenerated whenever questions change.</p>}
        />
        <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-xl bg-[var(--eg-bg)] p-3 font-mono text-xs leading-relaxed sm:max-h-80">
          {paper.markingScheme}
        </pre>
      </section>
    </div>
  );
}
