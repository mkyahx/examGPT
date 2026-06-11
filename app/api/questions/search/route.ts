import { supabaseRpc } from "@/lib/server/supabaseRest";

export const runtime = "nodejs";

type QuestionSearchResult = {
  id: string;
  course_code: string;
  course_name: string;
  pdf_path: string;
  exam_year_month: string;
  exam_year: number | null;
  exam_month: number | null;
  academic_year: string | null;
  semester: string | null;
  exam_type: string | null;
  paper_date: string | null;
  source_kind: string;
  question_no: string;
  prompt: string;
  prompt_preview: string;
  marks: number;
  status: string;
  type: string;
  question_type_tag: string | null;
  curation_status: string;
  topic_tags: unknown[];
  rank: number;
};

function intParam(value: string | null) {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const page = clamp(intParam(url.searchParams.get("page")) ?? 1, 1, 10000);
    const pageSize = clamp(intParam(url.searchParams.get("pageSize")) ?? 20, 1, 100);
    const source = url.searchParams.get("source");
    const questions = await supabaseRpc<QuestionSearchResult[]>("search_questions", {
      course_query: url.searchParams.get("course"),
      year_query: intParam(url.searchParams.get("year")),
      month_query: intParam(url.searchParams.get("month")),
      type_query: url.searchParams.get("type"),
      topic_query: url.searchParams.get("topic"),
      text_query: url.searchParams.get("q"),
      page_size: pageSize,
      page_offset: (page - 1) * pageSize,
      source_query: source === "exambase" ? "exambase" : null,
    });

    return Response.json({ ok: true, page, pageSize, questions });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        reason: error instanceof Error ? error.message : "Question search failed.",
      },
      { status: 500 },
    );
  }
}
