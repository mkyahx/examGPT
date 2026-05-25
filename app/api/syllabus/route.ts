import { fetchCourseSyllabus, normalizeCourseCodeForTags } from "@/lib/internalTagging";
import type { CourseSyllabusCache } from "@/lib/types";

export const runtime = "nodejs";

function timeoutSyllabus(courseCode: string, courseName: string): Promise<CourseSyllabusCache> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        courseCode,
        courseName,
        status: "missing",
        topics: [],
        extractedAt: new Date().toISOString(),
        error: "Syllabus lookup timed out.",
      });
    }, 5500);
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      courseCode?: unknown;
      courseName?: unknown;
    };
    const courseCode = normalizeCourseCodeForTags(String(body.courseCode ?? ""));
    if (!courseCode) {
      return Response.json({ ok: false, reason: "courseCode is required." }, { status: 400 });
    }

    const courseName = typeof body.courseName === "string" ? body.courseName : "";
    const syllabus = await Promise.race([
      fetchCourseSyllabus(courseCode, courseName),
      timeoutSyllabus(courseCode, courseName),
    ]);
    return Response.json({ ok: true, syllabus });
  } catch {
    return Response.json(
      { ok: false, reason: "Could not look up syllabus for that course." },
      { status: 500 },
    );
  }
}
