"use client";

import { useState } from "react";
import { InfoAside, PageHeading } from "@/components/InfoAside";
import { useExamGPT } from "@/components/providers/ExamGPTProvider";
import { CREDITS } from "@/lib/constants";

export default function ContributePage() {
  const { contributeQuestion, contributePastExam, credits, hydrated } = useExamGPT();
  const [courseCode, setCourseCode] = useState("COMP3278");
  const [text, setText] = useState("");
  const [solutionSketch, setSolutionSketch] = useState("");
  const [contributorNote, setContributorNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [paperCourseCode, setPaperCourseCode] = useState("COMP3278");
  const [academicYear, setAcademicYear] = useState("2025/26");
  const [semester, setSemester] = useState("Semester 1");
  const [examType, setExamType] = useState("Final");
  const [paperFiles, setPaperFiles] = useState<File[]>([]);
  const [paperNote, setPaperNote] = useState("");
  const [paperError, setPaperError] = useState<string | null>(null);
  const [paperDone, setPaperDone] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(null);
    const result = contributeQuestion({
      courseCode,
      text,
      solutionSketch,
      contributorNote,
    });
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    setDone(`Bank · +${CREDITS.questionContribution} cr`);
    setText("");
    setSolutionSketch("");
    setContributorNote("");
  }

  function onPaperSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPaperError(null);
    setPaperDone(null);
    const result = contributePastExam({
      courseCode: paperCourseCode,
      academicYear,
      semester,
      examType,
      files: paperFiles,
      contributorNote: paperNote,
    });
    if (!result.ok) {
      setPaperError(result.reason);
      return;
    }
    setPaperDone(`Paper archive · +${CREDITS.pastPaperContribution} cr`);
    setPaperFiles([]);
    setPaperNote("");
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-3 sm:space-y-6 sm:px-4">
      <PageHeading
        title="Contribute"
        info={
          <>
            <p>Add a real-exam question you remember. Production would run moderation and integrity checks.</p>
            <p>This MVP credits you immediately after a minimum-length check.</p>
          </>
        }
      />

      <form onSubmit={onPaperSubmit} className="eg-card space-y-4 sm:space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Upload past paper</h2>
          <InfoAside ariaLabel="About paper uploads">
            <p>
              This MVP stores file metadata and exam labels locally. Production would upload files
              to object storage, OCR them, and create embeddings for retrieval.
            </p>
          </InfoAside>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--eg-muted)]" htmlFor="paper-course">
              Course
            </label>
            <input
              id="paper-course"
              className="eg-input font-mono uppercase"
              value={paperCourseCode}
              onChange={(e) => setPaperCourseCode(e.target.value)}
              placeholder="COMP3278"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--eg-muted)]" htmlFor="year">
              Academic year
            </label>
            <select
              id="year"
              className="eg-input"
              value={academicYear}
              onChange={(e) => setAcademicYear(e.target.value)}
            >
              {["2025/26", "2024/25", "2023/24", "2022/23", "2021/22", "2020/21"].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--eg-muted)]" htmlFor="semester">
              Semester
            </label>
            <select
              id="semester"
              className="eg-input"
              value={semester}
              onChange={(e) => setSemester(e.target.value)}
            >
              {["Semester 1", "Semester 2", "Summer", "Full year", "Unknown"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--eg-muted)]" htmlFor="exam-type">
              Exam type
            </label>
            <select
              id="exam-type"
              className="eg-input"
              value={examType}
              onChange={(e) => setExamType(e.target.value)}
            >
              {["Midterm", "Final", "Quiz", "Test", "Mock", "Other"].map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-[var(--eg-muted)]" htmlFor="paper-files">
            Files
          </label>
          <input
            id="paper-files"
            type="file"
            multiple
            accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.txt,application/pdf,image/*"
            className="block w-full text-sm text-[var(--eg-muted)] file:mr-3 file:rounded-full file:border-0 file:bg-[var(--eg-accent)] file:px-3 file:py-2 file:text-xs file:font-semibold file:text-[var(--eg-on-accent)] sm:file:px-4 sm:file:text-sm"
            onChange={(e) => setPaperFiles(Array.from(e.target.files ?? []))}
            required
          />
          {paperFiles.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-[var(--eg-muted)]">
              {paperFiles.map((file) => (
                <li key={`${file.name}-${file.lastModified}`}>
                  {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-[var(--eg-muted)]" htmlFor="paper-note">
            Context (optional)
          </label>
          <textarea
            id="paper-note"
            className="eg-input min-h-[60px] resize-y"
            value={paperNote}
            onChange={(e) => setPaperNote(e.target.value)}
            placeholder="Source, coverage, missing pages, or grading context..."
          />
        </div>

        {paperError && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
            {paperError}
          </p>
        )}
        {paperDone && (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
            {paperDone}
          </p>
        )}

        <div className="flex flex-col gap-3 border-t border-[var(--eg-border)] pt-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <p className="text-sm text-[var(--eg-muted)]">
            +{CREDITS.pastPaperContribution} cr · {!hydrated ? "…" : credits}
          </p>
          <button type="submit" className="eg-btn w-full sm:w-auto">
            Upload paper
          </button>
        </div>
      </form>

      <form onSubmit={onSubmit} className="eg-card space-y-4 sm:space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Reconstruct one question</h2>
          <InfoAside ariaLabel="About question contributions">
            <p>Use this when you only remember a question, not the full paper file.</p>
          </InfoAside>
        </div>

        <div>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <label className="text-sm font-medium text-[var(--eg-muted)]" htmlFor="cc">
              Course
            </label>
          </div>
          <input
            id="cc"
            className="eg-input font-mono uppercase"
            value={courseCode}
            onChange={(e) => setCourseCode(e.target.value)}
            placeholder="COMP3278"
            required
          />
        </div>

        <div>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <label className="text-sm font-medium text-[var(--eg-muted)]" htmlFor="q">
              Question
            </label>
          </div>
          <textarea
            id="q"
            className="eg-input min-h-[100px] resize-y sm:min-h-[120px]"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Describe the exam question you remember..."
            required
          />
        </div>

        <div>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <label className="text-sm font-medium text-[var(--eg-muted)]" htmlFor="sol">
              Solution / marks
            </label>
            <InfoAside ariaLabel="About solution field">
              <p>Optional sketch of a solution or how you think marks were split.</p>
            </InfoAside>
          </div>
          <textarea
            id="sol"
            className="eg-input min-h-[60px] resize-y sm:min-h-[80px]"
            value={solutionSketch}
            onChange={(e) => setSolutionSketch(e.target.value)}
            placeholder="Optional solution or marking scheme..."
          />
        </div>

        <div>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <label className="text-sm font-medium text-[var(--eg-muted)]" htmlFor="note">
              Context (optional)
            </label>
          </div>
          <textarea
            id="note"
            className="eg-input min-h-[60px] resize-y"
            value={contributorNote}
            onChange={(e) => setContributorNote(e.target.value)}
            placeholder="Any additional context about this question..."
          />
        </div>

        {error && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
            {error}
          </p>
        )}
        {done && (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
            {done}
          </p>
        )}

        <div className="flex flex-col gap-3 border-t border-[var(--eg-border)] pt-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <p className="text-sm text-[var(--eg-muted)]">
            +{CREDITS.questionContribution} cr · {!hydrated ? "…" : credits}
          </p>
          <button type="submit" className="eg-btn w-full sm:w-auto">
            Submit
          </button>
        </div>
      </form>
    </div>
  );
}
