"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { InfoAside, PageHeading } from "@/components/InfoAside";
import { useExamGPT } from "@/components/providers/ExamGPTProvider";
import { CREDITS, HKU_COURSE_PLACEHOLDERS } from "@/lib/constants";
import {
  getMatchingCourseSummaries,
  getMatchingExtractedQuestions,
  mapSearchRowsToExtractedQuestions,
  normalizeCourseCode,
  type QuestionSearchApiRow,
} from "@/lib/questionBank";
import type { CourseGenerationProfile, ExamQuestion, ExtractedQuestion } from "@/lib/types";

type BackendStatus = "idle" | "loading" | "ready" | "error";
type GenerationMode = "original" | "ai";

type GenerationProfileFetch = {
  questions: ExtractedQuestion[];
  profile: CourseGenerationProfile;
};

async function fetchGenerationProfile(
  courseCode: string,
  signal?: AbortSignal,
): Promise<GenerationProfileFetch> {
  const response = await fetch("/api/questions/retrieve-for-generation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal,
    body: JSON.stringify({ courseCode, count: 300 }),
  });
  const payload = (await response.json()) as {
    ok?: boolean;
    reason?: string;
    profile?: CourseGenerationProfile;
    sourceQuestions?: QuestionSearchApiRow[];
  };
  if (
    !response.ok ||
    !payload.ok ||
    !payload.profile ||
    !Array.isArray(payload.sourceQuestions)
  ) {
    throw new Error(payload.reason ?? "Could not load Supabase course profile.");
  }
  return {
    profile: payload.profile,
    questions: mapSearchRowsToExtractedQuestions(payload.sourceQuestions),
  };
}

