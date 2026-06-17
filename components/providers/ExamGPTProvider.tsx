"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { CREDITS, STORAGE_KEY, TAG_CONFIDENCE_THRESHOLD } from "@/lib/constants";
import { normalizeMockExams } from "@/lib/examStatus";
import { marksForExtractedQuestion, TARGET_ORIGINAL_PAPER_MARKS } from "@/lib/questionMetadata";
import {
  normalizeCourseCodeForTags,
  tagQuestionsWithFallback,
  type TaggedQuestionResult,
} from "@/lib/internalTagging";
import {
  applyDeclinedQuestionRegeneration,
  buildMockExam,
  replaceOriginalDeclinedQuestions,
} from "@/lib/mockExam";
import type {
  AppSnapshot,
  CourseSyllabusCache,
  CourseGenerationProfile,
  CreditLedgerItem,
  FeedbackEntry,
  ExtractedQuestion,
  MockExam,
  PaperReviewUpload,
  PastExamUpload,
  QuestionBankStatus,
  QuestionReviewStatus,
  VerifiedQuestion,
} from "@/lib/types";

const BYOK_KEY_STORAGE = "examgpt-hku-byok-key";

type FullState = AppSnapshot;

function newLedgerItem(delta: number, reason: string): CreditLedgerItem {
  return {
    id: `ledger-${Math.random().toString(36).slice(2, 10)}`,
    at: new Date().toISOString(),
    delta,
    reason,
  };
}

function parseExtractedQuestionsPayload(payload: unknown):
  | { ok: true; questions: ExtractedQuestion[] }
  | { ok: false; reason: string } {
  if (!payload || typeof payload !== "object") {
    return { ok: false, reason: "Invalid JSON file." };
  }

  const record = payload as {
    status?: unknown;
    questions?: unknown;
  };
  if (record.status !== "ok") {
    return { ok: false, reason: "Only extracted JSON files with status = ok can be imported." };
  }
  if (!Array.isArray(record.questions)) {
    return { ok: false, reason: "Extracted JSON does not contain a questions array." };
  }

  const questions: ExtractedQuestion[] = [];
  for (const raw of record.questions) {
    if (!raw || typeof raw !== "object") continue;
    const q = raw as Partial<ExtractedQuestion>;
    if (
      typeof q.id !== "string" ||
      typeof q.questionNo !== "string" ||
      typeof q.prompt !== "string" ||
      !q.source ||
      typeof q.source.courseCode !== "string" ||
      typeof q.source.examYearMonth !== "string"
    ) {
      continue;
    }

    questions.push({
      id: q.id,
      source: {
        pdfPath: String(q.source.pdfPath ?? ""),
        courseCode: q.source.courseCode.trim().toUpperCase(),
        courseName: String(q.source.courseName ?? ""),
        examYearMonth: q.source.examYearMonth,
      },
      type: q.type ?? "unknown",
      questionNo: q.questionNo,
      prompt: q.prompt,
      marks: marksForExtractedQuestion({
        marks: q.marks,
        prompt: q.prompt,
        type: q.type ?? "unknown",
      }),
      questionTypeTag: q.questionTypeTag,
      topicTags: q.topicTags,
      taggingStatus: q.taggingStatus ?? "untagged",
      taggedAt: q.taggedAt,
      tagSource: q.tagSource,
      taggingError: q.taggingError,
    });
  }

  if (questions.length === 0) {
    return { ok: false, reason: "No valid questions were found in that file." };
  }

  return { ok: true, questions };
}

const defaultState: FullState = {
  credits: CREDITS.initial,
  byok: false,
  hasStoredKey: false,
  mockExams: [],
  verifiedQuestions: [],
  extractedQuestions: [],
  courseSyllabi: [],
  pastExamUploads: [],
  paperReviewUploads: [],
  feedbackEntries: [],
  ledger: [],
  professorStyleNotes: [
    "Baseline: HKU STEM finals favour multi-part questions with explicit marking rubrics.",
  ],
};

