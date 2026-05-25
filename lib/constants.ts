export const STORAGE_KEY = "examgpt-hku-v1";
export const TAG_CONFIDENCE_THRESHOLD = 0.65;

export const CREDITS = {
  initial: 100,
  generateMock: -15,
  answerInquiry: -2,
  /** Batch partial regen of declined questions (simulated AI rewrite) */
  regenerateQuestions: -6,
  realExamFeedback: 2,
  questionContribution: 20,
  pastPaperContribution: 30,
} as const;

export const HKU_COURSE_PLACEHOLDERS = [
  "COMP3278",
  "MATH2101",
  "ELEC2840",
  "STAT3600",
  "CIVL2102",
] as const;