async function fetchAiPaper(input: {
  courseCode: string;
  focusHints: string;
  fileNames: string[];
}): Promise<ExamQuestion[]> {
  const response = await fetch("/api/mock/generate-ai", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = (await response.json()) as {
    ok?: boolean;
    reason?: string;
    questions?: ExamQuestion[];
  };
  if (!response.ok || !payload.ok || !Array.isArray(payload.questions)) {
    throw new Error(payload.reason ?? "Could not generate an AI paper.");
  }
  return payload.questions;
}

export default function GeneratePage() {
  const { generateMockExam, credits, byok, hydrated } = useExamGPT();
  const [generationMode, setGenerationMode] = useState<GenerationMode>("original");
  const [courseCode, setCourseCode] = useState("COMP3251");
  const [selectedCourseCode, setSelectedCourseCode] = useState("");
  const [focusHints, setFocusHints] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [backendQuestions, setBackendQuestions] = useState<ExtractedQuestion[]>([]);
  const [generationProfile, setGenerationProfile] = useState<CourseGenerationProfile | null>(null);
  const [backendStatus, setBackendStatus] = useState<BackendStatus>("idle");
  const [backendError, setBackendError] = useState<string | null>(null);

  const canAfford = byok || credits >= Math.abs(CREDITS.generateMock);

  const fileNames = useMemo(() => files.map((f) => f.name), [files]);
  const normalizedCourseInput = normalizeCourseCode(courseCode);
  const backendMatchingCourses = useMemo(
    () => getMatchingCourseSummaries(backendQuestions, normalizedCourseInput),
    [backendQuestions, normalizedCourseInput],
  );
  const matchingCourses =
    generationMode === "original"
      ? backendMatchingCourses
      : [];
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
  const selectedBackendQuestions = useMemo(
    () =>
      resolvedCourseCode
        ? getMatchingExtractedQuestions(backendQuestions, normalizedCourseInput, resolvedCourseCode)
        : [],
    [backendQuestions, normalizedCourseInput, resolvedCourseCode],
  );
  const selectedRealQuestions =
    generationMode === "original"
      ? selectedBackendQuestions
      : [];
  const selectedGenerationProfile =
    generationMode === "original" &&
    generationProfile &&
    normalizeCourseCode(generationProfile.courseCode) === normalizeCourseCode(resolvedCourseCode)
      ? generationProfile
      : null;
  const selectedQuestionSource = (() => {
    if (generationMode === "original" && selectedBackendQuestions.length > 0) {
      return "certified Exambase";
    }
    return "";
  })();
  const requiresCourseChoice =
    matchingCourses.length > 1 && !exactCourse && !selectedCourseCode;

  const loadBackendQuestions = useCallback(
    async (value: string, signal?: AbortSignal) => {
      const normalized = normalizeCourseCode(value);
      if (generationMode !== "original" || normalized.length < 4) {
        setBackendQuestions([]);
        setGenerationProfile(null);
        setBackendStatus("idle");
        setBackendError(null);
        return [];
      }

      setBackendStatus("loading");
      setBackendError(null);
      try {
        const result = await fetchGenerationProfile(normalized, signal);
        setBackendQuestions(result.questions);
        setGenerationProfile(result.profile);
        setBackendStatus("ready");
        return result.questions;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return [];
        const reason = err instanceof Error ? err.message : "Could not load backend questions.";
        setBackendQuestions([]);
        setGenerationProfile(null);
        setBackendStatus("error");
        setBackendError(reason);
        return [];
      }
    },
    [generationMode],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      void loadBackendQuestions(normalizedCourseInput, controller.signal);
    }, 250);
    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [loadBackendQuestions, normalizedCourseInput]);

  function onCourseChange(value: string) {
    setCourseCode(value);
    setSelectedCourseCode("");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (requiresCourseChoice) {
      setError("Multiple courses match this input. Choose one course before generating.");
      return;
    }
    setBusy(true);
    try {
      if (generationMode === "ai") {
        const generatedQuestions = await fetchAiPaper({
          courseCode: normalizedCourseInput || courseCode,
          focusHints,
          fileNames,
        });
        const result = generateMockExam({
          courseCode: normalizedCourseInput || courseCode,
          focusHints,
          fileNames,
          generatedQuestions,
          generationMode: "ai",
          allowTemplateFallback: false,
        });
        setBusy(false);
        if (!result.ok) {
          setError(result.reason);
          return;
        }
        window.location.assign(`/exam/${result.exam.id}`);
        return;
      }

      let realQuestions = selectedRealQuestions;
      let profile = selectedGenerationProfile;
      if (selectedBackendQuestions.length === 0 && normalizedCourseInput.length >= 4) {
        const fresh = await fetchGenerationProfile(normalizedCourseInput);
        setBackendQuestions(fresh.questions);
        setGenerationProfile(fresh.profile);
        profile = fresh.profile;
        realQuestions = resolvedCourseCode
          ? getMatchingExtractedQuestions(
              fresh.questions,
              normalizedCourseInput,
              resolvedCourseCode,
            )
          : fresh.questions;
      }
      const result = generateMockExam({
        courseCode: resolvedCourseCode || normalizedCourseInput || courseCode,
        focusHints,
        fileNames,
        realQuestions,
        generationProfile: profile ?? undefined,
        generationMode,
        allowTemplateFallback: false,
      });
      setBusy(false);
      if (!result.ok) {
        setError(result.reason);
        return;
      }
      window.location.assign(`/exam/${result.exam.id}`);
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "Could not generate that paper.");
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-3 sm:space-y-6 sm:px-4">
      <PageHeading
        title="New mock"
        info={
          <>
            <p>
              Choose original past-paper questions from the database, or ask AI to generate a fresh
              paper for this course.
            </p>
            <p>
              Original mode samples from the question bank using the course paper pattern. AI mode
              creates new questions and rubrics on demand.
            </p>
          </>
        }
      />

      <form onSubmit={onSubmit} className="eg-card space-y-4 sm:space-y-5">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-[var(--eg-muted)]">Paper type</span>
            <InfoAside ariaLabel="Paper type">
              <p>
                Original uses audited Exambase questions from Supabase. AI generates a fresh
                100-mark paper with 4 to 6 questions.
              </p>
            </InfoAside>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              {
                id: "original" as const,
                title: "原题",
                meta: "按固定试卷 pattern 从数据库抽题",
              },
              {
                id: "ai" as const,
                title: "AI",
                meta: "AI 现生成一份新试卷",
              },
            ].map((mode) => {
              const active = generationMode === mode.id;
              const disabled = mode.id === "ai";
              return (
                <button
                  key={mode.id}
                  type="button"
                  disabled={disabled}
                  className={`rounded-lg border px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    active
                      ? "border-[var(--eg-accent)] bg-[var(--eg-surface)]"
                      : "border-[var(--eg-border)] hover:bg-[var(--eg-surface)]"
                  }`}
                  onClick={() => {
                    if (disabled) return;
                    setGenerationMode(mode.id);
                    setSelectedCourseCode("");
                    setError(null);
                  }}
                >
                  <span className="block text-sm font-semibold text-[var(--eg-fg)]">
                    {mode.title}
                    {disabled && (
                      <span className="ml-2 rounded-full border border-[var(--eg-border)] px-2 py-0.5 text-[10px] font-medium uppercase text-[var(--eg-muted)]">
                        Coming soon
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs text-[var(--eg-muted)]">
                    {mode.meta}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

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
            placeholder="COMP3251"
            required
          />
        </div>

        {matchingCourses.length > 0 && (
          <div className="rounded-xl border border-[var(--eg-border)] bg-[var(--eg-bg)] p-3">
            <div className="mb-2 flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <p className="text-sm font-medium text-[var(--eg-fg)]">
                Found {matchingCourses.reduce((sum, course) => sum + course.count, 0)}{" "}
                certified original question(s) from Exambase.
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

        {(backendStatus === "loading" || backendStatus === "error" || selectedQuestionSource) && (
          <div className="rounded-xl border border-[var(--eg-border)] bg-[var(--eg-bg)] px-3 py-2 text-sm text-[var(--eg-muted)]">
            {backendStatus === "loading" && "Loading certified Exambase question bank…"}
            {backendStatus === "error" && `Supabase question bank unavailable: ${backendError}`}
            {backendStatus !== "loading" && backendStatus !== "error" && selectedQuestionSource && (
              <>
                Original mode will sample from {selectedRealQuestions.length}{" "}
                {selectedQuestionSource} question(s) using the course paper pattern.
                {selectedGenerationProfile?.analysis?.questionCountPerPaper?.average
                  ? ` Course analysis average: ${selectedGenerationProfile.analysis.questionCountPerPaper.average} questions/paper.`
                  : ""}
              </>
            )}
          </div>
        )}

        {generationMode === "ai" && (
          <div>
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <label className="text-sm font-medium text-[var(--eg-muted)]" htmlFor="files">
                Files
              </label>
              <InfoAside ariaLabel="About file uploads">
                <p>
                  AI mode currently sends filenames as lightweight context. Full PDF/text RAG can be
                  connected later.
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
        )}

        {generationMode === "ai" && (
          <div>
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <label className="text-sm font-medium text-[var(--eg-muted)]" htmlFor="hints">
                Focus / hints
              </label>
              <InfoAside ariaLabel="About focus text">
                <p>
                  AI mode uses these hints as generation instructions for the new paper.
                </p>
              </InfoAside>
            </div>
            <textarea
              id="hints"
              className="eg-input min-h-[80px] resize-y sm:min-h-[100px]"
              value={focusHints}
              onChange={(e) => setFocusHints(e.target.value)}
              placeholder="Professor focus for the final..."
            />
          </div>
        )}

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
            {busy ? "..." : generationMode === "original" ? "Generate originals" : "Generate AI paper"}
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
