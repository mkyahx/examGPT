export type QuestionReviewStatus = "pending" | "accepted" | "declined";

export type ExamQuestion = {
  id: string;
  section: string;
  prompt: string;
  marks: number;
  rubric?: string;
  /** Per-question review after generation; defaults to pending for older saves */
  reviewStatus?: QuestionReviewStatus;
};

export type ExtractedQuestionType =
  | "multiple_choice"
  | "fill_blank"
  | "short_answer"
  | "long_answer"
  | "coding"
  | "unknown";

export type QuestionTaggingStatus = "untagged" | "tagged" | "unknown" | "failed";

export type QuestionTopicTag = {
  topicId: string;
  label: string;
  confidence: number;
};

export type CourseSyllabusTopic = {
  id: string;
  label: string;
  description: string;
};

export type CourseSyllabusStatus = "ready" | "missing" | "failed";

export type CourseSyllabusCache = {
  courseCode: string;
  courseName: string;
  status: CourseSyllabusStatus;
  topics: CourseSyllabusTopic[];
  sourceUrl?: string;
  extractedAt: string;
  error?: string;
};

export type ExtractedQuestionSource = {
  pdfPath: string;
  courseCode: string;
  courseName: string;
  examYearMonth: string;
};

export type ExtractedQuestion = {
  id: string;
  source: ExtractedQuestionSource;
  type: ExtractedQuestionType;
  questionNo: string;
  prompt: string;
  questionTypeTag?: ExtractedQuestionType;
  topicTags?: QuestionTopicTag[];
  taggingStatus?: QuestionTaggingStatus;
  taggedAt?: string;
  tagSource?: "llm" | "fallback" | "extract-fallback" | "none";
  taggingError?: string;
};

export type MockExam = {
  id: string;
  courseCode: string;
  createdAt: string;
  focusHints: string;
  sourceSummary: string;
  questions: ExamQuestion[];
  markingScheme: string;
  /** Not promoted to the shared repository until feedback is submitted */
  inRepository?: boolean;
  repositorySyncedAt?: string | null;
  /** Increments when declined questions are partially regenerated */
  contentRevision?: number;
};

export type FeedbackEntry = {
  id: string;
  examId: string;
  similarity: number;
  difficulty: number;
  notes: string;
  createdAt: string;
};

export type VerifiedQuestion = {
  id: string;
  courseCode: string;
  text: string;
  solutionSketch: string;
  contributorNote: string;
  verifiedAt: string;
  creditsAwarded: number;
};

export type PastExamFile = {
  id: string;
  name: string;
  type: string;
  size: number;
  lastModified: number;
};

export type PastExamUpload = {
  id: string;
  courseCode: string;
  academicYear: string;
  semester: string;
  examType: string;
  files: PastExamFile[];
  contributorNote: string;
  uploadedAt: string;
  creditsAwarded: number;
};

export type CreditLedgerItem = {
  id: string;
  at: string;
  delta: number;
  reason: string;
};

export type AppSnapshot = {
  credits: number;
  byok: boolean;
  hasStoredKey: boolean;
  mockExams: MockExam[];
  verifiedQuestions: VerifiedQuestion[];
  extractedQuestions: ExtractedQuestion[];
  courseSyllabi: CourseSyllabusCache[];
  pastExamUploads: PastExamUpload[];
  feedbackEntries: FeedbackEntry[];
  ledger: CreditLedgerItem[];
  professorStyleNotes: string[];
};