type ExamGPTContextValue = {
  hydrated: boolean;
  credits: number;
  byok: boolean;
  hasStoredKey: boolean;
  mockExams: MockExam[];
  verifiedQuestions: VerifiedQuestion[];
  extractedQuestions: ExtractedQuestion[];
  courseSyllabi: CourseSyllabusCache[];
  pastExamUploads: PastExamUpload[];
  paperReviewUploads: PaperReviewUpload[];
  feedbackEntries: FeedbackEntry[];
  ledger: CreditLedgerItem[];
  professorStyleNotes: string[];
  setByok: (value: boolean) => void;
  saveByokKey: (key: string) => void;
  clearByokKey: () => void;
  topUpDemo: (amount: number) => void;
  generateMockExam: (input: {
    courseCode: string;
    focusHints: string;
    fileNames: string[];
    realQuestions?: ExtractedQuestion[];
    generatedQuestions?: MockExam["questions"];
    generationProfile?: CourseGenerationProfile;
    generationMode?: "original" | "ai" | "simulated";
    allowTemplateFallback?: boolean;
  }) => { ok: true; exam: MockExam } | { ok: false; reason: string };
  importExtractedQuestionFile: (payload: unknown) => Promise<
    | { ok: true; imported: number; skipped: number }
    | { ok: false; reason: string }
  >;
  submitFeedback: (input: {
    examId: string;
    similarity: number;
    difficulty: number;
    notes: string;
  }) => { ok: true } | { ok: false; reason: string };
  updateFeedback: (input: {
    examId: string;
    similarity: number;
    difficulty: number;
    notes: string;
  }) => { ok: true } | { ok: false; reason: string };
  contributeQuestion: (input: {
    courseCode: string;
    text: string;
    solutionSketch: string;
    contributorNote: string;
  }) => { ok: true } | { ok: false; reason: string };
  contributePastExam: (input: {
    courseCode: string;
    academicYear: string;
    semester: string;
    examType: string;
    files: File[];
    contributorNote: string;
  }) => { ok: true } | { ok: false; reason: string };
  uploadPastExamForReview: (input: {
    courseCode: string;
    academicYear: string;
    semester: string;
    examType: string;
    files: File[];
    contributorNote: string;
  }) => Promise<
    | { ok: true; uploads: PaperReviewUpload[]; questions: number }
    | { ok: false; reason: string }
  >;
  setPaperReviewQuestionStatus: (
    uploadId: string,
    questionId: string,
    status: QuestionBankStatus,
  ) => { ok: true } | { ok: false; reason: string };
  updatePaperReviewQuestionPrompt: (
    uploadId: string,
    questionId: string,
    prompt: string,
  ) => { ok: true } | { ok: false; reason: string };
  approvePaperReviewUpload: (
    uploadId: string,
  ) => Promise<{ ok: true; approved: number } | { ok: false; reason: string }>;
  spendInquiry: () => { ok: true } | { ok: false; reason: string };
  setQuestionReview: (
    examId: string,
    questionId: string,
    status: QuestionReviewStatus,
  ) => { ok: true } | { ok: false; reason: string };
  regenerateDeclinedQuestions: (
    examId: string,
    instruction?: string,
  ) => { ok: true } | { ok: false; reason: string };
};

const ExamGPTContext = createContext<ExamGPTContextValue | null>(null);

async function resolveCourseSyllabus(
  courseCode: string,
  courseName: string,
): Promise<CourseSyllabusCache> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch("/api/syllabus", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ courseCode, courseName }),
      signal: controller.signal,
    });
    if (response.ok) {
      const payload = (await response.json()) as {
        ok?: boolean;
        syllabus?: CourseSyllabusCache;
      };
      if (payload.ok && payload.syllabus) return payload.syllabus;
    }
  } catch {
    // Local fallback below keeps imports usable when the route or network is unavailable.
  } finally {
    window.clearTimeout(timeoutId);
  }
  return {
    courseCode,
    courseName,
    status: "missing",
    topics: [],
    extractedAt: new Date().toISOString(),
    error: "Syllabus lookup unavailable.",
  };
}

async function resolveQuestionTags(
  questions: ExtractedQuestion[],
  syllabus: CourseSyllabusCache | undefined,
): Promise<TaggedQuestionResult[]> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch("/api/question-tags", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        questions,
        syllabus,
        threshold: TAG_CONFIDENCE_THRESHOLD,
      }),
      signal: controller.signal,
    });
    if (response.ok) {
      const payload = (await response.json()) as {
        ok?: boolean;
        taggedQuestions?: TaggedQuestionResult[];
      };
      if (payload.ok && Array.isArray(payload.taggedQuestions)) {
        return payload.taggedQuestions;
      }
    }
  } catch {
    // Local fallback below keeps imports usable when the route is unavailable.
  } finally {
    window.clearTimeout(timeoutId);
  }
  return tagQuestionsWithFallback(questions, syllabus, TAG_CONFIDENCE_THRESHOLD);
}

