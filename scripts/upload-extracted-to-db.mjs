#!/usr/bin/env node

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const DEFAULT_SOURCE_DIR = "extracted";
const DEFAULT_BATCH_SIZE = 100;
const VALID_TOPIC_SOURCE_STATUSES = new Set(["ready", "missing", "failed"]);

function parseArgs(argv) {
  const args = {
    dryRun: false,
    sourceDir: DEFAULT_SOURCE_DIR,
    course: "",
    batchSize: DEFAULT_BATCH_SIZE,
    runLabel: "",
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [flag, inlineValue] = arg.split("=", 2);
    const nextValue = () => {
      if (inlineValue !== undefined) return inlineValue;
      index += 1;
      return argv[index];
    };

    if (arg === "--dry-run") args.dryRun = true;
    else if (flag === "--source") args.sourceDir = nextValue() ?? args.sourceDir;
    else if (flag === "--course") args.course = String(nextValue() ?? "").toUpperCase();
    else if (flag === "--batch-size") {
      args.batchSize = Math.max(1, Number.parseInt(nextValue() ?? "", 10) || DEFAULT_BATCH_SIZE);
    } else if (flag === "--run-label") args.runLabel = nextValue() ?? "";
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/upload-extracted-to-db.mjs [options]

Options:
  --dry-run                 Scan extracted JSON and print upload counts only.
  --source <dir>            Source extract directory. Default: extracted
  --course <code>           Upload one course only, for example COMP3251.
  --batch-size <number>     REST batch size. Default: 100
  --run-label <label>       Optional label stored on extraction_runs.
  --help                    Show this help.

Required for real upload:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
`);
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadEnvFile(filePath) {
  if (!(await fileExists(filePath))) return;
  const text = await fs.readFile(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue
      .trim()
      .replace(/^export\s+/, "")
      .replace(/^"(.*)"$/, "$1")
      .replace(/^'(.*)'$/, "$1");
  }
}

async function loadLocalEnv(cwd) {
  await loadEnvFile(path.join(cwd, ".env.local"));
  await loadEnvFile(path.join(cwd, ".env"));
}

async function readJson(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  return JSON.parse(text);
}

function normalizeCourseCode(value) {
  return String(value ?? "").trim().toUpperCase();
}

function parseYearMonth(value, fallbackFileName = "") {
  const source = String(value || fallbackFileName);
  const match = source.match(/(20\d{2})[-_](\d{2})/);
  if (!match) {
    return { examYearMonth: String(value ?? ""), examYear: null, examMonth: null };
  }
  const examYear = Number.parseInt(match[1], 10);
  const examMonth = Number.parseInt(match[2], 10);
  return {
    examYearMonth: `${match[1]}-${match[2]}`,
    examYear,
    examMonth,
  };
}

function defaultMarksForQuestionType(type) {
  if (type === "multiple_choice" || type === "fill_blank") return 4;
  if (type === "coding" || type === "long_answer") return 20;
  if (type === "short_answer") return 10;
  return 10;
}

function marksForQuestion(question) {
  if (Number.isFinite(question?.marks) && Number(question.marks) > 0) {
    return Math.trunc(Number(question.marks));
  }
  const prompt = String(question?.prompt ?? "");
  const explicit = prompt.match(/\((\d{1,3})\s*(?:points?|marks?)\)/i);
  if (explicit) return Number(explicit[1]);
  return defaultMarksForQuestionType(String(question?.type ?? "unknown"));
}

function inferSemesterFromMonth(month) {
  if (month === 12) return "Semester 1";
  if (month === 5) return "Semester 2";
  if (month === 8) return "Summer";
  return "Unknown";
}

function inferAcademicYear(year, month) {
  if (!year || !month) return "";
  const startYear = month >= 9 ? year : year - 1;
  return `${startYear}-${startYear + 1}`;
}

function inferPaperDate(yearMonth) {
  const match = String(yearMonth ?? "").match(/^(20\d{2})-(\d{2})$/);
  if (!match) return null;
  const month = Number.parseInt(match[2], 10);
  if (month < 1 || month > 12) return null;
  return `${match[1]}-${match[2]}-01`;
}

function inferSourceKind(pdfPath) {
  if (String(pdfPath).startsWith("downloads/")) return "exambase";
  if (String(pdfPath).startsWith("review-uploads/")) return "user_upload";
  return "unknown";
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function summarize(scan) {
  const questionTypeCounts = {};
  const paperStatusCounts = {};
  let topicTaggedQuestions = 0;

  for (const paper of scan.papers.values()) {
    paperStatusCounts[paper.extractionStatus] = (paperStatusCounts[paper.extractionStatus] ?? 0) + 1;
  }

  for (const question of scan.questions.values()) {
    const type = question.questionTypeTag || question.type || "unknown";
    questionTypeCounts[type] = (questionTypeCounts[type] ?? 0) + 1;
    if (question.topicTags.length > 0) topicTaggedQuestions += 1;
  }

  return {
    courses: scan.courses.size,
    topicSources: scan.topicSources.size,
    syllabusTopics: scan.syllabusTopics.length,
    papers: scan.papers.size,
    questions: scan.questions.size,
    topicTags: scan.topicTags.length,
    topicTaggedQuestions,
    paperStatusCounts,
    questionTypeCounts,
    duplicateQuestionIds: scan.duplicateQuestionIds,
    skippedTopicTags: scan.skippedTopicTags,
  };
}

function addCourse(courses, courseCode, courseName = "") {
  const code = normalizeCourseCode(courseCode);
  if (!code) return;
  const existing = courses.get(code);
  const name = String(courseName ?? "").trim();
  if (!existing) {
    courses.set(code, { code, name });
  } else if (!existing.name && name) {
    existing.name = name;
  }
}

function createMissingTopicSource(courseCode) {
  return {
    courseCode,
    courseName: "",
    status: "missing",
    source: "online-syllabus-lookup",
    sourceUrl: null,
    searchedUrls: [],
    extractedAt: null,
    topics: [],
    error: "No topics JSON was found for this course.",
  };
}

async function scanExtracted({ sourceDir, courseFilter }) {
  const sourceRoot = path.resolve(sourceDir);
  const topicsDir = path.join(sourceRoot, "course-topics");
  const scan = {
    sourceRoot,
    courses: new Map(),
    topicSources: new Map(),
    syllabusTopics: [],
    papers: new Map(),
    questions: new Map(),
    topicTags: [],
    duplicateQuestionIds: [],
    skippedTopicTags: 0,
  };

  if (!(await fileExists(sourceRoot))) {
    throw new Error(`Source directory not found: ${sourceRoot}`);
  }

  if (await fileExists(topicsDir)) {
    const topicFiles = (await fs.readdir(topicsDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".topics.json"))
      .map((entry) => entry.name)
      .sort();

    for (const topicFile of topicFiles) {
      const topicPath = path.join(topicsDir, topicFile);
      const topicData = await readJson(topicPath);
      const courseCode = normalizeCourseCode(topicData.courseCode ?? topicFile.split(".")[0]);
      if (!courseCode || (courseFilter && courseCode !== courseFilter)) continue;

      addCourse(scan.courses, courseCode, topicData.courseName);
      scan.topicSources.set(courseCode, {
        ...topicData,
        courseCode,
        status: VALID_TOPIC_SOURCE_STATUSES.has(topicData.status) ? topicData.status : "missing",
        sourcePath: path.relative(process.cwd(), topicPath),
      });

      const topics = Array.isArray(topicData.topics) ? topicData.topics : [];
      for (const topic of topics) {
        if (!isPlainObject(topic) || !topic.id || !topic.label) continue;
        scan.syllabusTopics.push({
          courseCode,
          topicId: String(topic.id),
          label: String(topic.label),
          description: String(topic.description ?? ""),
          raw: topic,
        });
      }
    }
  }

  const courseDirs = (await fs.readdir(sourceRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name !== "course-topics")
    .map((entry) => entry.name)
    .sort();

  for (const courseDirName of courseDirs) {
    const courseCode = normalizeCourseCode(courseDirName);
    if (courseFilter && courseCode !== courseFilter) continue;

    const courseDir = path.join(sourceRoot, courseDirName);
    const questionFiles = (await fs.readdir(courseDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".questions.json"))
      .map((entry) => entry.name)
      .sort();

    for (const questionFile of questionFiles) {
      const questionPath = path.join(courseDir, questionFile);
      const payload = await readJson(questionPath);
      const source = isPlainObject(payload.source) ? payload.source : {};
      const sourceCourseCode = normalizeCourseCode(source.courseCode ?? courseCode);
      const sourceCourseName = String(source.courseName ?? "");
      const yearMonth = parseYearMonth(source.examYearMonth, questionFile);
      const pdfPath = String(
        source.pdfPath ?? `downloads/${sourceCourseCode}/${questionFile.replace(".questions.json", ".pdf")}`,
      );
      const extractionStatus = String(payload.status ?? "unknown");
      const questions = Array.isArray(payload.questions) ? payload.questions : [];
      const validQuestions = questions.filter(
        (question) => isPlainObject(question) && question.id && typeof question.prompt === "string",
      );
      const totalMarks = validQuestions.reduce((sum, question) => sum + marksForQuestion(question), 0);

      addCourse(scan.courses, sourceCourseCode, sourceCourseName);
      if (!scan.topicSources.has(sourceCourseCode)) {
        scan.topicSources.set(sourceCourseCode, createMissingTopicSource(sourceCourseCode));
      }

      scan.papers.set(pdfPath, {
        courseCode: sourceCourseCode,
        pdfPath,
        examYearMonth: yearMonth.examYearMonth,
        examYear: yearMonth.examYear,
        examMonth: yearMonth.examMonth,
        academicYear: inferAcademicYear(yearMonth.examYear, yearMonth.examMonth),
        semester: inferSemesterFromMonth(yearMonth.examMonth),
        examType: String(source.examType ?? "Final"),
        paperDate: inferPaperDate(yearMonth.examYearMonth),
        sourceKind: inferSourceKind(pdfPath),
        questionCount: validQuestions.length,
        totalMarks,
        extractionStatus,
        stats: isPlainObject(payload.stats) ? payload.stats : {},
        rawSource: source,
      });

      for (const question of questions) {
        if (!isPlainObject(question) || !question.id || typeof question.prompt !== "string") continue;
        const questionSource = isPlainObject(question.source) ? question.source : source;
        const questionCourseCode = normalizeCourseCode(questionSource.courseCode ?? sourceCourseCode);
        addCourse(scan.courses, questionCourseCode, questionSource.courseName ?? sourceCourseName);

        if (scan.questions.has(String(question.id))) {
          scan.duplicateQuestionIds.push(String(question.id));
        }

        const topicTags = Array.isArray(question.topicTags) ? question.topicTags : [];
        const normalizedQuestion = {
          id: String(question.id),
          paperPdfPath: pdfPath,
          courseCode: questionCourseCode,
          questionNo: String(question.questionNo ?? ""),
          prompt: question.prompt,
          marks: marksForQuestion(question),
          type: String(question.type ?? "unknown"),
          questionTypeTag: question.questionTypeTag ? String(question.questionTypeTag) : null,
          taggingStatus: question.taggingStatus ? String(question.taggingStatus) : null,
          taggedAt: question.taggedAt ? String(question.taggedAt) : null,
          tagSource: question.tagSource ? String(question.tagSource) : null,
          taggingError: question.taggingError ? String(question.taggingError) : null,
          topicTags,
          raw: question,
        };
        scan.questions.set(normalizedQuestion.id, normalizedQuestion);

        topicTags.forEach((tag, index) => {
          if (!isPlainObject(tag) || !tag.topicId) {
            scan.skippedTopicTags += 1;
            return;
          }
          scan.topicTags.push({
            questionId: normalizedQuestion.id,
            courseCode: questionCourseCode,
            topicKey: String(tag.topicId),
            label: String(tag.label ?? tag.topicId),
            confidence: Number(tag.confidence ?? 0),
            rank: index + 1,
            raw: tag,
          });
        });
      }
    }
  }

  return scan;
}

function getSupabaseConfig() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Add them to .env.local or run with --dry-run.",
    );
  }

  return {
    restUrl: `${normalizeSupabaseProjectUrl(supabaseUrl)}/rest/v1`,
    key: serviceRoleKey,
  };
}

function normalizeSupabaseProjectUrl(value) {
  return String(value).trim().replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
}

function createSupabaseHeaders(key, prefer) {
  const headers = {
    apikey: key,
    "content-type": "application/json",
    ...(prefer ? { prefer } : {}),
  };
  if (!key.startsWith("sb_")) {
    headers.authorization = `Bearer ${key}`;
  }
  return headers;
}

function createSupabaseClient(config) {
  async function request(tableOrPath, options = {}) {
    const url = new URL(`${config.restUrl}/${tableOrPath}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }

    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: createSupabaseHeaders(config.key, options.prefer),
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();

    if (!response.ok) {
      throw new Error(`${options.method ?? "GET"} ${url.pathname} failed (${response.status}): ${text}`);
    }
    if (!text) return null;
    return JSON.parse(text);
  }

  async function upsert(table, rows, onConflict, batchSize) {
    const inserted = [];
    for (const rowChunk of chunk(rows, batchSize)) {
      const result = await request(table, {
        method: "POST",
        query: { on_conflict: onConflict },
        prefer: "resolution=merge-duplicates,return=representation",
        body: rowChunk,
      });
      if (Array.isArray(result)) inserted.push(...result);
    }
    return inserted;
  }

  return { request, upsert };
}

