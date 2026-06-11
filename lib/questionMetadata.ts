import type { ExtractedQuestion } from "@/lib/types";

export const TARGET_ORIGINAL_PAPER_MARKS = 100;

export function marksForPrompt(prompt: string, fallback = 10): number {
  const explicit = prompt.match(/\((\d{1,3})\s*(?:points?|marks?)\)/i);
  if (explicit) return Number(explicit[1]);
  return fallback;
}

export function defaultMarksForQuestionType(type: string | undefined): number {
  switch (type) {
    case "multiple_choice":
    case "fill_blank":
      return 4;
    case "coding":
    case "long_answer":
      return 20;
    case "short_answer":
      return 10;
    default:
      return 10;
  }
}

export function marksForExtractedQuestion(question: Pick<ExtractedQuestion, "marks" | "prompt" | "type">): number {
  if (typeof question.marks === "number" && Number.isFinite(question.marks) && question.marks > 0) {
    return Math.trunc(question.marks);
  }
  return marksForPrompt(question.prompt, defaultMarksForQuestionType(question.type));
}

export function inferSemesterFromMonth(month: number | null | undefined): string {
  if (month === 12) return "Semester 1";
  if (month === 5) return "Semester 2";
  if (month === 8) return "Summer";
  return "Unknown";
}

export function inferAcademicYear(year: number | null | undefined, month: number | null | undefined): string {
  if (!year || !month) return "";
  const startYear = month >= 9 ? year : year - 1;
  return `${startYear}-${startYear + 1}`;
}

export function inferPaperDate(examYearMonth: string): string | null {
  const match = examYearMonth.match(/^(20\d{2})-(\d{2})$/);
  if (!match) return null;
  const month = Number.parseInt(match[2], 10);
  if (month < 1 || month > 12) return null;
  return `${match[1]}-${match[2]}-01`;
}

export function inferSourceKind(pdfPath: string): "exambase" | "user_upload" | "unknown" {
  if (pdfPath.startsWith("downloads/")) return "exambase";
  if (pdfPath.startsWith("review-uploads/")) return "user_upload";
  return "unknown";
}
