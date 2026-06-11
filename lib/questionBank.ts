import type { ExtractedQuestion, ExtractedQuestionType, QuestionTopicTag } from "@/lib/types";
import { defaultMarksForQuestionType, marksForPrompt } from "@/lib/questionMetadata";

export type CourseQuestionSummary = {
  courseCode: string;
  courseName: string;
  count: number;
  months: string[];
};

export type QuestionSearchApiRow = {
  id: string;
  course_code: string;
  course_name: string;
  pdf_path: string;
  exam_year_month: string;
  exam_year: number | null;
  exam_month: number | null;
  question_no: string;
  prompt: string;
  prompt_preview: string;
  marks?: number | null;
  type: string;
  question_type_tag: string | null;
  curation_status: string;
  status?: string;
  topic_tags: unknown;
  rank: number;
};

const QUESTION_TYPES = new Set<ExtractedQuestionType>([
  "multiple_choice",
  "fill_blank",
  "short_answer",
  "long_answer",
  "coding",
  "unknown",
]);

export function normalizeCourseCode(value: string): string {
  return value.replace(/\s+/g, "").trim().toUpperCase();
}

function toQuestionType(value: unknown): ExtractedQuestionType {
  return typeof value === "string" && QUESTION_TYPES.has(value as ExtractedQuestionType)
    ? (value as ExtractedQuestionType)
    : "unknown";
}

function normalizeTopicTags(value: unknown): QuestionTopicTag[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((tag) => {
      if (!tag || typeof tag !== "object") return null;
      const record = tag as { topicId?: unknown; label?: unknown; confidence?: unknown };
      if (typeof record.topicId !== "string" || typeof record.label !== "string") return null;
      return {
        topicId: record.topicId,
        label: record.label,
        confidence: typeof record.confidence === "number" ? record.confidence : 0,
      };
    })
    .filter((tag): tag is QuestionTopicTag => tag !== null);
}

export function mapSearchRowsToExtractedQuestions(
  rows: QuestionSearchApiRow[],
): ExtractedQuestion[] {
  return rows.map((row) => {
    const type = toQuestionType(row.type);
    const topicTags = normalizeTopicTags(row.topic_tags);
    return {
      id: row.id,
      status: row.status === "pending" || row.status === "rejected" ? row.status : "good",
      source: {
        pdfPath: row.pdf_path,
        courseCode: normalizeCourseCode(row.course_code),
        courseName: row.course_name ?? "",
        examYearMonth: row.exam_year_month,
      },
      type,
      questionNo: row.question_no,
      prompt: row.prompt,
      marks:
        typeof row.marks === "number" && Number.isFinite(row.marks) && row.marks > 0
          ? Math.trunc(row.marks)
          : marksForPrompt(row.prompt, defaultMarksForQuestionType(type)),
      questionTypeTag: row.question_type_tag
        ? toQuestionType(row.question_type_tag)
        : type,
      topicTags,
      taggingStatus: topicTags.length > 0 ? "tagged" : "unknown",
      tagSource: topicTags.length > 0 ? "extract-fallback" : "none",
    };
  });
}

export function getMatchingExtractedQuestions(
  questions: ExtractedQuestion[],
  courseInput: string,
  selectedCourseCode?: string,
): ExtractedQuestion[] {
  const normalizedInput = normalizeCourseCode(courseInput);
  const normalizedSelected = selectedCourseCode
    ? normalizeCourseCode(selectedCourseCode)
    : "";

  if (!normalizedInput) return [];

  return questions.filter((question) => {
    const code = normalizeCourseCode(question.source.courseCode);
    if (normalizedSelected) return code === normalizedSelected;
    return code.startsWith(normalizedInput) || normalizedInput.startsWith(code);
  });
}

export function summarizeExtractedQuestions(
  questions: ExtractedQuestion[],
): CourseQuestionSummary[] {
  const byCourse = new Map<string, CourseQuestionSummary>();

  for (const question of questions) {
    const courseCode = normalizeCourseCode(question.source.courseCode);
    if (!courseCode) continue;

    const existing =
      byCourse.get(courseCode) ??
      {
        courseCode,
        courseName: question.source.courseName,
        count: 0,
        months: [],
      };
    existing.count += 1;
    if (!existing.courseName && question.source.courseName) {
      existing.courseName = question.source.courseName;
    }
    if (
      question.source.examYearMonth &&
      !existing.months.includes(question.source.examYearMonth)
    ) {
      existing.months.push(question.source.examYearMonth);
    }
    byCourse.set(courseCode, existing);
  }

  return [...byCourse.values()]
    .map((summary) => ({
      ...summary,
      months: summary.months.sort().reverse(),
    }))
    .sort((a, b) => a.courseCode.localeCompare(b.courseCode));
}

export function getMatchingCourseSummaries(
  questions: ExtractedQuestion[],
  courseInput: string,
): CourseQuestionSummary[] {
  const normalizedInput = normalizeCourseCode(courseInput);
  if (!normalizedInput) return [];

  return summarizeExtractedQuestions(questions).filter((summary) => {
    const code = normalizeCourseCode(summary.courseCode);
    return code.startsWith(normalizedInput) || normalizedInput.startsWith(code);
  });
}