export function ExamGPTProvider({ children }: { children: React.ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [state, setState] = useState<FullState>(defaultState);

  useEffect(() => {
    queueMicrotask(() => {
      let merged: FullState = defaultState;
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as FullState;
          merged = {
            ...defaultState,
            ...parsed,
            ledger: parsed.ledger ?? [],
            extractedQuestions: parsed.extractedQuestions ?? [],
            courseSyllabi: parsed.courseSyllabi ?? [],
            pastExamUploads: parsed.pastExamUploads ?? [],
            paperReviewUploads: parsed.paperReviewUploads ?? [],
          };
          merged = {
            ...merged,
            mockExams: normalizeMockExams(merged.mockExams ?? [], merged.feedbackEntries ?? []),
          };
        }
      } catch {
        merged = defaultState;
      }
      setState({
        ...merged,
        hasStoredKey: Boolean(localStorage.getItem(BYOK_KEY_STORAGE)),
      });
      setHydrated(true);
    });
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const { hasStoredKey, ...persistable } = state;
    void hasStoredKey;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persistable));
  }, [state, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;

    void fetch("/api/review-uploads")
      .then(async (response) => {
        const payload = (await response.json()) as {
          ok?: boolean;
          uploads?: PaperReviewUpload[];
        };
        if (!response.ok || !payload.ok || !Array.isArray(payload.uploads) || cancelled) return;
        const uploads = payload.uploads;
        setState((s) => {
          const localApproved = s.paperReviewUploads.filter((upload) => upload.approvedAt);
          const seen = new Set(uploads.map((upload) => upload.id));
          return {
            ...s,
            paperReviewUploads: [
              ...uploads,
              ...localApproved.filter((upload) => !seen.has(upload.id)),
            ],
          };
        });
      })
      .catch(() => {
        // Review uploads are DB-backed; if the DB is unavailable, keep the local snapshot visible.
      });

    return () => {
      cancelled = true;
    };
  }, [hydrated]);

  const setByok = useCallback((value: boolean) => {
    setState((s) => ({ ...s, byok: value }));
  }, []);

  const saveByokKey = useCallback((key: string) => {
    const trimmed = key.trim();
    if (trimmed) {
      localStorage.setItem(BYOK_KEY_STORAGE, trimmed);
      setState((s) => ({ ...s, hasStoredKey: true }));
    }
  }, []);

  const clearByokKey = useCallback(() => {
    localStorage.removeItem(BYOK_KEY_STORAGE);
    setState((s) => ({ ...s, hasStoredKey: false }));
  }, []);

  const topUpDemo = useCallback((amount: number) => {
    if (amount <= 0) return;
    setState((s) => ({
      ...s,
      credits: s.credits + amount,
      ledger: [newLedgerItem(amount, "Demo top-up (Stripe / PayMe in production)"), ...s.ledger],
    }));
  }, []);

  const generateMockExam = useCallback(
    (input: {
      courseCode: string;
      focusHints: string;
      fileNames: string[];
      realQuestions?: ExtractedQuestion[];
      generatedQuestions?: MockExam["questions"];
      generationProfile?: CourseGenerationProfile;
      generationMode?: "original" | "ai" | "simulated";
      allowTemplateFallback?: boolean;
    }) => {
      const cost = state.byok ? 0 : CREDITS.generateMock;
      if (!state.byok && state.credits + cost < 0) {
        return { ok: false as const, reason: "Not enough credits. Enable BYOK or top up." };
      }
      if (input.generationMode === "original" && (input.realQuestions?.length ?? 0) === 0) {
        return {
          ok: false as const,
          reason: "No certified Exambase original questions are available for this course yet.",
        };
      }
      if (input.generationMode === "original" && !input.generationProfile?.analysis) {
        return {
          ok: false as const,
          reason: "No Supabase course analysis is available for this course yet.",
        };
      }
      if (input.generationMode === "ai" && (input.generatedQuestions?.length ?? 0) === 0) {
        return {
          ok: false as const,
          reason: "AI did not return a usable paper. Try again with more course focus.",
        };
      }
      const exam = buildMockExam(input);
      if (input.generationMode === "original") {
        const totalMarks = exam.questions.reduce((sum, question) => sum + question.marks, 0);
        if (exam.questions.length === 0 || totalMarks !== TARGET_ORIGINAL_PAPER_MARKS) {
          return {
            ok: false as const,
            reason:
              "No exact 100-mark original-paper combination is available for this course. Add or approve more marked questions first.",
          };
        }
      }
      setState((s) => {
        const nextCredits = s.byok ? s.credits : s.credits + cost;
        const extractedSeen = new Set(s.extractedQuestions.map((question) => question.id));
        const nextExtractedQuestions = [...s.extractedQuestions];
        for (const question of input.realQuestions ?? []) {
          if (extractedSeen.has(question.id)) continue;
          extractedSeen.add(question.id);
          nextExtractedQuestions.push(question);
        }
        const ledger =
          cost === 0
            ? s.ledger
            : [
                newLedgerItem(
                  cost,
                  input.generationMode === "original"
                    ? "Generate original-question mock"
                    : "Generate AI mock exam",
                ),
                ...s.ledger,
              ];
        return {
          ...s,
          credits: nextCredits,
          extractedQuestions: nextExtractedQuestions,
          mockExams: [exam, ...s.mockExams],
          ledger,
        };
      });
      return { ok: true as const, exam };
    },
    [state.byok, state.credits],
  );

  const importExtractedQuestionFile = useCallback(async (payload: unknown) => {
    const validation = parseExtractedQuestionsPayload(payload);
    if (!validation.ok) {
      return validation;
    }

    let imported = 0;
    let skipped = 0;
    const seen = new Set(state.extractedQuestions.map((q) => q.id));
    const pendingQuestions: ExtractedQuestion[] = [];

    for (const question of validation.questions) {
      if (seen.has(question.id)) {
        skipped += 1;
        continue;
      }
      seen.add(question.id);
      pendingQuestions.push(question);
      imported += 1;
    }

    if (pendingQuestions.length === 0) {
      return { ok: true as const, imported, skipped };
    }

    const alreadyTaggedQuestions = pendingQuestions.filter(
      (question) => question.taggingStatus && question.taggingStatus !== "untagged",
    );
    const needsTaggingQuestions = pendingQuestions.filter(
      (question) => !question.taggingStatus || question.taggingStatus === "untagged",
    );

    const syllabusByCourse = new Map(
      state.courseSyllabi.map((syllabus) => [
        normalizeCourseCodeForTags(syllabus.courseCode),
        syllabus,
      ]),
    );

    for (const question of needsTaggingQuestions) {
      const courseCode = normalizeCourseCodeForTags(question.source.courseCode);
      if (!courseCode || syllabusByCourse.has(courseCode)) continue;
      const syllabus = await resolveCourseSyllabus(courseCode, question.source.courseName);
      syllabusByCourse.set(courseCode, syllabus);
    }

    const taggedQuestions: ExtractedQuestion[] = [...alreadyTaggedQuestions];
    const questionsByCourse = new Map<string, ExtractedQuestion[]>();
    for (const question of needsTaggingQuestions) {
      const courseCode = normalizeCourseCodeForTags(question.source.courseCode);
      questionsByCourse.set(courseCode, [...(questionsByCourse.get(courseCode) ?? []), question]);
    }

    for (const [courseCode, questions] of questionsByCourse) {
      const syllabus = syllabusByCourse.get(courseCode);
      const tags = await resolveQuestionTags(questions, syllabus);
      const tagsById = new Map(tags.map((tag) => [tag.id, tag]));
      for (const question of questions) {
        taggedQuestions.push({
          ...question,
          ...(tagsById.get(question.id) ?? tagQuestionsWithFallback([question], syllabus)[0]),
        });
      }
    }

    setState((s) => {
      const currentSeen = new Set(s.extractedQuestions.map((q) => q.id));
      const nextQuestions = [...s.extractedQuestions];
      for (const question of taggedQuestions) {
        if (currentSeen.has(question.id)) continue;
        currentSeen.add(question.id);
        nextQuestions.push(question);
      }

      const nextSyllabi = new Map(
        s.courseSyllabi.map((syllabus) => [
          normalizeCourseCodeForTags(syllabus.courseCode),
          syllabus,
        ]),
      );
      for (const syllabus of syllabusByCourse.values()) {
        nextSyllabi.set(normalizeCourseCodeForTags(syllabus.courseCode), syllabus);
      }

      return {
        ...s,
        extractedQuestions: nextQuestions,
        courseSyllabi: [...nextSyllabi.values()],
      };
    });

    return { ok: true as const, imported, skipped };
  }, [state.courseSyllabi, state.extractedQuestions]);

  const submitFeedback = useCallback(
    (input: { examId: string; similarity: number; difficulty: number; notes: string }) => {
      let outcome: { ok: true } | { ok: false; reason: string } = { ok: true };
      setState((s) => {
        const exam = s.mockExams.find((e) => e.id === input.examId);
        if (!exam) {
          outcome = { ok: false, reason: "That mock paper is not in your history." };
          return s;
        }
        if (s.feedbackEntries.some((f) => f.examId === input.examId)) {
          outcome = {
            ok: false,
            reason: "Feedback was already submitted for this paper; it is in the repository.",
          };
          return s;
        }
        const entry: FeedbackEntry = {
          id: `fb-${Math.random().toString(36).slice(2, 10)}`,
          examId: input.examId,
          similarity: input.similarity,
          difficulty: input.difficulty,
          notes: input.notes.trim(),
          createdAt: new Date().toISOString(),
        };
        outcome = { ok: true };
        return {
          ...s,
          credits: s.credits + CREDITS.realExamFeedback,
          feedbackEntries: [entry, ...s.feedbackEntries],
          mockExams: s.mockExams.map((e) =>
            e.id === input.examId
              ? {
                  ...e,
                  inRepository: true,
                  repositorySyncedAt: entry.createdAt,
                }
              : e,
          ),
          ledger: [
            newLedgerItem(CREDITS.realExamFeedback, "Real exam feedback (similarity + difficulty)"),
            ...s.ledger,
          ],
          professorStyleNotes: [
            `Update from feedback: similarity ${input.similarity}/10, perceived difficulty ${input.difficulty}/10 — adjust future mocks toward observed exam tone.`,
            ...s.professorStyleNotes,
          ].slice(0, 12),
        };
      });
      return outcome;
    },
    [],
  );

  const updateFeedback = useCallback(
    (input: { examId: string; similarity: number; difficulty: number; notes: string }) => {
      let outcome: { ok: true } | { ok: false; reason: string } = { ok: true };
      setState((s) => {
        const existing = s.feedbackEntries.find((f) => f.examId === input.examId);
        if (!existing) {
          outcome = { ok: false, reason: "No feedback found for this paper." };
          return s;
        }
        const updated: FeedbackEntry = {
          ...existing,
          similarity: input.similarity,
          difficulty: input.difficulty,
          notes: input.notes.trim(),
        };
        outcome = { ok: true };
        return {
          ...s,
          feedbackEntries: s.feedbackEntries.map((f) =>
            f.examId === input.examId ? updated : f,
          ),
          professorStyleNotes: [
            `Updated feedback: similarity ${input.similarity}/10, perceived difficulty ${input.difficulty}/10 — adjust future mocks toward observed exam tone.`,
            ...s.professorStyleNotes,
          ].slice(0, 12),
        };
      });
      return outcome;
    },
    [],
  );

  const contributeQuestion = useCallback(
    (input: {
      courseCode: string;
      text: string;
      solutionSketch: string;
      contributorNote: string;
    }) => {
      const text = input.text.trim();
      if (text.length < 40) {
        return { ok: false as const, reason: "Please provide a fuller question reconstruction." };
      }
      const vq: VerifiedQuestion = {
        id: `vq-${Math.random().toString(36).slice(2, 10)}`,
        courseCode: input.courseCode.trim().toUpperCase() || "HKU",
        text,
        solutionSketch: input.solutionSketch.trim(),
        contributorNote: input.contributorNote.trim(),
        verifiedAt: new Date().toISOString(),
        creditsAwarded: CREDITS.questionContribution,
      };
      setState((s) => ({
        ...s,
        credits: s.credits + CREDITS.questionContribution,
        verifiedQuestions: [vq, ...s.verifiedQuestions],
        ledger: [
          newLedgerItem(
            CREDITS.questionContribution,
            "Verified real exam question contribution",
          ),
          ...s.ledger,
        ],
        professorStyleNotes: [
          `Bank growth: added verified item for ${vq.courseCode} — tighten style on topics implied by new item.`,
          ...s.professorStyleNotes,
        ].slice(0, 12),
      }));
      return { ok: true as const };
    },
    [],
  );

  const contributePastExam = useCallback(
    (input: {
      courseCode: string;
      academicYear: string;
      semester: string;
      examType: string;
      files: File[];
      contributorNote: string;
    }) => {
      const courseCode = input.courseCode.trim().toUpperCase();
      const academicYear = input.academicYear.trim();
      const semester = input.semester.trim();
      const examType = input.examType.trim();

      if (!courseCode) {
        return { ok: false as const, reason: "Please provide a course code." };
      }
      if (!academicYear) {
        return { ok: false as const, reason: "Please select an academic year." };
      }
      if (!semester) {
        return { ok: false as const, reason: "Please select a semester." };
      }
      if (!examType) {
        return { ok: false as const, reason: "Please select an exam type." };
      }
      if (input.files.length === 0) {
        return { ok: false as const, reason: "Please upload at least one past-paper file." };
      }

      const upload: PastExamUpload = {
        id: `paper-${Math.random().toString(36).slice(2, 10)}`,
        courseCode,
        academicYear,
        semester,
        examType,
        files: input.files.map((file) => ({
          id: `file-${Math.random().toString(36).slice(2, 10)}`,
          name: file.name,
          type: file.type || "unknown",
          size: file.size,
          lastModified: file.lastModified,
        })),
        contributorNote: input.contributorNote.trim(),
        uploadedAt: new Date().toISOString(),
        creditsAwarded: CREDITS.pastPaperContribution,
      };

      setState((s) => ({
        ...s,
        credits: s.credits + CREDITS.pastPaperContribution,
        pastExamUploads: [upload, ...s.pastExamUploads],
        ledger: [
          newLedgerItem(CREDITS.pastPaperContribution, "Past exam paper upload contribution"),
          ...s.ledger,
        ],
        professorStyleNotes: [
          `Paper archive: added ${upload.academicYear} ${upload.semester} ${upload.examType} for ${upload.courseCode} — use as provenance for future retrieval.`,
          ...s.professorStyleNotes,
        ].slice(0, 12),
      }));
      return { ok: true as const };
    },
    [],
  );

  const uploadPastExamForReview = useCallback(
    async (input: {
      courseCode: string;
      academicYear: string;
      semester: string;
      examType: string;
      files: File[];
      contributorNote: string;
    }) => {
      if (input.files.length === 0) {
        return { ok: false as const, reason: "Please upload at least one PDF file." };
      }

      const uploads: PaperReviewUpload[] = [];
      for (const file of input.files) {
        const form = new FormData();
        form.append("file", file);
        form.append("courseCode", input.courseCode);
        form.append("academicYear", input.academicYear);
        form.append("semester", input.semester);
        form.append("examType", input.examType);
        form.append("contributorNote", input.contributorNote);

        const response = await fetch("/api/review-uploads", {
          method: "POST",
          body: form,
        });
        const payload = (await response.json()) as {
          ok?: boolean;
          reason?: string;
          upload?: PaperReviewUpload;
        };
        if (!response.ok || !payload.ok || !payload.upload) {
          return {
            ok: false as const,
            reason: `${file.name}: ${payload.reason ?? "Could not extract uploaded paper."}`,
          };
        }
        uploads.push(payload.upload);
      }

      setState((s) => ({
        ...s,
        paperReviewUploads: [...uploads, ...s.paperReviewUploads],
      }));

      return {
        ok: true as const,
        uploads,
        questions: uploads.reduce((sum, upload) => sum + upload.questions.length, 0),
      };
    },
    [],
  );

  const setPaperReviewQuestionStatus = useCallback(
    (uploadId: string, questionId: string, status: QuestionBankStatus) => {
      let ok = false;
      setState((s) => ({
        ...s,
        paperReviewUploads: s.paperReviewUploads.map((upload) => {
          if (upload.id !== uploadId || upload.approvedAt) return upload;
          const hasQuestion = upload.questions.some((question) => question.id === questionId);
          if (!hasQuestion) return upload;
          ok = true;
          return {
            ...upload,
            questions: upload.questions.map((question) =>
              question.id === questionId ? { ...question, status } : question,
            ),
          };
        }),
      }));
      return ok
        ? ({ ok: true } as const)
        : ({ ok: false, reason: "Review question not found or already approved." } as const);
    },
    [],
  );

  const updatePaperReviewQuestionPrompt = useCallback(
    (uploadId: string, questionId: string, prompt: string) => {
      let ok = false;
      setState((s) => ({
        ...s,
        paperReviewUploads: s.paperReviewUploads.map((upload) => {
          if (upload.id !== uploadId || upload.approvedAt) return upload;
          const hasQuestion = upload.questions.some((question) => question.id === questionId);
          if (!hasQuestion) return upload;
          ok = true;
          return {
            ...upload,
            questions: upload.questions.map((question) =>
              question.id === questionId ? { ...question, editedPrompt: prompt } : question,
            ),
          };
        }),
      }));
      return ok
        ? ({ ok: true } as const)
        : ({ ok: false, reason: "Review question not found or already approved." } as const);
    },
    [],
  );

  const approvePaperReviewUpload = useCallback(
    async (uploadId: string) => {
      const upload = state.paperReviewUploads.find((item) => item.id === uploadId);
      if (!upload) return { ok: false as const, reason: "Review upload not found." };
      if (upload.approvedAt) {
        return { ok: false as const, reason: "This review upload is already in the bank." };
      }
      const approvedQuestions = upload.questions.filter((question) => question.status === "good");
      if (approvedQuestions.length === 0) {
        return { ok: false as const, reason: "Mark at least one question as good first." };
      }

      const response = await fetch("/api/review-uploads/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ upload }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        reason?: string;
        approvedQuestions?: number;
      };
      if (!response.ok || !payload.ok) {
        return {
          ok: false as const,
          reason: payload.reason ?? "Could not approve questions into the bank.",
        };
      }

      setState((s) => {
        const seen = new Set(s.extractedQuestions.map((question) => question.id));
        const approvedForLocal = approvedQuestions
          .map((question) => ({
            ...question,
            prompt: question.editedPrompt?.trim() || question.prompt,
          }))
          .filter((question) => {
            if (seen.has(question.id)) return false;
            seen.add(question.id);
            return true;
          });
        return {
          ...s,
          credits: s.credits + CREDITS.pastPaperContribution,
          extractedQuestions: [...s.extractedQuestions, ...approvedForLocal],
          paperReviewUploads: s.paperReviewUploads.map((item) =>
            item.id === uploadId
              ? (() => {
                  const remainingQuestions = item.questions.filter(
                    (question) => question.status !== "good",
                  );
                  return {
                    ...item,
                    questions: remainingQuestions,
                    approvedAt:
                      remainingQuestions.length === 0 ? new Date().toISOString() : item.approvedAt,
                    bankInsertedCount:
                      (item.bankInsertedCount ?? 0) +
                      (payload.approvedQuestions ?? approvedQuestions.length),
                  };
                })()
              : item,
          ),
          ledger: [
            newLedgerItem(CREDITS.pastPaperContribution, "Approved uploaded paper into bank"),
            ...s.ledger,
          ],
        };
      });

      return {
        ok: true as const,
        approved: payload.approvedQuestions ?? approvedQuestions.length,
      };
    },
    [state.paperReviewUploads],
  );

  const spendInquiry = useCallback(() => {
    if (state.byok) return { ok: true as const };
    if (state.credits < Math.abs(CREDITS.answerInquiry)) {
      return { ok: false as const, reason: "Not enough credits for an answer inquiry." };
    }
    setState((s) => ({
      ...s,
      credits: s.credits + CREDITS.answerInquiry,
      ledger: [newLedgerItem(CREDITS.answerInquiry, "Answer inquiry (step explanation)"), ...s.ledger],
    }));
    return { ok: true as const };
  }, [state.byok, state.credits]);

  const setQuestionReview = useCallback(
    (examId: string, questionId: string, status: QuestionReviewStatus) => {
      let ok = true;
      let reason = "";
      setState((s) => {
        const exam = s.mockExams.find((e) => e.id === examId);
        if (!exam) {
          ok = false;
          reason = "Exam not found.";
          return s;
        }
        const hasQ = exam.questions.some((q) => q.id === questionId);
        if (!hasQ) {
          ok = false;
          reason = "Question not found.";
          return s;
        }
        return {
          ...s,
          mockExams: s.mockExams.map((e) => {
            if (e.id !== examId) return e;
            return {
              ...e,
              questions: e.questions.map((q) =>
                q.id === questionId ? { ...q, reviewStatus: status } : q,
              ),
            };
          }),
        };
      });
      return ok ? ({ ok: true } as const) : ({ ok: false, reason } as const);
    },
    [],
  );

  const regenerateDeclinedQuestions = useCallback((examId: string, instruction?: string) => {
    let outcome: { ok: true } | { ok: false; reason: string } = { ok: true };

    setState((s) => {
      const exam = s.mockExams.find((e) => e.id === examId);
      if (!exam) {
        outcome = { ok: false, reason: "Exam not found." };
        return s;
      }
      const cost = s.byok ? 0 : CREDITS.regenerateQuestions;
      if (!s.byok && s.credits + cost < 0) {
        outcome = { ok: false, reason: "Not enough credits. Enable BYOK or top up." };
        return s;
      }
      const replacementPool = exam.sourceCandidates ?? s.extractedQuestions;
      const next =
        exam.generationMode === "original"
          ? replaceOriginalDeclinedQuestions(exam, replacementPool)
          : applyDeclinedQuestionRegeneration(exam, instruction);
      if (!next) {
        outcome = {
          ok: false,
          reason:
            exam.generationMode === "original"
              ? "No matching replacement question is available. Decline a different question or add more approved originals."
              : "Mark one or more questions as declined before regenerating.",
        };
        return s;
      }
      outcome = { ok: true };
      const ledger =
        cost === 0
          ? s.ledger
          : [
              newLedgerItem(
                cost,
                exam.generationMode === "original"
                  ? "Replace declined original questions"
                  : "Regenerate declined questions (partial mock rewrite)",
              ),
              ...s.ledger,
            ];
      const nextCredits = s.byok ? s.credits : s.credits + cost;
      return {
        ...s,
        credits: nextCredits,
        ledger,
        mockExams: s.mockExams.map((e) => (e.id === examId ? next : e)),
      };
    });

    return outcome;
  }, []);

  const value = useMemo<ExamGPTContextValue>(
    () => ({
      hydrated,
      credits: state.credits,
      byok: state.byok,
      hasStoredKey: state.hasStoredKey,
      mockExams: state.mockExams,
      verifiedQuestions: state.verifiedQuestions,
      extractedQuestions: state.extractedQuestions,
      courseSyllabi: state.courseSyllabi,
      pastExamUploads: state.pastExamUploads,
      paperReviewUploads: state.paperReviewUploads,
      feedbackEntries: state.feedbackEntries,
      ledger: state.ledger,
      professorStyleNotes: state.professorStyleNotes,
      setByok,
      saveByokKey,
      clearByokKey,
      topUpDemo,
      generateMockExam,
      importExtractedQuestionFile,
      submitFeedback,
      updateFeedback,
      contributeQuestion,
      contributePastExam,
      uploadPastExamForReview,
      setPaperReviewQuestionStatus,
      updatePaperReviewQuestionPrompt,
      approvePaperReviewUpload,
      spendInquiry,
      setQuestionReview,
      regenerateDeclinedQuestions,
    }),
    [
      hydrated,
      state,
      setByok,
      saveByokKey,
      clearByokKey,
      topUpDemo,
      generateMockExam,
      importExtractedQuestionFile,
      submitFeedback,
      updateFeedback,
      contributeQuestion,
      contributePastExam,
      uploadPastExamForReview,
      setPaperReviewQuestionStatus,
      updatePaperReviewQuestionPrompt,
      approvePaperReviewUpload,
      spendInquiry,
      setQuestionReview,
      regenerateDeclinedQuestions,
    ],
  );

  return <ExamGPTContext.Provider value={value}>{children}</ExamGPTContext.Provider>;
}

export function useExamGPT() {
  const ctx = useContext(ExamGPTContext);
  if (!ctx) throw new Error("useExamGPT must be used within ExamGPTProvider");
  return ctx;
}