function postgrestLiteral(value) {
  const stringValue = String(value);
  if (/^[A-Za-z0-9_.:-]+$/.test(stringValue)) return stringValue;
  return `"${stringValue.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

async function deleteExistingTags(client, questionIds, batchSize) {
  for (const idChunk of chunk(questionIds, batchSize)) {
    await client.request("staging_question_topic_tags", {
      method: "DELETE",
      query: {
        question_id: `in.(${idChunk.map(postgrestLiteral).join(",")})`,
      },
      prefer: "return=minimal",
    });
  }
}

function mapBy(rows, key) {
  return new Map(rows.map((row) => [row[key], row]));
}

async function uploadScan(scan, args) {
  const client = createSupabaseClient(getSupabaseConfig());
  const totals = summarize(scan);
  const now = new Date().toISOString();

  const runRows = await client.request("extraction_runs", {
    method: "POST",
    prefer: "return=representation",
    body: [
      {
        run_label: args.runLabel || `upload-${now}`,
        source_dir: args.sourceDir,
        extract_threshold: 0.5,
        totals,
      },
    ],
  });
  const run = Array.isArray(runRows) ? runRows[0] : runRows;
  if (!run?.id) throw new Error("Could not create extraction_runs row.");

  const courseRows = Array.from(scan.courses.values())
    .sort((left, right) => left.code.localeCompare(right.code))
    .map((course) => ({
      code: course.code,
      name: course.name,
      updated_at: now,
    }));
  const uploadedCourses = await client.upsert("courses", courseRows, "code", args.batchSize);
  const courseByCode = mapBy(uploadedCourses, "code");

  const topicSourceRows = Array.from(scan.topicSources.values()).map((source) => {
    const course = courseByCode.get(source.courseCode);
    if (!course) throw new Error(`Course was not uploaded: ${source.courseCode}`);
    return {
      course_id: course.id,
      status: VALID_TOPIC_SOURCE_STATUSES.has(source.status) ? source.status : "missing",
      source: source.source ?? "online-syllabus-lookup",
      source_url: source.sourceUrl ?? null,
      searched_urls: Array.isArray(source.searchedUrls) ? source.searchedUrls : [],
      extracted_at: source.extractedAt ?? null,
      error: source.error ?? null,
      raw: source,
      updated_at: now,
    };
  });
  await client.upsert("course_topic_sources", topicSourceRows, "course_id", args.batchSize);

  const syllabusTopicRows = scan.syllabusTopics.map((topic) => {
    const course = courseByCode.get(topic.courseCode);
    if (!course) throw new Error(`Topic course was not uploaded: ${topic.courseCode}`);
    return {
      course_id: course.id,
      topic_id: topic.topicId,
      label: topic.label,
      description: topic.description,
      raw: topic.raw,
      updated_at: now,
    };
  });
  const uploadedTopics = await client.upsert(
    "syllabus_topics",
    syllabusTopicRows,
    "course_id,topic_id",
    args.batchSize,
  );
  const topicByCourseAndKey = new Map(
    uploadedTopics.map((topic) => [`${topic.course_id}:${topic.topic_id}`, topic]),
  );

  const paperRows = Array.from(scan.papers.values()).map((paper) => {
    const course = courseByCode.get(paper.courseCode);
    if (!course) throw new Error(`Paper course was not uploaded: ${paper.courseCode}`);
    return {
      course_id: course.id,
      pdf_path: paper.pdfPath,
      exam_year_month: paper.examYearMonth,
      exam_year: paper.examYear,
      exam_month: paper.examMonth,
      academic_year: paper.academicYear,
      semester: paper.semester,
      exam_type: paper.examType,
      paper_date: paper.paperDate,
      source_kind: paper.sourceKind,
      question_count: paper.questionCount,
      total_marks: paper.totalMarks,
      extraction_status: paper.extractionStatus,
      stats: paper.stats,
      raw_source: paper.rawSource,
      extraction_run_id: run.id,
      updated_at: now,
    };
  });
  const uploadedPapers = await client.upsert("exam_papers", paperRows, "pdf_path", args.batchSize);
  const paperByPath = mapBy(uploadedPapers, "pdf_path");

  const questionRows = Array.from(scan.questions.values()).map((question) => {
    const course = courseByCode.get(question.courseCode);
    const paper = paperByPath.get(question.paperPdfPath);
    if (!course) throw new Error(`Question course was not uploaded: ${question.courseCode}`);
    if (!paper) throw new Error(`Question paper was not uploaded: ${question.paperPdfPath}`);
    return {
      id: question.id,
      paper_id: paper.id,
      course_id: course.id,
      question_no: question.questionNo,
      prompt: question.prompt,
      prompt_hash: sha256(question.prompt),
      marks: question.marks,
      status: "good",
      type: question.type,
      question_type_tag: question.questionTypeTag,
      tagging_status: question.taggingStatus,
      tagged_at: question.taggedAt,
      tag_source: question.tagSource,
      tagging_error: question.taggingError,
      raw: question.raw,
      extraction_run_id: run.id,
      updated_at: now,
    };
  });
  await client.upsert("staging_questions", questionRows, "id", args.batchSize);

  await deleteExistingTags(client, Array.from(scan.questions.keys()), args.batchSize);

  let skippedTags = 0;
  const tagRowsByKey = new Map();
  for (const tag of scan.topicTags) {
    const course = courseByCode.get(tag.courseCode);
    const topic = course ? topicByCourseAndKey.get(`${course.id}:${tag.topicKey}`) : null;
    if (!topic) {
      skippedTags += 1;
      continue;
    }
    const tagRow = {
      question_id: tag.questionId,
      topic_id: topic.id,
      topic_key: tag.topicKey,
      label: tag.label,
      confidence: tag.confidence,
      rank: tag.rank,
      raw: tag.raw,
    };
    tagRowsByKey.set(`${tagRow.question_id}:${tagRow.topic_id}`, tagRow);
  }
  const tagRows = Array.from(tagRowsByKey.values());
  await client.upsert("staging_question_topic_tags", tagRows, "question_id,topic_id", args.batchSize);

  const refreshedCourses = [];
  for (const course of courseRows) {
    const analysis = await client.request("rpc/refresh_course_analysis", {
      method: "POST",
      body: { course_query: course.code },
    });
    refreshedCourses.push({
      courseCode: course.code,
      paperCount: analysis?.paperCount ?? 0,
      questionCount: analysis?.questionCount ?? 0,
    });
  }

  const completedTotals = {
    ...totals,
    uploadedTopicTags: tagRows.length,
    skippedTopicTags: totals.skippedTopicTags + skippedTags,
    refreshedCourses,
  };
  await client.request("extraction_runs", {
    method: "PATCH",
    query: { id: `eq.${run.id}` },
    prefer: "return=minimal",
    body: {
      completed_at: new Date().toISOString(),
      totals: completedTotals,
    },
  });

  return {
    runId: run.id,
    ...completedTotals,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  await loadLocalEnv(process.cwd());
  const courseFilter = normalizeCourseCode(args.course);
  const scan = await scanExtracted({
    sourceDir: args.sourceDir,
    courseFilter,
  });
  const summary = summarize(scan);

  if (args.dryRun) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          dryRun: true,
          sourceDir: path.relative(process.cwd(), scan.sourceRoot) || ".",
          courseFilter: courseFilter || null,
          wouldUpload: summary,
        },
        null,
        2,
      ),
    );
    return;
  }

  const uploadSummary = await uploadScan(scan, args);
  console.log(JSON.stringify({ ok: true, dryRun: false, uploaded: uploadSummary }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
