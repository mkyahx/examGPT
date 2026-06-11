"use client";

import { useMemo, useState } from "react";
import { InfoAside, PageHeading } from "@/components/InfoAside";
import { useExamGPT } from "@/components/providers/ExamGPTProvider";
import { summarizeExtractedQuestions } from "@/lib/questionBank";

export default function BankPage() {
  const {
    verifiedQuestions,
    extractedQuestions,
    pastExamUploads,
    paperReviewUploads,
    importExtractedQuestionFile,
    setPaperReviewQuestionStatus,
    updatePaperReviewQuestionPrompt,
    approvePaperReviewUpload,
  } = useExamGPT();
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [reviewMessage, setReviewMessage] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [approvingUploadId, setApprovingUploadId] = useState<string | null>(null);
  const empty =
    verifiedQuestions.length === 0 &&
    pastExamUploads.length === 0 &&
    paperReviewUploads.length === 0 &&
    extractedQuestions.length === 0;

  const extractedSummaries = useMemo(
    () => summarizeExtractedQuestions(extractedQuestions),
    [extractedQuestions],
  );

  async function onImport(files: FileList | null) {
    setImportMessage(null);
    setImportError(null);
    const selected = Array.from(files ?? []);
    if (selected.length === 0) return;

    let imported = 0;
    let skipped = 0;
    for (const file of selected) {
      try {
        const payload = JSON.parse(await file.text());
        const result = await importExtractedQuestionFile(payload);
        if (!result.ok) {
          setImportError(`${file.name}: ${result.reason}`);
          continue;
        }
        imported += result.imported;
        skipped += result.skipped;
      } catch {
        setImportError(`${file.name}: could not parse JSON.`);
      }
    }

    if (imported > 0 || skipped > 0) {
      setImportMessage(`Imported ${imported} question(s); skipped ${skipped} duplicate(s).`);
    }
  }

  async function onApproveUpload(uploadId: string) {
    setReviewMessage(null);
    setReviewError(null);
    setApprovingUploadId(uploadId);
    const result = await approvePaperReviewUpload(uploadId).catch((err) => ({
      ok: false as const,
      reason: err instanceof Error ? err.message : "Could not approve review upload.",
    }));
    setApprovingUploadId(null);
    if (!result.ok) {
      setReviewError(result.reason);
      return;
    }
    setReviewMessage(`Marked ${result.approved} question(s) as good in the Supabase bank.`);
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 px-3 sm:space-y-6 sm:px-4">
      <PageHeading
        title="Verified bank"
        info={
          <p>
            Items contributed by users. A full product would track provenance, moderation, and
            embeddings for retrieval when generating new mocks.
          </p>
        }
      />

      <section className="eg-card space-y-3 p-4 sm:p-6">
        <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold">Import extracted questions</h2>
            <p className="text-sm text-[var(--eg-muted)]">
              Upload one or more <span className="font-mono">*.questions.json</span> files.
            </p>
          </div>
          <InfoAside ariaLabel="About extracted question import">
            <p>
              Imported questions are stored in this browser only and used for course-code matching
              when generating mocks.
            </p>
          </InfoAside>
        </div>
        <input
          type="file"
          accept=".json,application/json"
          multiple
          className="block w-full text-sm text-[var(--eg-muted)] file:mr-3 file:rounded-full file:border-0 file:bg-[var(--eg-accent)] file:px-3 file:py-2 file:text-xs file:font-semibold file:text-[var(--eg-on-accent)] sm:file:px-4 sm:file:text-sm"
          onChange={(event) => void onImport(event.target.files)}
        />
        {importMessage && (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
            {importMessage}
          </p>
        )}
        {importError && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            {importError}
          </p>
        )}
      </section>

      {empty ? (
        <div className="eg-card text-sm text-[var(--eg-muted)]">Empty.</div>
      ) : (
        <div className="space-y-5 sm:space-y-6">
          {paperReviewUploads.length > 0 && (
            <section className="space-y-2 sm:space-y-3">
              <h2 className="px-1 text-sm font-semibold text-[var(--eg-muted)]">Review layer</h2>
              {reviewMessage && (
                <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
                  {reviewMessage}
                </p>
              )}
              {reviewError && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                  {reviewError}
                </p>
              )}
              <ul className="space-y-3">
                {paperReviewUploads.map((upload) => {
                  const goodCount = upload.questions.filter((question) => question.status === "good").length;
                  const rejectedCount = upload.questions.filter(
                    (question) => question.status === "rejected",
                  ).length;
                  const pendingCount = upload.questions.length - goodCount - rejectedCount;
                  const locked = Boolean(upload.approvedAt);

                  return (
                    <li key={upload.id} className="eg-card space-y-4 p-4 sm:p-6">
                      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-sm font-semibold text-[var(--eg-accent-strong)]">
                              {upload.courseCode}
                            </span>
                            <span className="rounded-full border border-[var(--eg-border)] px-2 py-0.5 text-xs text-[var(--eg-muted)]">
                              {upload.examYearMonth}
                            </span>
                            <span className="rounded-full border border-[var(--eg-border)] px-2 py-0.5 text-xs text-[var(--eg-muted)]">
                              {upload.extractionStatus}
                            </span>
                            {locked && (
                              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:text-emerald-200">
                                In bank
                              </span>
                            )}
                          </div>
                          <p className="mt-1 truncate text-sm text-[var(--eg-fg)]">
                            {upload.fileName}
                          </p>
                          <p className="mt-1 text-xs text-[var(--eg-muted)]">
                            {upload.questions.length} in review · {goodCount} good · {pendingCount}{" "}
                            pending · {rejectedCount} rejected
                          </p>
                          {upload.extractionReason && (
                            <p className="mt-1 text-xs text-amber-700 dark:text-amber-200">
                              {upload.extractionReason}
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          className="eg-btn w-full text-sm sm:w-auto"
                          disabled={locked || goodCount === 0 || approvingUploadId === upload.id}
                          onClick={() => void onApproveUpload(upload.id)}
                        >
                          {approvingUploadId === upload.id
                            ? "Approving…"
                            : locked
                              ? `Good ${upload.bankInsertedCount ?? goodCount}`
                              : "Mark good in bank"}
                        </button>
                      </div>

                      {upload.questions.length === 0 ? (
                        <p className="rounded-lg border border-[var(--eg-border)] bg-[var(--eg-bg)] px-3 py-2 text-sm text-[var(--eg-muted)]">
                          No questions were extracted. Try a clearer PDF text layer or OCR first.
                        </p>
                      ) : (
                        <ol className="space-y-3">
                          {upload.questions.map((question, index) => (
                            <li
                              key={question.id}
                              className="border-t border-[var(--eg-border)] pt-3 first:border-t-0 first:pt-0"
                            >
                              <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                                <div className="min-w-0">
                                  <p className="font-mono text-xs font-semibold text-[var(--eg-accent-strong)]">
                                    Q{index + 1} · {question.type} · {question.id}
                                  </p>
                                  {question.topicTags && question.topicTags.length > 0 && (
                                    <p className="mt-1 text-xs text-[var(--eg-muted)]">
                                      {question.topicTags
                                        .map((tag) => `${tag.label} ${tag.confidence}`)
                                        .join(" · ")}
                                    </p>
                                  )}
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  {(["good", "rejected", "pending"] as const).map((status) => (
                                    <button
                                      key={status}
                                      type="button"
                                      className={`rounded-full border px-2.5 py-1 text-xs font-medium disabled:opacity-45 sm:px-3 ${
                                        question.status === status
                                          ? "border-[var(--eg-accent)] bg-[var(--eg-surface)] text-[var(--eg-accent-strong)]"
                                          : "border-[var(--eg-border)] text-[var(--eg-muted)] hover:bg-[var(--eg-bg)]"
                                      }`}
                                      disabled={locked}
                                      onClick={() =>
                                        setPaperReviewQuestionStatus(upload.id, question.id, status)
                                      }
                                    >
                                      {status}
                                    </button>
                                  ))}
                                </div>
                              </div>
                              <textarea
                                className="eg-input min-h-[120px] resize-y text-sm"
                                value={question.editedPrompt ?? question.prompt}
                                disabled={locked}
                                onChange={(event) =>
                                  updatePaperReviewQuestionPrompt(
                                    upload.id,
                                    question.id,
                                    event.target.value,
                                  )
                                }
                              />
                            </li>
                          ))}
                        </ol>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {extractedSummaries.length > 0 && (
            <section className="space-y-2 sm:space-y-3">
              <h2 className="px-1 text-sm font-semibold text-[var(--eg-muted)]">
                Imported real questions
              </h2>
              <ul className="space-y-2 sm:space-y-3">
                {extractedSummaries.map((summary) => (
                  <li key={summary.courseCode} className="eg-card space-y-2 p-4 sm:p-6">
                    <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-baseline sm:justify-between sm:gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-semibold text-[var(--eg-accent-strong)]">
                          {summary.courseCode}
                        </span>
                        <span className="rounded-full border border-[var(--eg-border)] px-2 py-0.5 text-xs text-[var(--eg-muted)]">
                          {summary.count} questions
                        </span>
                      </div>
                      <span className="text-xs text-[var(--eg-muted)]">
                        {summary.months.join(", ")}
                      </span>
                    </div>
                    {summary.courseName && (
                      <p className="text-sm text-[var(--eg-fg)]">{summary.courseName}</p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {pastExamUploads.length > 0 && (
            <section className="space-y-2 sm:space-y-3">
              <h2 className="px-1 text-sm font-semibold text-[var(--eg-muted)]">Past papers</h2>
              <ul className="space-y-2 sm:space-y-3">
                {pastExamUploads.map((paper) => (
                  <li key={paper.id} className="eg-card space-y-3 p-4 sm:p-6">
                    <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-baseline sm:justify-between sm:gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-semibold text-[var(--eg-accent-strong)]">
                          {paper.courseCode}
                        </span>
                        <span className="rounded-full border border-[var(--eg-border)] px-2 py-0.5 text-xs text-[var(--eg-muted)]">
                          {paper.examType}
                        </span>
                      </div>
                      <span className="text-xs text-[var(--eg-muted)]">
                        {new Date(paper.uploadedAt).toLocaleDateString()} · +{paper.creditsAwarded} cr
                      </span>
                    </div>
                    <p className="text-sm text-[var(--eg-fg)]">
                      {paper.academicYear} · {paper.semester}
                    </p>
                    <div className="rounded-lg border border-[var(--eg-border)] bg-[var(--eg-bg)] p-2 sm:p-3">
                      <div className="mb-1 flex items-center gap-2">
                        <span className="text-xs font-medium text-[var(--eg-muted)]">Files</span>
                        <InfoAside ariaLabel="About uploaded files">
                          <p>Stored locally as file metadata in this MVP; production would retain the original object.</p>
                        </InfoAside>
                      </div>
                      <ul className="space-y-1 text-sm">
                        {paper.files.map((file) => (
                          <li key={file.id}>
                            {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
                          </li>
                        ))}
                      </ul>
                    </div>
                    {paper.contributorNote && (
                      <p className="text-xs text-[var(--eg-muted)]">{paper.contributorNote}</p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {verifiedQuestions.length > 0 && (
            <section className="space-y-2 sm:space-y-3">
              <h2 className="px-1 text-sm font-semibold text-[var(--eg-muted)]">Reconstructed questions</h2>
              <ul className="space-y-2 sm:space-y-3">
                {verifiedQuestions.map((q) => (
                  <li key={q.id} className="eg-card space-y-2 p-4 sm:space-y-3 sm:p-6">
                    <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-baseline sm:justify-between sm:gap-2">
                      <span className="font-mono text-sm font-semibold text-[var(--eg-accent-strong)]">
                        {q.courseCode}
                      </span>
                      <span className="text-xs text-[var(--eg-muted)]">
                        {new Date(q.verifiedAt).toLocaleDateString()} · +{q.creditsAwarded} cr
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{q.text}</p>
                    {q.solutionSketch && (
                      <div className="rounded-lg border border-[var(--eg-border)] bg-[var(--eg-bg)] p-2 sm:p-3">
                        <div className="mb-1 flex items-center gap-2">
                          <span className="text-xs font-medium text-[var(--eg-muted)]">Solution</span>
                          <InfoAside ariaLabel="About solution sketch">
                            <p>Contributor-supplied; not independently verified in this MVP.</p>
                          </InfoAside>
                        </div>
                        <p className="whitespace-pre-wrap text-sm leading-relaxed">{q.solutionSketch}</p>
                      </div>
                    )}
                    {q.contributorNote && (
                      <p className="text-xs text-[var(--eg-muted)]">{q.contributorNote}</p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
