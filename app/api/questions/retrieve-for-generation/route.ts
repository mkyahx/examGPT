import { supabaseRpc } from "@/lib/server/supabaseRest";

export const runtime = "nodejs";

type GenerationProfileRow = {
  course_code: string;
  course_name: string;
  analysis: unknown;
  papers: unknown;
  questions: unknown;
};

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asInt(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const courseCode = asString(body.courseCode);
    if (!courseCode) {
      return Response.json({ ok: false, reason: "courseCode is required." }, { status: 400 });
    }

    const rows = await supabaseRpc<GenerationProfileRow[]>("get_course_generation_profile", {
      course_query: courseCode,
    });
    const profile = rows[0];
    if (!profile) {
      return Response.json(
        { ok: false, reason: `No Supabase course profile was found for ${courseCode}.` },
        { status: 404 },
      );
    }

    const count = clamp(asInt(body.count) ?? 100, 1, 300);
    const questions = Array.isArray(profile.questions) ? profile.questions.slice(0, count) : [];

    return Response.json({
      ok: true,
      retrieval: "course_generation_profile",
      profile: {
        courseCode: profile.course_code,
        courseName: profile.course_name,
        analysis: profile.analysis ?? {},
        papers: Array.isArray(profile.papers) ? profile.papers : [],
      },
      sourceQuestions: questions,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Question retrieval failed.";
    if (/get_course_generation_profile|refresh_course_analysis|marks|source_kind|PGRST202|PGRST204|42703/i.test(reason)) {
      return Response.json(
        {
          ok: false,
          migrationRequired: true,
          reason: "Run db/schema.sql in Supabase to enable the course library generation profile.",
        },
        { status: 500 },
      );
    }
    return Response.json(
      {
        ok: false,
        reason,
      },
      { status: 500 },
    );
  }
}
