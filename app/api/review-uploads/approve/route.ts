import { createHash } from "node:crypto";
import { marksForExtractedQuestion } from "@/lib/questionMetadata";
import { getCurrentUser } from "@/lib/server/auth";
import { clientIpFromRequest, rateLimit, rateLimitResponse } from "@/lib/server/rateLimit";
import { supabaseRest } from "@/lib/server/supabaseRest";
import type { PaperReviewQuestion, PaperReviewUpload } from "@/lib/types";

export const runtime = "nodejs";

type SupabaseRow = Record<string, unknown>;

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function approvedPrompt(question: PaperReviewQuestion) {
  return question.editedPrompt?.trim() || question.prompt;
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return Response.json({ ok: false, reason: "Sign in before approving uploads." }, { status: 401 });
    }
    if (user.role !== "admin") {
      return Response.json({ ok: false, reason: "Only admins can approve uploaded papers." }, { status: 403 });
    }
    const limited = rateLimit({
      key: `review-approve:${user.id}:${clientIpFromRequest(request)}`,
      limit: 30,
      windowMs: 60 * 60 * 1000,
    });
    if (!limited.ok) return rateLimitResponse(limited);

    const body = (await request.json()) as {
      upload?: PaperReviewUpload;
      dryRun?: boolean;
    };
    const upload = body.upload;
    if (!upload?.id || !Array.isArray(upload.questions)) {
      return Response.json({ ok: false, reason: "Review upload payload is required." }, { status: 400 });
    }

    const approvedQuestions = upload.questions.filter((question) => question.status === "good");
    if (approvedQuestions.length === 0) {
      return Response.json(
        { ok: false, reason: "Mark at least one question as good before approving." },
        { status: 400 },
      );
    }

    if (body.dryRun) {
      return Response.json({
        ok: true,
        dryRun: true,
        wouldApprove: approvedQuestions.length,
        courseCode: upload.courseCode,
        examYearMonth: upload.examYearMonth,
      });
    }

    const now = new Date().toISOString();
    const [run] = await supabaseRest<SupabaseRow[]>("extraction_runs", {
      method: "POST",
      prefer: "return=representation",
      body: [
        {
          run_label: `review-approval-${upload.id}`,
          source_dir: "review-uploads",
          extract_threshold: 0.5,
          totals: {
            reviewUploadId: upload.id,
            goodQuestions: approvedQuestions.length,
          },
        },
      ],
    });
    for (const question of upload.questions) {
      const prompt = approvedPrompt(question);
      await supabaseRest("staging_questions", {
        method: "PATCH",
        query: { id: `eq.${question.id}` },
        prefer: "return=minimal",
        body: {
          status: question.status,
          prompt,
          prompt_hash: sha256(prompt),
          marks: marksForExtractedQuestion({ ...question, prompt }),
          raw: {
            ...question,
            prompt,
            marks: marksForExtractedQuestion({ ...question, prompt }),
            status: question.status,
            reviewUploadId: upload.id,
          },
          extraction_run_id: run.id,
          updated_at: now,
        },
      });
    }

    await supabaseRest("extraction_runs", {
      method: "PATCH",
      query: { id: `eq.${run.id}` },
      prefer: "return=minimal",
      body: {
        completed_at: new Date().toISOString(),
        totals: {
          reviewUploadId: upload.id,
          goodQuestions: approvedQuestions.length,
          rejectedQuestions: upload.questions.filter((question) => question.status === "rejected")
            .length,
        },
      },
    });

    await supabaseRest("rpc/refresh_course_analysis", {
      method: "POST",
      body: { course_query: upload.courseCode },
    });

    return Response.json({
      ok: true,
      approvedQuestions: approvedQuestions.length,
      runId: run.id,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        reason: error instanceof Error ? error.message : "Could not approve review upload.",
      },
      { status: 500 },
    );
  }
}
