import { marksForExtractedQuestion, TARGET_ORIGINAL_PAPER_MARKS } from "@/lib/questionMetadata";
import type {
  CourseAnalysisDistributionItem,
  CourseGenerationProfile,
  ExamQuestion,
  ExtractedQuestion,
  MockExam,
} from "@/lib/types";

function id(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function buildMarkingScheme(
  courseCode: string,
  questions: ExamQuestion[],
  focusHints?: string,
): string {
  const focus = focusHints?.trim();
  return [
    `Course: ${courseCode}`,
    "",
    focus
      ? `Focus guidelines (verbatim from student input):\n${focus}\n`
      : "Focus guidelines: (none supplied)\n",
    "General marking principles:",
    "- Award method marks even if the final numeric answer is wrong.",
    "- Penalise missing assumptions, inconsistent units, or undefined notation.",
    "",
    "Per-question notes:",
    ...questions.map(
      (q) => `- [${q.marks} marks] ${q.section}: ${q.rubric ?? "See model solution."}`,
    ),
    "",
    "HKU-style examiner comment:",
    "Expect concise prose, labelled diagrams where applicable, and numbered parts.",
  ].join("\n");
}

/** Verbatim focus block embedded in every stem so “instructions” are visible (still not true LLM reasoning). */
function focusBlock(focusHints: string): string {
  const t = focusHints.trim();
  if (!t) {
    return "No extra focus was provided — use standard syllabus weighting for this course.";
  }
  return `Stated focus for this mock (reproduce and address explicitly in your answer):\n\n"""${t}"""`;
}

function buildQuestions(courseCode: string, focusHints: string): ExamQuestion[] {
  const upper = courseCode.trim().toUpperCase() || "STEM";
  const focus = focusBlock(focusHints);

  return [
    {
      id: id("q"),
      section: "Section A — Short concepts",
      prompt: `(${upper})\n\n${focus}\n\nExplain how the core syllabus ideas connect to the focus above. Limit your answer to ~200 words and cite at least two concrete links to that focus.`,
      marks: 10,
      rubric: "Addresses stated focus (4), clear definitions (3), HKU-style structure (3).",
      reviewStatus: "pending",
    },
    {
      id: id("q"),
      section: "Section B — Quantitative / derivation",
      prompt: `(${upper})\n\n${focus}\n\nDerive or compute a quantitative problem for ${upper} whose solution path must depend on concepts implied by the focus above. Show all intermediate steps and state assumptions explicitly.`,
      marks: 15,
      rubric: "Problem tied to stated focus (5), correct method (5), algebra/units (5).",
      reviewStatus: "pending",
    },
    {
      id: id("q"),
      section: "Section C — Design / open-ended",
      prompt: `(${upper})\n\n${focus}\n\nDesign a small system, experiment, or policy argument that could appear on a final and that makes the focus above a first-class requirement (not a footnote).`,
      marks: 15,
      rubric: "Design encodes the focus (5), feasibility (5), evaluation of trade-offs (5).",
      reviewStatus: "pending",
    },
    {
      id: id("q"),
      section: "Section D — Integrated challenge",
      prompt: `(${upper})\n\n${focus}\n\nCombine two topics from ${upper} in one multi-part question. Part (i) bookwork; part (ii) synthesis must resolve a tension or trade-off explicitly mentioned or implied in the focus above.`,
      marks: 20,
      rubric: "Part (i) accuracy (6), part (ii) uses stated focus as the hinge (8), rigor (6).",
      reviewStatus: "pending",
    },
  ];
}

function stableScore(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function primaryTopicId(question: ExtractedQuestion): string {
  return question.topicTags?.[0]?.topicId ?? "unknown";
}

function questionTypeId(question: ExtractedQuestion): string {
  return question.questionTypeTag ?? question.type ?? "unknown";
}

function targetQuestionCount(
  analysis: CourseGenerationProfile["analysis"] | undefined,
  questions: ExtractedQuestion[],
): number {
  const fromAnalysis = analysis?.questionCountPerPaper?.average;
  if (typeof fromAnalysis === "number" && Number.isFinite(fromAnalysis) && fromAnalysis > 0) {
    return Math.max(1, Math.round(fromAnalysis));
  }

  const byPaper = new Map<string, number>();
  for (const question of questions) {
    const key = question.source.pdfPath || question.source.examYearMonth || "unknown";
    byPaper.set(key, (byPaper.get(key) ?? 0) + 1);
  }
  if (byPaper.size === 0) return 6;
  const average = [...byPaper.values()].reduce((sum, count) => sum + count, 0) / byPaper.size;
  return Math.max(1, Math.round(average));
}

function distributionTarget(items: CourseAnalysisDistributionItem[] | undefined): Map<string, number> {
  const valid = (items ?? []).filter((item) => item.id && item.count > 0);
  const total = valid.reduce((sum, item) => sum + item.count, 0);
  const map = new Map<string, number>();
  for (const item of valid) {
    const share =
      typeof item.shareOfQuestions === "number" && Number.isFinite(item.shareOfQuestions)
        ? item.shareOfQuestions
        : total > 0
          ? item.count / total
          : 0;
    map.set(item.id, share);
  }
  return map;
}

function countMap(
  questions: ExtractedQuestion[],
  keyForQuestion: (question: ExtractedQuestion) => string,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const question of questions) {
    const key = keyForQuestion(question);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function distributionPenalty(
  counts: Map<string, number>,
  total: number,
  target: Map<string, number>,
): number {
  if (target.size === 0 || total === 0) return 0;
  const keys = new Set([...target.keys(), ...counts.keys()]);
  let penalty = 0;
  for (const key of keys) {
    const actual = (counts.get(key) ?? 0) / total;
    penalty += Math.abs(actual - (target.get(key) ?? 0));
  }
  return penalty;
}

type SelectionState = {
  questions: ExtractedQuestion[];
  marks: number;
};

function selectionScore(
  state: SelectionState,
  courseCode: string,
  targetCount: number,
  typeTarget: Map<string, number>,
  topicTarget: Map<string, number>,
): number {
  const count = state.questions.length;
  const typePenalty = distributionPenalty(countMap(state.questions, questionTypeId), count, typeTarget);
  const topicPenalty = distributionPenalty(countMap(state.questions, primaryTopicId), count, topicTarget);
  const uniqueTopics = new Set(state.questions.map(primaryTopicId)).size;
  const spreadPenalty = count === 0 ? 0 : 1 - uniqueTopics / count;
  const countPenalty = Math.abs(count - targetCount) / Math.max(targetCount, 1);
  const tieBreak = state.questions.reduce(
    (sum, question) => sum + stableScore(`${courseCode}:${question.id}`) / 0xffffffff,
    0,
  ) / Math.max(count, 1);

  return countPenalty * 2.5 + typePenalty * 4 + topicPenalty * 5 + spreadPenalty * 1.5 + tieBreak * 0.01;
}

function stateSignature(state: SelectionState): string {
  return state.questions
    .map((question) => question.id)
    .sort()
    .join("|");
}

function pruneStates(
  states: SelectionState[],
  courseCode: string,
  targetCount: number,
  typeTarget: Map<string, number>,
  topicTarget: Map<string, number>,
): SelectionState[] {
  const bySignature = new Map<string, SelectionState>();
  for (const state of states) {
    bySignature.set(stateSignature(state), state);
  }
  return [...bySignature.values()]
    .sort(
      (a, b) =>
        selectionScore(a, courseCode, targetCount, typeTarget, topicTarget) -
        selectionScore(b, courseCode, targetCount, typeTarget, topicTarget),
    )
    .slice(0, 180);
}

function pickOriginalQuestions(
  questions: ExtractedQuestion[],
  courseCode: string,
  analysis: CourseGenerationProfile["analysis"] | undefined,
): ExtractedQuestion[] {
  const targetCount = targetQuestionCount(analysis, questions);
  const typeTarget = distributionTarget(analysis?.questionTypeDistribution?.items);
  const topicTarget = distributionTarget(analysis?.primaryTopicDistribution?.items);
  const seed = `${courseCode}:${new Date().toISOString().slice(0, 10)}`;
  const candidates = [...questions]
    .filter((question) => question.status !== "pending" && question.status !== "rejected")
    .map((question) => ({ question, marks: marksForExtractedQuestion(question) }))
    .filter(({ marks }) => marks > 0 && marks <= TARGET_ORIGINAL_PAPER_MARKS)
    .sort(
      (a, b) =>
        stableScore(`${seed}:${a.question.id}`) - stableScore(`${seed}:${b.question.id}`),
    );

  const statesByMarks = new Map<number, SelectionState[]>([
    [0, [{ questions: [], marks: 0 }]],
  ]);

  for (const { question, marks } of candidates) {
    const entries = [...statesByMarks.entries()];
    for (const [currentMarks, states] of entries) {
      const nextMarks = currentMarks + marks;
      if (nextMarks > TARGET_ORIGINAL_PAPER_MARKS) continue;
      const nextStates = states.map((state) => ({
        questions: [...state.questions, question],
        marks: nextMarks,
      }));
      const merged = [...(statesByMarks.get(nextMarks) ?? []), ...nextStates];
      statesByMarks.set(
        nextMarks,
        pruneStates(merged, courseCode, targetCount, typeTarget, topicTarget),
      );
    }
  }

  const exactStates = statesByMarks.get(TARGET_ORIGINAL_PAPER_MARKS) ?? [];
  if (exactStates.length === 0) return [];
  exactStates.sort(
    (a, b) =>
      selectionScore(a, courseCode, targetCount, typeTarget, topicTarget) -
      selectionScore(b, courseCode, targetCount, typeTarget, topicTarget),
  );
  return exactStates[0].questions;
}

function pickRealQuestions(
  questions: ExtractedQuestion[],
  courseCode: string,
): ExtractedQuestion[] {
  const seed = `${courseCode}:${new Date().toISOString().slice(0, 13)}`;
  const stable = [...questions]
    .sort((a, b) => stableScore(`${seed}:${a.id}`) - stableScore(`${seed}:${b.id}`))
  const tagged = stable.filter(
    (question) =>
      question.taggingStatus === "tagged" &&
      Array.isArray(question.topicTags) &&
      question.topicTags.length > 0,
  );

  if (tagged.length === 0) return stable.slice(0, 6);

  const picked: ExtractedQuestion[] = [];
  const usedQuestionIds = new Set<string>();
  const usedTopicIds = new Set<string>();
  const candidates = [...tagged].sort((a, b) => {
    const aConfidence = Math.max(...(a.topicTags ?? []).map((tag) => tag.confidence));
    const bConfidence = Math.max(...(b.topicTags ?? []).map((tag) => tag.confidence));
    return bConfidence - aConfidence;
  });

  for (const question of candidates) {
    const primaryTopic = question.topicTags?.[0]?.topicId;
    if (!primaryTopic || usedTopicIds.has(primaryTopic)) continue;
    picked.push(question);
    usedQuestionIds.add(question.id);
    usedTopicIds.add(primaryTopic);
    if (picked.length >= 6) return picked;
  }

  for (const question of stable) {
    if (usedQuestionIds.has(question.id)) continue;
    picked.push(question);
    usedQuestionIds.add(question.id);
    if (picked.length >= 6) break;
  }

  return picked;
}

function buildRealExamQuestions(
  realQuestions: ExtractedQuestion[],
  courseCode: string,
  generationMode: "original" | "ai" | "simulated",
  analysis?: CourseGenerationProfile["analysis"],
): ExamQuestion[] {
  const picked =
    generationMode === "original"
      ? pickOriginalQuestions(realQuestions, courseCode, analysis)
      : pickRealQuestions(realQuestions, courseCode);
  return picked.map((question) => ({
    id: id("real-q"),
    section: `Real past paper — ${question.source.courseCode} ${question.source.examYearMonth} — ${question.type}`,
    prompt: question.prompt,
    marks: marksForExtractedQuestion(question),
    rubric: `Direct backend question ${question.id} from ${question.source.pdfPath}; no official solution attached.`,
    sourceQuestionId: question.id,
    sourcePdfPath: question.source.pdfPath,
    reviewStatus: "pending",
  }));
}

function normalizeGeneratedQuestions(questions: ExamQuestion[] | undefined): ExamQuestion[] {
  return (questions ?? [])
    .filter((question) => question.prompt.trim() && question.marks > 0)
    .map((question, index) => ({
      ...question,
      id: question.id || id("ai-q"),
      section: question.section || `AI generated question ${index + 1}`,
      marks: Math.trunc(question.marks),
      reviewStatus: question.reviewStatus ?? "pending",
    }));
}

export function buildMockExam(params: {
  courseCode: string;
  focusHints: string;
  fileNames: string[];
  realQuestions?: ExtractedQuestion[];
  generatedQuestions?: ExamQuestion[];
  generationProfile?: CourseGenerationProfile;
  generationMode?: "original" | "ai" | "simulated";
  allowTemplateFallback?: boolean;
}): MockExam {
  const courseCode = params.courseCode.trim() || "HKU-COURSE";
  const focusHints = params.focusHints.trim();
  const realQuestions = params.realQuestions ?? [];
  const generationMode = params.generationMode ?? "simulated";
  const allowTemplateFallback = params.allowTemplateFallback ?? generationMode !== "original";
  const generatedQuestions = normalizeGeneratedQuestions(params.generatedQuestions);
  const realExamQuestions = buildRealExamQuestions(
    realQuestions,
    courseCode,
    generationMode,
    params.generationProfile?.analysis,
  );
  const templateQuestions = buildQuestions(courseCode, focusHints);
  const questions =
    generationMode === "ai" && generatedQuestions.length > 0
      ? generatedQuestions
      : realExamQuestions.length > 0
      ? allowTemplateFallback
        ? [
            ...realExamQuestions,
            ...templateQuestions.slice(0, Math.max(0, 4 - realExamQuestions.length)),
          ]
        : realExamQuestions
      : allowTemplateFallback
        ? templateQuestions
        : [];

  const sourceSummary =
    generationMode === "ai" && generatedQuestions.length > 0
      ? [
          `Generated ${generatedQuestions.length} AI question(s) for ${courseCode}.`,
          `Total marks: ${generatedQuestions.reduce((sum, q) => sum + q.marks, 0)}.`,
          focusHints ? `Focus: ${focusHints}.` : "",
          params.fileNames.length > 0 ? `Attached filenames: ${params.fileNames.join(", ")}.` : "",
        ]
          .filter(Boolean)
          .join(" ")
      : realExamQuestions.length > 0
      ? [
          generationMode === "original"
            ? `Used ${realExamQuestions.length} certified Exambase original question(s).`
            : `Used ${realExamQuestions.length} backend real past-paper question(s).`,
          generationMode === "original"
            ? `Total marks: ${realExamQuestions.reduce((sum, q) => sum + q.marks, 0)}.`
            : "",
          params.generationProfile?.analysis?.generatedAt
            ? `Course analysis: ${params.generationProfile.analysis.generatedAt}.`
            : "",
          `Sources: ${[
            ...new Set(
              realExamQuestions.map((q) => q.sourcePdfPath ?? q.sourceQuestionId ?? q.id),
            ),
          ].join(", ")}.`,
          params.fileNames.length > 0 ? `Attached filenames: ${params.fileNames.join(", ")}.` : "",
        ]
          .filter(Boolean)
          .join(" ")
      : params.fileNames.length > 0
        ? `RAG sources indexed: ${params.fileNames.join(", ")}`
        : "No imported real questions matched — template syllabus weighting applied.";

  return {
    id: id("exam"),
    courseCode,
    generationMode,
    createdAt: new Date().toISOString(),
    focusHints: focusHints || "(none)",
    sourceSummary,
    questions,
    markingScheme: buildMarkingScheme(courseCode, questions, focusHints),
    inRepository: false,
    repositorySyncedAt: null,
    contentRevision: 0,
  };
}

function rawFocusFromExam(focusHintsField: string): string {
  const t = focusHintsField.trim();
  if (!t || t === "(none)") return "";
  return t;
}

function buildAlternatePrompt(
  q: ExamQuestion,
  upper: string,
  rawFocus: string,
  revision: number,
  instruction?: string,
): string {
  const focus = focusBlock(rawFocus);
  const inst = instruction?.trim();
  const instPart = inst ? `\n\nAdditional edit request from you:\n"""${inst}"""` : "";
  const stamp = `Rewrite pass ${revision}`;

  if (q.section.includes("Section A")) {
    return `(${upper}) [${stamp}]\n\n${focus}\n\nIn ~200 words, contrast two syllabus concepts that both bear on the focus above. State definitions, one similarity, and one key difference.${instPart}`;
  }
  if (q.section.includes("Section B")) {
    return `(${upper}) [${stamp}]\n\n${focus}\n\nSolve a fresh quantitative variant (different surface structure from prior drafts) at ${q.marks} marks difficulty, chosen so the solution path depends on the focus above. Show all steps and boundary conditions.${instPart}`;
  }
  if (q.section.includes("Section C")) {
    return `(${upper}) [${stamp}]\n\n${focus}\n\nPropose a revised open-ended design brief that makes the focus above a first-class requirement. Include explicit success criteria and one explicit failure mode.${instPart}`;
  }
  return `(${upper}) [${stamp}]\n\n${focus}\n\nIntegrated multi-part challenge: (i) short recall, (ii) non-trivial synthesis that resolves a tension implied by the focus above. Keep marking load aligned with ${q.marks} marks.${instPart}`;
}

/**
 * Regenerates only questions marked declined; accepted and pending items are unchanged.
 * Declined slots return to pending for another review pass.
 */
export function applyDeclinedQuestionRegeneration(exam: MockExam, instruction?: string): MockExam | null {
  const hasDeclined = exam.questions.some((q) => q.reviewStatus === "declined");
  if (!hasDeclined) return null;

  const upper = exam.courseCode.trim().toUpperCase() || "STEM";
  const rawFocus = rawFocusFromExam(exam.focusHints);
  const revision = (exam.contentRevision ?? 0) + 1;

  const questions = exam.questions.map((q) => {
    if (q.reviewStatus !== "declined") return q;
    return {
      id: id("q"),
      section: q.section,
      marks: q.marks,
      rubric: q.rubric,
      reviewStatus: "pending" as const,
      prompt: buildAlternatePrompt(q, upper, rawFocus, revision, instruction),
    };
  });

  return {
    ...exam,
    contentRevision: revision,
    questions,
    markingScheme: buildMarkingScheme(
      exam.courseCode,
      questions,
      rawFocusFromExam(exam.focusHints),
    ),
  };
}
