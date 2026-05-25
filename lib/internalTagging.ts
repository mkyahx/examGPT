import { TAG_CONFIDENCE_THRESHOLD } from "@/lib/constants";
import type {
  CourseSyllabusCache,
  CourseSyllabusTopic,
  ExtractedQuestion,
  ExtractedQuestionType,
  QuestionTopicTag,
} from "@/lib/types";

const DEFAULT_SYLLABUS_LOOKUP_URLS = [
  "https://www4.hku.hk/pubunit/drcd/",
  "https://ug.hkubs.hku.hk/course/",
  "https://www.cs.hku.hk/index.php/programmes/course-offered",
] as const;

export type TaggedQuestionResult = Pick<
  ExtractedQuestion,
  "id" | "questionTypeTag" | "topicTags" | "taggingStatus" | "taggedAt" | "tagSource" | "taggingError"
>;

export function normalizeTopicId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function normalizeCourseCodeForTags(value: string): string {
  return value.replace(/\s+/g, "").trim().toUpperCase();
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function sentenceCandidates(text: string, courseCode: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\s+-\s+|[\n\r]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 24 && part.length <= 220)
    .filter((part) => !/mapping of courses|course code course title|curriculum course code|staff year/i.test(part))
    .filter((part) => part.toUpperCase().includes(courseCode) || /learn|cover|topic|syllabus|concept|method|algorithm|theory|model|analysis|design/i.test(part));
}

export function topicsFromSyllabusText(
  courseCode: string,
  courseName: string,
  text: string,
): CourseSyllabusTopic[] {
  const normalizedCourse = normalizeCourseCodeForTags(courseCode);
  const candidates = sentenceCandidates(text, normalizedCourse);
  const seen = new Set<string>();
  const topics: CourseSyllabusTopic[] = [];

  for (const candidate of candidates) {
    const cleaned = candidate
      .replace(new RegExp(normalizedCourse, "gi"), "")
      .replace(/\b(course|module|syllabus|topic|topics|students|will|learn|cover|covers)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    const label = cleaned.split(/[:.;]/)[0].trim().slice(0, 72);
    if (label.length < 4) continue;
    if (/mapping|curriculum|course code|course title|staff year/i.test(label)) continue;
    const id = normalizeTopicId(label);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    topics.push({
      id,
      label,
      description: candidate,
    });
    if (topics.length >= 12) break;
  }

  return topics;
}

export async function fetchCourseSyllabus(courseCode: string, courseName = ""): Promise<CourseSyllabusCache> {
  const normalizedCourse = normalizeCourseCodeForTags(courseCode);
  const searchedAt = new Date().toISOString();

  for (const base of DEFAULT_SYLLABUS_LOOKUP_URLS) {
    try {
      const url = new URL(base);
      url.searchParams.set("q", normalizedCourse);
      const response = await fetch(url, {
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "ExamGPT-HKU syllabus lookup",
        },
        signal: AbortSignal.timeout(2000),
      });
      if (!response.ok) continue;
      const text = stripHtml(await response.text());
      if (!text.toUpperCase().includes(normalizedCourse)) continue;
      const topics = topicsFromSyllabusText(normalizedCourse, courseName, text);
      if (topics.length > 0) {
        return {
          courseCode: normalizedCourse,
          courseName,
          status: "ready",
          topics,
          sourceUrl: url.toString(),
          extractedAt: searchedAt,
        };
      }
    } catch {
      // Keep trying other HKU sources; callers receive a missing/failed cache if all fail.
    }
  }

  return {
    courseCode: normalizedCourse,
    courseName,
    status: "missing",
    topics: [],
    extractedAt: searchedAt,
    error: "No HKU syllabus page with extractable topics was found.",
  };
}

export function inferQuestionType(question: Pick<ExtractedQuestion, "type" | "prompt">): ExtractedQuestionType {
  if (question.type && question.type !== "unknown") return question.type;
  const prompt = question.prompt.toLowerCase();
  if (/\b(choose|select|mcq|multiple choice)\b/.test(prompt)) return "multiple_choice";
  if (/\b(fill in|blank|complete the)\b/.test(prompt)) return "fill_blank";
  if (/\b(code|program|function|algorithm|implement)\b/.test(prompt)) return "coding";
  if (/\b(prove|derive|discuss|evaluate|design|explain in detail)\b/.test(prompt)) return "long_answer";
  if (/\b(explain|define|state|briefly)\b/.test(prompt)) return "short_answer";
  return "unknown";
}

function tokenSet(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 4),
  );
}

export function fallbackTopicTags(
  question: Pick<ExtractedQuestion, "prompt">,
  topics: CourseSyllabusTopic[],
): QuestionTopicTag[] {
  const promptTokens = tokenSet(question.prompt);
  const scored = topics
    .map((topic) => {
      const topicTokens = tokenSet(`${topic.label} ${topic.description}`);
      let overlap = 0;
      for (const token of topicTokens) {
        if (promptTokens.has(token)) overlap += 1;
      }
      const confidence = topicTokens.size === 0 ? 0 : Math.min(0.95, overlap / Math.max(4, topicTokens.size));
      return {
        topicId: topic.id,
        label: topic.label,
        confidence: Number(confidence.toFixed(2)),
      };
    })
    .filter((tag) => tag.confidence >= TAG_CONFIDENCE_THRESHOLD)
    .sort((a, b) => b.confidence - a.confidence);

  return scored.slice(0, 3);
}

export function tagQuestionsWithFallback(
  questions: ExtractedQuestion[],
  syllabus: CourseSyllabusCache | undefined,
  threshold = TAG_CONFIDENCE_THRESHOLD,
): TaggedQuestionResult[] {
  const now = new Date().toISOString();
  return questions.map((question) => {
    const questionTypeTag = inferQuestionType(question);
    if (!syllabus || syllabus.status !== "ready" || syllabus.topics.length === 0) {
      return {
        id: question.id,
        questionTypeTag,
        topicTags: [],
        taggingStatus: "unknown",
        taggedAt: now,
        tagSource: "none",
        taggingError: "No syllabus topics available.",
      };
    }

    const topicTags = fallbackTopicTags(question, syllabus.topics).filter(
      (tag) => tag.confidence >= threshold,
    );
    return {
      id: question.id,
      questionTypeTag,
      topicTags,
      taggingStatus: topicTags.length > 0 ? "tagged" : "unknown",
      taggedAt: now,
      tagSource: "fallback",
    };
  });
}
