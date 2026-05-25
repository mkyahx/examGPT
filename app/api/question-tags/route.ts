import { TAG_CONFIDENCE_THRESHOLD } from "@/lib/constants";
import { inferQuestionType, tagQuestionsWithFallback } from "@/lib/internalTagging";
import type {
  CourseSyllabusCache,
  ExtractedQuestion,
  ExtractedQuestionType,
  QuestionTopicTag,
} from "@/lib/types";

export const runtime = "nodejs";

function isExtractedQuestion(value: unknown): value is ExtractedQuestion {
  if (!value || typeof value !== "object") return false;
  const question = value as Partial<ExtractedQuestion>;
  return (
    typeof question.id === "string" &&
    typeof question.prompt === "string" &&
    typeof question.questionNo === "string" &&
    Boolean(question.source) &&
    typeof question.source?.courseCode === "string"
  );
}

function isSyllabus(value: unknown): value is CourseSyllabusCache {
  if (!value || typeof value !== "object") return false;
  const syllabus = value as Partial<CourseSyllabusCache>;
  return (
    typeof syllabus.courseCode === "string" &&
    Array.isArray(syllabus.topics) &&
    (syllabus.status === "ready" || syllabus.status === "missing" || syllabus.status === "failed")
  );
}

function isQuestionType(value: unknown): value is ExtractedQuestionType {
  return (
    value === "multiple_choice" ||
    value === "fill_blank" ||
    value === "short_answer" ||
    value === "long_answer" ||
    value === "coding" ||
    value === "unknown"
  );
}

type LlmQuestionTag = {
  id: string;
  questionTypeTag: ExtractedQuestionType;
  topicTags: QuestionTopicTag[];
};

async function tagQuestionsWithOpenAI(
  questions: ExtractedQuestion[],
  syllabus: CourseSyllabusCache,
  threshold: number,
): Promise<LlmQuestionTag[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || syllabus.status !== "ready" || syllabus.topics.length === 0) return null;

  const allowedTopics = new Map(syllabus.topics.map((topic) => [topic.id, topic]));
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
      instructions:
        "You classify exam questions. Return JSON only. Topic tags must come from the provided syllabus topic IDs. Never invent topics. If no topic confidence is above the threshold, return an empty topicTags array for that question.",
      input: JSON.stringify({
        threshold,
        courseCode: syllabus.courseCode,
        topics: syllabus.topics,
        questions: questions.map((question) => ({
          id: question.id,
          questionNo: question.questionNo,
          existingType: question.type,
          prompt: question.prompt,
        })),
      }),
      text: {
        format: {
          type: "json_schema",
          name: "question_topic_tags",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["questions"],
            properties: {
              questions: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["id", "questionTypeTag", "topicTags"],
                  properties: {
                    id: { type: "string" },
                    questionTypeTag: {
                      type: "string",
                      enum: [
                        "multiple_choice",
                        "fill_blank",
                        "short_answer",
                        "long_answer",
                        "coding",
                        "unknown",
                      ],
                    },
                    topicTags: {
                      type: "array",
                      maxItems: 3,
                      items: {
                        type: "object",
                        additionalProperties: false,
                        required: ["topicId", "label", "confidence"],
                        properties: {
                          topicId: { type: "string" },
                          label: { type: "string" },
                          confidence: { type: "number", minimum: 0, maximum: 1 },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) return null;

  const payload = (await response.json()) as { output_text?: string };
  if (!payload.output_text) return null;
  const parsed = JSON.parse(payload.output_text) as { questions?: unknown };
  if (!Array.isArray(parsed.questions)) return null;

  return parsed.questions
    .filter((item): item is LlmQuestionTag => {
      if (!item || typeof item !== "object") return false;
      const record = item as Partial<LlmQuestionTag>;
      return typeof record.id === "string" && isQuestionType(record.questionTypeTag);
    })
    .map((item) => {
      const topicTags = Array.isArray(item.topicTags)
        ? item.topicTags
            .filter((tag) => {
              if (!tag || typeof tag !== "object") return false;
              const record = tag as Partial<QuestionTopicTag>;
              return (
                typeof record.topicId === "string" &&
                typeof record.confidence === "number" &&
                record.confidence >= threshold &&
                allowedTopics.has(record.topicId)
              );
            })
            .map((tag) => {
              const topic = allowedTopics.get(tag.topicId)!;
              return {
                topicId: topic.id,
                label: topic.label,
                confidence: Math.min(1, Math.max(0, Number(tag.confidence.toFixed(2)))),
              };
            })
        : [];
      return {
        id: item.id,
        questionTypeTag: item.questionTypeTag,
        topicTags,
      };
    });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      questions?: unknown;
      syllabus?: unknown;
      threshold?: unknown;
    };
    const questions = Array.isArray(body.questions)
      ? body.questions.filter(isExtractedQuestion)
      : [];
    if (questions.length === 0) {
      return Response.json({ ok: false, reason: "questions array is required." }, { status: 400 });
    }
    const syllabus = isSyllabus(body.syllabus) ? body.syllabus : undefined;
    const threshold =
      typeof body.threshold === "number" ? body.threshold : TAG_CONFIDENCE_THRESHOLD;

    const llmTags = syllabus
      ? await tagQuestionsWithOpenAI(questions, syllabus, threshold).catch(() => null)
      : null;
    const taggedQuestions = llmTags
      ? questions.map((question) => {
          const result = llmTags.find((tag) => tag.id === question.id);
          const topicTags = result?.topicTags ?? [];
          return {
            id: question.id,
            questionTypeTag: result?.questionTypeTag ?? inferQuestionType(question),
            topicTags,
            taggingStatus: topicTags.length > 0 ? "tagged" : "unknown",
            taggedAt: new Date().toISOString(),
            tagSource: "llm",
          };
        })
      : tagQuestionsWithFallback(questions, syllabus, threshold);
    return Response.json({
      ok: true,
      taggedQuestions,
      tagSource: llmTags ? "llm" : "fallback",
      threshold,
    });
  } catch {
    return Response.json(
      { ok: false, reason: "Could not tag questions for that syllabus." },
      { status: 500 },
    );
  }
}
