import { supabaseRest } from "@/lib/server/supabaseRest";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const params = await context.params;
    const rows = await supabaseRest<unknown[]>("question_search_v", {
      query: {
        id: `eq.${params.id}`,
        select: "*",
      },
    });
    const question = rows[0];
    if (!question) {
      return Response.json({ ok: false, reason: "Question not found." }, { status: 404 });
    }

    return Response.json({ ok: true, question });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        reason: error instanceof Error ? error.message : "Question lookup failed.",
      },
      { status: 500 },
    );
  }
}
