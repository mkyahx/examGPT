import type { FeedbackEntry, MockExam } from "@/lib/types";

export function isExamInRepository(examId: string, feedbackEntries: FeedbackEntry[]): boolean {
  return feedbackEntries.some((f) => f.examId === examId);
}

export function normalizeMockExams(mockExams: MockExam[], feedbackEntries: FeedbackEntry[]): MockExam[] {
  return mockExams.map((e) => {
    const synced = isExamInRepository(e.id, feedbackEntries);
    const firstFb = feedbackEntries.find((f) => f.examId === e.id);
    return {
      ...e,
      inRepository: synced,
      repositorySyncedAt: firstFb?.createdAt ?? (synced ? e.repositorySyncedAt : null) ?? null,
      contentRevision: e.contentRevision ?? 0,
      questions: e.questions.map((q) => ({
        ...q,
        reviewStatus: q.reviewStatus ?? "pending",
      })),
    };
  });
}
