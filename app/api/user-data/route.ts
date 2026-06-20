import { getCurrentUser } from "@/lib/server/auth";
import { supabaseRest } from "@/lib/server/supabaseRest";
import type { FeedbackEntry, MockExam } from "@/lib/types";

export const runtime = "nodejs";

type MockExamRow = {
  exam_data: MockExam;
};

type FeedbackRow = {
  feedback_data: FeedbackEntry;
};

function validMockExam(value: unknown): value is MockExam {
  if (!value || typeof value !== "object") return false;
  const exam = value as Partial<MockExam>;
  return (
    typeof exam.id === "string" &&
    typeof exam.courseCode === "string" &&
    typeof exam.createdAt === "string" &&
    Array.isArray(exam.questions)
  );
}

function validFeedback(value: unknown): value is FeedbackEntry {
  if (!value || typeof value !== "object") return false;
  const feedback = value as Partial<FeedbackEntry>;
  return (
    typeof feedback.id === "string" &&
    typeof feedback.examId === "string" &&
    typeof feedback.similarity === "number" &&
    feedback.similarity >= 1 &&
    feedback.similarity <= 10 &&
    typeof feedback.difficulty === "number" &&
    feedback.difficulty >= 1 &&
    feedback.difficulty <= 10 &&
    typeof feedback.createdAt === "string"
  );
}

export async function GET(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) {
    return Response.json({ ok: false, reason: "Sign in to load account data." }, { status: 401 });
  }

  const [mockRows, feedbackRows] = await Promise.all([
    supabaseRest<MockExamRow[]>("user_mock_exams", {
      query: {
        select: "exam_data",
        user_id: `eq.${user.id}`,
        order: "updated_at.desc",
        limit: 200,
      },
    }),
    supabaseRest<FeedbackRow[]>("user_feedback_entries", {
      query: {
        select: "feedback_data",
        user_id: `eq.${user.id}`,
        order: "updated_at.desc",
        limit: 200,
      },
    }),
  ]);

  return Response.json({
    ok: true,
    mockExams: mockRows.map((row) => row.exam_data).filter(validMockExam),
    feedbackEntries: feedbackRows.map((row) => row.feedback_data).filter(validFeedback),
  });
}

export async function POST(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) {
    return Response.json({ ok: false, reason: "Sign in to save account data." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    mockExams?: unknown;
    feedbackEntries?: unknown;
  } | null;
  if (!body) {
    return Response.json({ ok: false, reason: "Invalid account data." }, { status: 400 });
  }

  const mockExams = Array.isArray(body.mockExams)
    ? body.mockExams.filter(validMockExam).slice(0, 200)
    : [];
  const feedbackEntries = Array.isArray(body.feedbackEntries)
    ? body.feedbackEntries.filter(validFeedback).slice(0, 200)
    : [];
  const now = new Date().toISOString();

  const writes: Promise<unknown>[] = [];
  if (mockExams.length > 0) {
    writes.push(
      supabaseRest("user_mock_exams", {
        method: "POST",
        query: { on_conflict: "user_id,exam_id" },
        prefer: "resolution=merge-duplicates,return=minimal",
        body: mockExams.map((exam) => ({
          user_id: user.id,
          exam_id: exam.id,
          course_code: exam.courseCode,
          generation_mode: exam.generationMode ?? null,
          exam_data: exam,
          updated_at: now,
        })),
      }),
    );
  }
  if (feedbackEntries.length > 0) {
    writes.push(
      supabaseRest("user_feedback_entries", {
        method: "POST",
        query: { on_conflict: "user_id,exam_id" },
        prefer: "resolution=merge-duplicates,return=minimal",
        body: feedbackEntries.map((feedback) => ({
          user_id: user.id,
          feedback_id: feedback.id,
          exam_id: feedback.examId,
          similarity: feedback.similarity,
          difficulty: feedback.difficulty,
          notes: feedback.notes,
          feedback_data: feedback,
          updated_at: now,
        })),
      }),
    );
  }

  await Promise.all(writes);
  return Response.json({
    ok: true,
    savedMocks: mockExams.length,
    savedFeedback: feedbackEntries.length,
  });
}
