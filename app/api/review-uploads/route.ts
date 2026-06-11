import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  inferAcademicYear,
  inferPaperDate,
  inferSemesterFromMonth,
  marksForExtractedQuestion,
} from "@/lib/questionMetadata";
import { supabaseRest } from "@/lib/server/supabaseRest";
import type {
  ExtractedQuestion,
  PaperReviewQuestion,
  PaperReviewUpload,
  QuestionTopicTag,
} from "@/lib/types";

export const runtime = "nodejs";

const BUNDLED_PYTHON =
  "/Users/steven/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";
const UPLOAD_ROOT = path.resolve("review-uploads");

type SupabaseRow = Record<string, unknown>;

type ReviewQuestionRow = {
  id: string;
  status: "pending" | "rejected";
  course_code: string;
  course_name: string;
  pdf_path: string;
  exam_year_month: string;
  academic_year: string | null;
  semester: string | null;
  exam_type: string | null;
  paper_date: string | null;
  source_kind: string;
  question_no: string;
  prompt: string;
  marks: number;
  type: ExtractedQuestion["type"];
  question_type_tag: ExtractedQuestion["questionTypeTag"];
  tagging_status: ExtractedQuestion["taggingStatus"];
  tag_source: ExtractedQuestion["tagSource"];
  topic_tags: QuestionTopicTag[];
  review_upload_id: string | null;
  raw: Record<string, unknown> | null;
  paper_raw_source: Record<string, unknown> | null;
};

