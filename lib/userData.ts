import type { FeedbackEntry, MockExam } from "@/lib/types";

export type UserDataPayload = {
  mockExams: MockExam[];
  feedbackEntries: FeedbackEntry[];
};

export async function fetchUserData(): Promise<UserDataPayload | null> {
  const response = await fetch("/api/user-data", {
    method: "GET",
    credentials: "same-origin",
  });
  if (!response.ok) return null;

  const payload = (await response.json()) as {
    ok?: boolean;
    mockExams?: MockExam[];
    feedbackEntries?: FeedbackEntry[];
  };
  if (!payload.ok) return null;
  return {
    mockExams: Array.isArray(payload.mockExams) ? payload.mockExams : [],
    feedbackEntries: Array.isArray(payload.feedbackEntries) ? payload.feedbackEntries : [],
  };
}

export async function saveUserData(payload: UserDataPayload) {
  const response = await fetch("/api/user-data", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(payload),
  });
  return response.ok;
}
