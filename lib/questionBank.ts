import type { ExtractedQuestion } from "@/lib/types";

export type CourseQuestionSummary = {
  courseCode: string;
  courseName: string;
  count: number;
  months: string[];
};

export function normalizeCourseCode(value: string): string {
  return value.replace(/\s+/g, "").trim().toUpperCase();
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
