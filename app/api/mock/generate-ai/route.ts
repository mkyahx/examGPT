import type { ExamQuestion } from "@/lib/types";

export const runtime = "nodejs";

type AiQuestion = {
  section: string;
  prompt: string;
  marks: number;
  rubric: string;
};

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeCourseCode(value: unknown) {
  return asString(value).replace(/\s+/g, "").toUpperCase();
}

function normalizeMarks(value: unknown) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}

function id(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseQuestions(value: unknown): AiQuestion[] {
  if (!value || typeof value !== "object") return [];
  const record = value as { questions?: unknown };
  if (!Array.isArray(record.questions)) return [];

  return record.questions
    .map((raw) => {
      if (!raw || typeof raw !== "object") return null;
      const question = raw as Record<string, unknown>;
      const prompt = asString(question.prompt);
      const marks = normalizeMarks(question.marks);
      if (!prompt || marks <= 0) return null;
      return {
        section: asString(question.section) || "AI generated question",
        prompt,
        marks,
        rubric: asString(question.rubric) || "Award marks for correctness, method, and clarity.",
      };
    })
    .filter((question): question is AiQuestion => question !== null);
}

function toExamQuestions(questions: AiQuestion[]): ExamQuestion[] {
  return questions.map((question) => ({
    id: id("ai-q"),
    section: question.section,
    prompt: question.prompt,
    marks: question.marks,
    rubric: question.rubric,
    reviewStatus: "pending",
  }));
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const courseCode = normalizeCourseCode(body.courseCode);
    const focusHints = asString(body.focusHints);
    const fileNames = Array.isArray(body.fileNames)
      ? body.fileNames.map(asString).filter(Boolean).slice(0, 12)
      : [];

    if (!courseCode) {
      return Response.json({ ok: false, reason: "courseCode is required." }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return Response.json(
        { ok: false, reason: "OPENAI_API_KEY is required for AI paper generation." },
        { status: 500 },
      );
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
        instructions:
          "You are an HKU STEM exam setter. Generate a fresh mock exam paper, not copied past-paper text. Return JSON only. The paper must total exactly 100 marks, use 4 to 6 multi-part questions, and include concise marking rubrics.",
        input: JSON.stringify({
          courseCode,
          focusHints,
          attachedFileNames: fileNames,
          requiredTotalMarks: 100,
          guidance:
            "Make the structure feel like a real HKU final paper: mixed conceptual, derivation/quantitative, coding/design where appropriate, and integrated synthesis. Include enough detail for students to answer without external context.",
        }),
        text: {
          format: {
            type: "json_schema",
            name: "ai_mock_exam",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["questions"],
              properties: {
                questions: {
                  type: "array",
                  minItems: 4,
                  maxItems: 6,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["section", "prompt", "marks", "rubric"],
                    properties: {
                      section: { type: "string" },
                      prompt: { type: "string" },
                      marks: { type: "integer", minimum: 1, maximum: 100 },
                      rubric: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      return Response.json(
        { ok: false, reason: payload.error?.message ?? "OpenAI paper generation failed." },
        { status: response.status },
      );
    }

    const payload = (await response.json()) as { output_text?: string };
    if (!payload.output_text) {
      return Response.json(
        { ok: false, reason: "OpenAI returned no structured paper." },
        { status: 502 },
      );
    }

    const questions = parseQuestions(JSON.parse(payload.output_text));
    const totalMarks = questions.reduce((sum, question) => sum + question.marks, 0);
    if (questions.length === 0 || totalMarks !== 100) {
      return Response.json(
        {
          ok: false,
          reason: `AI paper must contain usable questions totaling 100 marks; got ${totalMarks}.`,
        },
        { status: 502 },
      );
    }

    return Response.json({
      ok: true,
      questions: toExamQuestions(questions),
      totalMarks,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        reason: error instanceof Error ? error.message : "Could not generate AI paper.",
      },
      { status: 500 },
    );
  }
}
