"use client";

import { useMemo, useState } from "react";
import { InfoAside, PageHeading } from "@/components/InfoAside";
import { useExamGPT } from "@/components/providers/ExamGPTProvider";
import { CREDITS, HKU_COURSE_PLACEHOLDERS } from "@/lib/constants";
import {
  getMatchingCourseSummaries,
  getMatchingExtractedQuestions,
  normalizeCourseCode,
} from "@/lib/questionBank";

export default function GeneratePage() {
  const { generateMockExam, extractedQuestions, credits, byok, hydrated } = useExamGPT();
  const [courseCode, setCourseCode] = useState("COMP3278");
  const [selectedCourseCode, setSelectedCourseCode] = useState("");
  const [focusHints, setFocusHints] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canAfford = byok || credits >= Math.abs(CREDITS.generateMock);

  const fileNames = useMemo(() => files.map((f) => f.name), [files]);
  const normalizedCourseInput = normalizeCourseCode(courseCode);
  const matchingCourses = useMemo(
    () => getMatchingCourseSummaries(extractedQuestions, normalizedCourseInput),
    [extractedQuestions, normalizedCourseInput],
  );
  const exactCourse = matchingCourses.find(
    (course) => normalizeCourseCode(course.courseCode) === normalizedCourseInput,
  );
  const resolvedCourseCode =
    exactCourse?.courseCode ??
    (selectedCourseCode
      ? selectedCourseCode
      : matchingCourses.length === 1
        ? matchingCourses[0].courseCode
        : "");
  const selectedRealQuestions = useMemo(
    () =>
      resolvedCourseCode
        ? getMatchingExtractedQuestions(extractedQuestions, normalizedCourseInput, resolvedCourseCode)
        : [],
    [extractedQuestions, normalizedCourseInput, resolvedCourseCode],
  );
  const requiresCourseChoice =
    matchingCourses.length > 1 && !exactCourse && !selectedCourseCode;

  function onCourseChange(value: string) {
    setCourseCode(value);
    setSelectedCourseCode("");
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (requiresCourseChoice) {
      setError("Multiple imported courses match this input. Choose one course before generating.");
      return;
    }
    setBusy(true);
    window.setTimeout(() => {
      const result = generateMockExam({
        courseCode: resolvedCourseCode || normalizedCourseInput || courseCode,
        focusHints,
        fileNames,
        realQuestions: selectedRealQuestions,
      });
      setBusy(false);
      if (!result.ok) {
        setError(result.reason);
        return;
      }
      window.location.assign(`/exam/${result.exam.id}`);
    }, 400);
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-3 sm:space-y-6 sm:px-4">
      <PageHeading
        title="New mock"
        info={
          <>
            <p>
              Production: embed PDFs/notes in a vector DB (e.g. Pinecone, Milvus) and call GPT-4o
              or Claude 3.5 Sonnet with RAG.
            </p>
            <p>
              This MVP builds a template paper and pastes your focus text into every stem; it does
              not read file contents — only filenames appear on the paper.
            </p>
          </>
        }
      />

      <form onSubmit={onSubmit} className="eg-card space-y-4 sm:space-y-5">
        <div>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <label className="text-sm font-medium text-[var(--eg-muted)]" htmlFor="course">
              Course code
            </label>
            <InfoAside ariaLabel="Course code tips">
              <p>HKU-style codes, e.g. {HKU_COURSE_PLACEHOLDERS.join(", ")}.</p>
            </InfoAside>
          </div>
          <input
            id="course"
            className="eg-input font-mono uppercase"
            value={courseCode}
            onChange={(e) => onCourseChange(e.target.value)}
            placeholder="COMP3278"
            required
          />
        </div>

        {matchingCourses.length > 0 && (
          <div className="rounded-xl border border-[var(--eg-border)] bg-[var(--eg-bg)] p-3">
            <div className="mb-2 flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <p className="text-sm font-medium text-[var(--eg-fg)]">
                Found {matchingCourses.reduce((sum, course) => sum + course.count, 0)} real
                question(s) for matching imported course(s).
              </p>
              {requiresCourseChoice && (
                <span className="text-xs font-medium text-amber-700 dark:text-amber-200">
                  Choose one to continue
                </span>
              )}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {matchingCourses.map((course) => {
                const active = resolvedCourseCode === course.courseCode;
                const disabledByExact =
                  exactCourse !== undefined && exactCourse.courseCode !== course.courseCode;
                return (
                  <button
                    key={course.courseCode}
                    type="button"
                    disabled={disabledByExact}
                    className={`rounded-lg border px-3 py-2 text-left text-sm transition disabled:opacity-45 ${
                      active
                        ? "border-[var(--eg-accent)] bg-[var(--eg-surface)]"
                        : "border-[var(--eg-border)] hover:bg-[var(--eg-surface)]"
                    }`}
                    onClick={() => setSelectedCourseCode(course.courseCode)}
                  >
                    <span className="block font-mono font-semibold text-[var(--eg-accent-strong)]">
                      {course.courseCode}
                    </span>
                    <span className="block text-xs text-[var(--eg-muted)]">
                      {course.count} questions · {course.months.join(", ")}
                    </span>
                    {course.courseName && (
                      <span className="mt-1 block text-xs text-[var(--eg-fg)]">
                        {course.courseName}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <label className="text-sm font-medium text-[var(--eg-muted)]" htmlFor="files">
              Files
            </label>
            <InfoAside ariaLabel="About file uploads">
              <p>
                In this demo, files never leave your browser. Only names are shown on the generated
                paper.
              </p>
            </InfoAside>
          </div>
          <input
            id="files"
            type="file"
            multiple
            className="block w-full text-sm text-[var(--eg-muted)] file:mr-3 file:rounded-full file:border-0 file:bg-[var(--eg-accent)] file:px-3 file:py-2 file:text-xs file:font-semibold file:text-[var(--eg-on-accent)] sm:file:px-4 sm:file:text-sm"
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
        </div>

        <div>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <label className="text-sm font-medium text-[var(--eg-muted)]" htmlFor="hints">
              Focus / hints
            </label>
            <InfoAside ariaLabel="About focus text">
              <p>
                Your text is embedded verbatim in each question and the marking scheme. There is no
                live model here, so nuance is not interpreted the way a real LLM + RAG stack would.
              </p>
            </InfoAside>
          </div>
          <textarea
            id="hints"
            className="eg-input min-h-[80px] resize-y sm:min-h-[100px]"
            value={focusHints}
            onChange={(e) => setFocusHints(e.target.value)}
            placeholder="Professor focus for the final…"
          />
        </div>

        {error && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            {error}
          </p>
        )}

        <div className="flex flex-col gap-3 border-t border-[var(--eg-border)] pt-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3">
          <p className="text-sm text-[var(--eg-muted)]">
            {byok ? (
              <span>BYOK · 0 credits</span>
            ) : (
              <span>
                {Math.abs(CREDITS.generateMock)} cr · balance {!hydrated ? "…" : credits}
              </span>
            )}
          </p>
          <button type="submit" className="eg-btn w-full sm:w-auto" disabled={!canAfford || busy}>
            {busy ? "…" : "Generate"}
          </button>
        </div>
      </form>

      <p className="px-1 text-center text-xs text-[var(--eg-muted)] sm:px-0">
        <a href="/history" className="text-[var(--eg-accent-strong)] underline-offset-2 hover:underline">
          History
        </a>
      </p>
    </div>
  );
}