function makeId() {
  return `upload-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function safeFileName(value: string) {
  const cleaned = value.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || "paper.pdf";
}

function normalizeCourseCode(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, "")
    .trim()
    .toUpperCase();
}

function courseFromText(value: string) {
  const match = value.match(/\b([A-Z]{2,5})\s*[- ]?\s*(\d{4}[A-Z]?)\b/i);
  return match ? `${match[1]}${match[2]}`.toUpperCase() : "";
}

function inferExamYearMonth(fileName: string, academicYear: string, semester: string) {
  const fromFile = fileName.match(/(20\d{2})[-_](\d{2})/);
  if (fromFile) return `${fromFile[1]}-${fromFile[2]}`;

  const yearMatch = academicYear.match(/(20\d{2})/);
  const year = yearMatch ? Number(yearMatch[1]) : new Date().getFullYear();
  if (/semester\s*1/i.test(semester)) return `${year}-12`;
  if (/semester\s*2/i.test(semester)) return `${year + 1}-05`;
  if (/summer/i.test(semester)) return `${year + 1}-08`;
  return `${year}-00`;
}

function parseYearMonth(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})$/);
  if (!match) return { year: null, month: null };
  return {
    year: Number.parseInt(match[1], 10),
    month: Number.parseInt(match[2], 10),
  };
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function findPython() {
  const candidates = [process.env.EXTRACT_PYTHON, BUNDLED_PYTHON, "python3", "python"].filter(
    Boolean,
  ) as string[];

  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["-c", "import pypdf"], { encoding: "utf8" });
    if (result.status === 0) return candidate;
  }

  throw new Error("Could not find Python with pypdf for uploaded-paper extraction.");
}

function extractPreviewText(pdfPath: string) {
  const code = String.raw`
import sys
from pypdf import PdfReader

reader = PdfReader(sys.argv[1])
parts = []
for page in reader.pages[:2]:
    try:
        parts.append(page.extract_text() or "")
    except Exception:
        parts.append("")
print("\n".join(parts))
`;

  const result = spawnSync(findPython(), ["-c", code, pdfPath], {
    encoding: "utf8",
    maxBuffer: 5 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || "Could not read PDF text.");
  return result.stdout;
}

function runExtract({
  pdfPath,
  outPath,
  courseCode,
  examYearMonth,
  sourcePdfPath,
}: {
  pdfPath: string;
  outPath: string;
  courseCode: string;
  examYearMonth: string;
  sourcePdfPath: string;
}) {
  const result = spawnSync(
    process.execPath,
    [
      "scripts/extract-questions.mjs",
      "--pdf",
      pdfPath,
      "--out",
      outPath,
      "--course-code",
      courseCode,
      "--exam-year-month",
      examYearMonth,
      "--source-pdf-path",
      sourcePdfPath,
      "--no-analysis",
      "--no-syllabus-lookup",
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 30 * 1024 * 1024,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "Question extraction failed.");
  }
}

function prefixReviewQuestionIds(uploadId: string, questions: ExtractedQuestion[]) {
  const prefix = `REVIEW_${uploadId.replace(/[^A-Za-z0-9]+/g, "_")}`;
  return questions.map((question) => ({
    ...question,
    id: `${prefix}_${question.id}`,
    marks: marksForExtractedQuestion(question),
    status: "pending" as const,
  }));
}

async function upsertRows<T extends SupabaseRow>(
  table: string,
  rows: SupabaseRow[],
  onConflict: string,
) {
  if (rows.length === 0) return [] as T[];
  return supabaseRest<T[]>(table, {
    method: "POST",
    query: { on_conflict: onConflict },
    prefer: "resolution=merge-duplicates,return=representation",
    body: rows,
  });
}

function uniqueTopicTags(questions: PaperReviewQuestion[]) {
  const byKey = new Map<string, QuestionTopicTag>();
  for (const question of questions) {
    for (const tag of question.topicTags ?? []) {
      if (!tag.topicId) continue;
      byKey.set(tag.topicId, tag);
    }
  }
  return [...byKey.values()];
}

async function savePendingUploadToBank(upload: PaperReviewUpload) {
  const now = new Date().toISOString();
  const [run] = await supabaseRest<SupabaseRow[]>("extraction_runs", {
    method: "POST",
    prefer: "return=representation",
    body: [
      {
        run_label: `review-upload-${upload.id}`,
        source_dir: "review-uploads",
        extract_threshold: 0.5,
        totals: {
          reviewUploadId: upload.id,
          pendingQuestions: upload.questions.length,
        },
      },
    ],
  });

  const [course] = await upsertRows<SupabaseRow>(
    "courses",
    [
      {
        code: upload.courseCode,
        name: upload.courseName ?? "",
        updated_at: now,
      },
    ],
    "code",
  );
  const courseId = String(course.id);

  const topics = await upsertRows<SupabaseRow>(
    "syllabus_topics",
    uniqueTopicTags(upload.questions).map((tag) => ({
      course_id: courseId,
      topic_id: tag.topicId,
      label: tag.label,
      description: tag.label,
      raw: { source: "review-upload", reviewUploadId: upload.id, tag },
      updated_at: now,
    })),
    "course_id,topic_id",
  );
  const topicByKey = new Map(topics.map((topic) => [String(topic.topic_id), topic]));

  const parsed = parseYearMonth(upload.examYearMonth);
  const academicYear =
    upload.academicYear || inferAcademicYear(parsed.year, parsed.month) || undefined;
  const semester = upload.semester || inferSemesterFromMonth(parsed.month);
  const totalMarks = upload.questions.reduce(
    (sum, question) => sum + marksForExtractedQuestion(question),
    0,
  );
  const [paper] = await upsertRows<SupabaseRow>(
    "exam_papers",
    [
      {
        course_id: courseId,
        pdf_path: upload.pdfPath,
        exam_year_month: upload.examYearMonth,
        exam_year: parsed.year,
        exam_month: parsed.month,
        academic_year: academicYear,
        semester,
        exam_type: upload.examType || "Final",
        paper_date: inferPaperDate(upload.examYearMonth),
        source_kind: "user_upload",
        question_count: upload.questions.length,
        total_marks: totalMarks,
        extraction_status: upload.extractionStatus,
        stats: upload.stats ?? {},
        raw_source: {
          reviewUploadId: upload.id,
          fileName: upload.fileName,
          fileSize: upload.fileSize,
          academicYear,
          semester,
          examType: upload.examType,
          contributorNote: upload.contributorNote,
          uploadedAt: upload.uploadedAt,
        },
        extraction_run_id: run.id,
        updated_at: now,
      },
    ],
    "pdf_path",
  );

  await upsertRows(
    "staging_questions",
    upload.questions.map((question) => ({
      id: question.id,
      paper_id: paper.id,
      course_id: courseId,
      question_no: question.questionNo,
      prompt: question.prompt,
      prompt_hash: sha256(question.prompt),
      marks: marksForExtractedQuestion(question),
      status: "pending",
      type: question.type,
      question_type_tag: question.questionTypeTag ?? question.type,
      tagging_status: question.taggingStatus ?? null,
      tagged_at: question.taggedAt ?? null,
      tag_source: question.tagSource ?? null,
      tagging_error: question.taggingError ?? null,
      raw: {
        ...question,
        status: "pending",
        reviewUploadId: upload.id,
      },
      extraction_run_id: run.id,
      updated_at: now,
    })),
    "id",
  );

  const tagRows: SupabaseRow[] = [];
  for (const question of upload.questions) {
    (question.topicTags ?? []).forEach((tag, index) => {
      const topic = topicByKey.get(tag.topicId);
      if (!topic) return;
      tagRows.push({
        question_id: question.id,
        topic_id: topic.id,
        topic_key: tag.topicId,
        label: tag.label,
        confidence: tag.confidence,
        rank: index + 1,
        raw: tag,
      });
    });
  }
  await upsertRows("staging_question_topic_tags", tagRows, "question_id,topic_id");

  await supabaseRest("extraction_runs", {
    method: "PATCH",
    query: { id: `eq.${run.id}` },
    prefer: "return=minimal",
    body: {
      completed_at: new Date().toISOString(),
      totals: {
        reviewUploadId: upload.id,
        pendingQuestions: upload.questions.length,
        topicTags: tagRows.length,
      },
    },
  });
}

function groupReviewRows(rows: ReviewQuestionRow[]) {
  const byUpload = new Map<string, PaperReviewUpload>();

  for (const row of rows) {
    const raw = row.raw ?? {};
    const paperRaw = row.paper_raw_source ?? {};
    const uploadId = row.review_upload_id ?? String(paperRaw.reviewUploadId ?? row.pdf_path);
    const existing =
      byUpload.get(uploadId) ??
      ({
        id: uploadId,
        fileName: String(paperRaw.fileName ?? path.basename(row.pdf_path)),
        fileSize: Number(paperRaw.fileSize ?? 0),
        pdfPath: row.pdf_path,
        uploadedAt: String(paperRaw.uploadedAt ?? ""),
        courseCode: row.course_code,
        courseName: row.course_name,
        examYearMonth: row.exam_year_month,
        academicYear: String(row.academic_year ?? paperRaw.academicYear ?? ""),
        semester: String(row.semester ?? paperRaw.semester ?? ""),
        examType: String(paperRaw.examType ?? "Final"),
        contributorNote: String(paperRaw.contributorNote ?? ""),
        extractionStatus: "ok",
        questions: [],
        approvedAt: null,
      } satisfies PaperReviewUpload);

    existing.questions.push({
      id: row.id,
      status: row.status,
      source: {
        pdfPath: row.pdf_path,
        courseCode: row.course_code,
        courseName: row.course_name,
        examYearMonth: row.exam_year_month,
      },
      type: row.type,
      questionNo: row.question_no,
      prompt: row.prompt,
      marks: row.marks,
      questionTypeTag: row.question_type_tag,
      topicTags: row.topic_tags,
      taggingStatus: row.tagging_status,
      tagSource: row.tag_source,
      editedPrompt: typeof raw.editedPrompt === "string" ? raw.editedPrompt : undefined,
    });
    byUpload.set(uploadId, existing);
  }

  return [...byUpload.values()].sort((left, right) => right.uploadedAt.localeCompare(left.uploadedAt));
}

export async function GET() {
  try {
    const rows = await supabaseRest<ReviewQuestionRow[]>("question_review_v", {
      query: {
        select: "*",
        order: "exam_year_month.desc,question_no.asc",
      },
    });
    return Response.json({ ok: true, uploads: groupReviewRows(rows) });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Could not load review questions.";
    if (/question_review_v|staging_questions\.status|PGRST205|42703/i.test(reason)) {
      return Response.json({
        ok: true,
        uploads: [],
        migrationRequired: true,
        reason: "Run db/schema.sql to enable the DB-backed course and paper library.",
      });
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

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return Response.json({ ok: false, reason: "A PDF file is required." }, { status: 400 });
    }
    if (file.type && file.type !== "application/pdf") {
      return Response.json(
        { ok: false, reason: "Only PDF upload extraction is supported in this MVP." },
        { status: 400 },
      );
    }

    const uploadId = makeId();
    const originalName = safeFileName(file.name);
    const uploadDir = path.join(UPLOAD_ROOT, "files", uploadId);
    const extractDir = path.join(UPLOAD_ROOT, "extracted");
    const reviewDir = path.join(UPLOAD_ROOT, "reviews");
    await fs.mkdir(uploadDir, { recursive: true });
    await fs.mkdir(extractDir, { recursive: true });
    await fs.mkdir(reviewDir, { recursive: true });

    const pdfPath = path.join(uploadDir, originalName);
    const bytes = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(pdfPath, bytes);

    const previewText = extractPreviewText(pdfPath);
    const overrideCourseCode = normalizeCourseCode(form.get("courseCode"));
    const courseCode =
      overrideCourseCode || courseFromText(originalName) || courseFromText(previewText);
    if (!courseCode) {
      return Response.json(
        {
          ok: false,
          reason:
            "Could not identify the course code from this PDF. Add a course override and upload again.",
        },
        { status: 400 },
      );
    }

    const academicYear = String(form.get("academicYear") ?? "");
    const semester = String(form.get("semester") ?? "");
    const examType = String(form.get("examType") ?? "Final");
    const contributorNote = String(form.get("contributorNote") ?? "");
    const examYearMonth = inferExamYearMonth(originalName, academicYear, semester);
    const outPath = path.join(extractDir, `${uploadId}.questions.json`);
    const sourcePdfPath = path.relative(process.cwd(), pdfPath);

    runExtract({
      pdfPath,
      outPath,
      courseCode,
      examYearMonth,
      sourcePdfPath,
    });

    const extracted = JSON.parse(await fs.readFile(outPath, "utf8")) as {
      status: string;
      reason?: string;
      source: {
        pdfPath: string;
        courseCode: string;
        courseName: string;
        examYearMonth: string;
      };
      questions?: ExtractedQuestion[];
      stats?: PaperReviewUpload["stats"];
    };
    const questions = prefixReviewQuestionIds(uploadId, extracted.questions ?? []);
    const upload: PaperReviewUpload = {
      id: uploadId,
      fileName: file.name,
      fileSize: file.size,
      pdfPath: sourcePdfPath,
      uploadedAt: new Date().toISOString(),
      courseCode: extracted.source.courseCode,
      courseName: extracted.source.courseName,
      examYearMonth: extracted.source.examYearMonth,
      academicYear,
      semester,
      examType,
      contributorNote,
      extractionStatus: extracted.status,
      extractionReason: extracted.reason,
      stats: extracted.stats,
      questions,
      approvedAt: null,
    };

    await fs.writeFile(path.join(reviewDir, `${uploadId}.json`), `${JSON.stringify(upload, null, 2)}\n`);
    await savePendingUploadToBank(upload);
    return Response.json({ ok: true, upload });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        reason: error instanceof Error ? error.message : "Could not process uploaded paper.",
      },
      { status: 500 },
    );
  }
}
