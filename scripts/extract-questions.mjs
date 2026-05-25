#!/usr/bin/env node

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const BUNDLED_PYTHON =
  "/Users/steven/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";
const COURSE_TOPIC_DIR = path.join("extracted", "course-topics");
const SYLLABUS_LOOKUP_URLS = [
  "https://www4.hku.hk/pubunit/drcd/",
  "https://ug.hkubs.hku.hk/course/",
  "https://www.cs.hku.hk/index.php/programmes/course-offered",
];
const CS_COURSE_YEARS = ["2024", "2023", "2022", "2021", "2020", "2019"];

const argv = parseArgs(process.argv.slice(2));

if (argv.help) {
  printHelp();
  process.exit(0);
}

const pdfPath = argv.pdf ? path.resolve(argv.pdf) : "";
if (!pdfPath) {
  console.error("Missing --pdf path.");
  printHelp();
  process.exit(1);
}

await assertReadable(pdfPath);

const metadata = metadataFromPdfPath(pdfPath);
const extracted = extractPdfText(pdfPath);
const source = {
  pdfPath: path.relative(process.cwd(), pdfPath),
  courseCode: metadata.courseCode,
  courseName: extractCourseName(extracted.pages[0]?.text ?? "", metadata.courseCode),
  examYearMonth: metadata.examYearMonth,
};
const taggingConfig = await buildTaggingConfig({
  courseCode: metadata.courseCode,
  courseName: source.courseName,
  topicsPath: argv.topics,
  disabled: Boolean(argv.noTags),
  skipSyllabusLookup: Boolean(argv.noSyllabusLookup),
});

const textStats = getTextStats(extracted.pages);
const output = buildOutput({ source, pages: extracted.pages, textStats, taggingConfig });
const outPath = path.resolve(
  argv.out ??
    path.join(
      "extracted",
      metadata.courseCode,
      `${metadata.fileYearMonth}_${metadata.courseCode}.questions.json`,
    ),
);

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`);

console.log(`Extracted ${output.questions.length} questions from ${source.pdfPath}`);
console.log(`Status: ${output.status}`);
console.log(`Saved ${path.relative(process.cwd(), outPath)}`);

if (!argv.noAnalysis) {
  updateCourseAnalysis(metadata.courseCode);
}

function buildOutput({ source, pages, textStats, taggingConfig }) {
  if (!hasReliableText(textStats)) {
    return {
      status: "needs_ocr",
      reason: "No reliable text layer detected",
      source,
      questions: [],
      stats: textStats,
    };
  }

  const cleanedLines = pages.flatMap((page) => cleanPageLines(page.text));
  const questions = splitQuestions(cleanedLines).map((question, index) => {
    const questionNo = question.questionNo || String(index + 1);
    const questionId = buildQuestionId({
      courseCode: source.courseCode,
      examYearMonth: source.examYearMonth,
      questionNo,
      index,
    });

    const type = classifyQuestion(question.prompt, question.sectionHint);
    const prompt = normalizePrompt(question.prompt);
    const tagResult = taggingConfig.enabled
      ? tagExtractedQuestion({ type, prompt }, taggingConfig)
      : null;

    return {
      id: questionId,
      source,
      type,
      questionNo,
      prompt,
      ...(tagResult ?? {}),
    };
  }).filter((question) => question.prompt.length > 0);

  return {
    status: questions.length > 0 ? "ok" : "no_questions_found",
    source,
    questions,
    stats: textStats,
    internalTagging: {
      status: taggingConfig.enabled ? taggingConfig.status : "disabled",
      threshold: taggingConfig.threshold,
      source: taggingConfig.source,
      topicsPath: taggingConfig.topicsPath,
      topicCount: taggingConfig.topics.length,
    },
  };
}

async function buildTaggingConfig({
  courseCode,
  courseName,
  topicsPath,
  disabled,
  skipSyllabusLookup,
}) {
  const threshold = Number(process.env.EXTRACT_TOPIC_THRESHOLD ?? 0.65);
  const defaultTopicsPath = getCourseTopicsPath(courseCode);
  if (disabled) {
    return {
      enabled: false,
      status: "disabled",
      source: "none",
      topicsPath: path.relative(process.cwd(), defaultTopicsPath),
      threshold,
      topics: [],
    };
  }

  if (topicsPath) {
    const topics = await loadTopicsFile(path.resolve(topicsPath));
    await writeCourseTopicsFile(defaultTopicsPath, {
      courseCode,
      courseName,
      status: topics.length > 0 ? "ready" : "missing",
      source: path.relative(process.cwd(), path.resolve(topicsPath)),
      topics,
    });
    return {
      enabled: true,
      status: topics.length > 0 ? "ready" : "missing",
      source: path.relative(process.cwd(), path.resolve(topicsPath)),
      topicsPath: path.relative(process.cwd(), defaultTopicsPath),
      threshold,
      topics,
    };
  }

  const cached = await readCourseTopicsFile(defaultTopicsPath);
  if (
    cached?.status === "ready" &&
    cached.topics.length > 0 &&
    cached.source === "online-syllabus-lookup" &&
    isSpecificOnlineSyllabusCache(cached) &&
    !isCourseNameFallbackCache(cached, courseName)
  ) {
    return {
      enabled: true,
      status: cached.status,
      source: cached.source,
      topicsPath: path.relative(process.cwd(), defaultTopicsPath),
      threshold,
      topics: cached.topics,
    };
  }

  if (!skipSyllabusLookup) {
    const syllabus = await fetchCourseSyllabus(courseCode, courseName);
    if (syllabus.status === "ready" && syllabus.topics.length > 0) {
      await writeCourseTopicsFile(defaultTopicsPath, syllabus);
      return {
        enabled: true,
        status: "ready",
        source: syllabus.sourceUrl ?? syllabus.source ?? "online-syllabus-lookup",
        topicsPath: path.relative(process.cwd(), defaultTopicsPath),
        threshold,
        topics: syllabus.topics,
      };
    }
  }

  const topics = [];
  const status = "missing";
  const source = "online-syllabus-lookup";
  await writeCourseTopicsFile(defaultTopicsPath, {
    courseCode,
    courseName,
    status,
    source,
    topics,
    error: "No syllabus topics available from online syllabus lookup.",
  });

  return {
    enabled: true,
    status,
    source,
    topicsPath: path.relative(process.cwd(), defaultTopicsPath),
    threshold,
    topics,
  };
}

function getCourseTopicsPath(courseCode) {
  const normalized = courseCode.replace(/\s+/g, "").toUpperCase() || "UNKNOWN";
  return path.resolve(path.join(COURSE_TOPIC_DIR, `${normalized}.topics.json`));
}

async function readCourseTopicsFile(filepath) {
  try {
    const raw = JSON.parse(await readFile(filepath, "utf8"));
    const topics = normalizeTopics(raw.topics);
    return {
      status: raw.status === "ready" && topics.length > 0 ? "ready" : raw.status ?? "missing",
      source: String(raw.source ?? filepath),
      sourceUrl: typeof raw.sourceUrl === "string" ? raw.sourceUrl : undefined,
      topics,
    };
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

function isCourseNameFallbackCache(cache, courseName) {
  const normalizedCourseTopic = slugify(courseName);
  return (
    cache.topics.length === 1 &&
    cache.topics[0].id === normalizedCourseTopic &&
    /fallback topic inferred from the course name/i.test(cache.topics[0].description)
  );
}

function isSpecificOnlineSyllabusCache(cache) {
  return typeof cache.sourceUrl === "string" && cache.sourceUrl.includes("infile=");
}

async function writeCourseTopicsFile(
  filepath,
  { courseCode, courseName, status, source, sourceUrl, topics, error },
) {
  await mkdir(path.dirname(filepath), { recursive: true });
  const payload = {
    courseCode,
    courseName,
    status,
    source,
    ...(sourceUrl ? { sourceUrl } : {}),
    extractedAt: new Date().toISOString(),
    ...(error ? { error } : {}),
    topics,
  };
  await writeFile(filepath, `${JSON.stringify(payload, null, 2)}\n`);
}

async function loadTopicsFile(filepath) {
  const raw = JSON.parse(await readFile(filepath, "utf8"));
  return normalizeTopics(Array.isArray(raw) ? raw : raw.topics);
}

function normalizeTopics(value) {
  const list = Array.isArray(value) ? value : [];
  return list
    .map((topic, index) => ({
      id: String(topic.id ?? slugify(topic.label ?? `topic-${index + 1}`)),
      label: String(topic.label ?? topic.name ?? ""),
      description: String(topic.description ?? topic.label ?? topic.name ?? ""),
    }))
    .filter((topic) => topic.id && topic.label);
}

async function fetchCourseSyllabus(courseCode, courseName = "") {
  const normalizedCourse = normalizeCourseCode(courseCode);
  const acceptableCourseCodes = [
    normalizedCourse,
    normalizedCourse.replace(/[A-Z]$/, ""),
  ].filter((value, index, list) => value && list.indexOf(value) === index);
  const searchedAt = new Date().toISOString();

  for (const url of buildSyllabusLookupUrls(normalizedCourse)) {
    try {
      const response = await fetch(url, {
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "ExamGPT-HKU syllabus lookup",
        },
        signal: AbortSignal.timeout(Number(process.env.EXTRACT_SYLLABUS_TIMEOUT_MS ?? 3000)),
      });
      if (!response.ok) continue;

      const text = stripHtml(await response.text());
      const upperText = text.toUpperCase();
      if (!acceptableCourseCodes.some((code) => upperText.includes(code))) continue;

      const topics = topicsFromSyllabusText(normalizedCourse, courseName, text);
      if (topics.length > 0) {
        return {
          courseCode: normalizedCourse,
          courseName,
          status: "ready",
          source: "online-syllabus-lookup",
          sourceUrl: url,
          extractedAt: searchedAt,
          topics,
        };
      }
    } catch {
      // Try the next source. The caller will fall back to built-in seeds or missing.
    }
  }

  return {
    courseCode: normalizedCourse,
    courseName,
    status: "missing",
    source: "online-syllabus-lookup",
    extractedAt: searchedAt,
    topics: [],
    error: "No HKU syllabus page with extractable topics was found.",
  };
}

function buildSyllabusLookupUrls(courseCode) {
  const urls = [];
  if (/^COMP\d{4}[A-Z]?$/.test(courseCode)) {
    const courseVariants = [
      courseCode,
      courseCode.replace(/[A-Z]$/, ""),
    ].filter((value, index, list) => value && list.indexOf(value) === index);

    for (const variant of courseVariants) {
      const lower = variant.toLowerCase();
      for (const year of CS_COURSE_YEARS) {
        urls.push(
          `https://www.cs.hku.hk/index.php/programmes/course-offered?infile=${year}%2F${lower}.html`,
        );
      }
    }
  }

  for (const base of SYLLABUS_LOOKUP_URLS) {
    const url = new URL(base);
    url.searchParams.set("q", courseCode);
    urls.push(url.toString());
  }

  return urls;
}

function topicsFromSyllabusText(courseCode, courseName, text) {
  const normalizedCourse = normalizeCourseCode(courseCode);
  const detailedTopics = topicsFromDetailedDescription(normalizedCourse, text);
  if (detailedTopics.length > 0) return detailedTopics;

  const candidates = sentenceCandidates(text, normalizedCourse);
  const seen = new Set();
  const topics = [];

  for (const candidate of candidates) {
    const cleaned = candidate
      .replace(new RegExp(normalizedCourse, "gi"), "")
      .replace(/\b(course|module|syllabus|topic|topics|students|will|learn|cover|covers)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    const label = cleaned.split(/[:.;]/)[0].trim().slice(0, 72);
    if (label.length < 4) continue;
    if (/mapping|curriculum|course code|course title|staff year/i.test(label)) continue;
    const id = slugify(label);
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

function topicsFromDetailedDescription(courseCode, text) {
  const section = extractBetween(
    text,
    /Detailed Description\s*:?\s*/i,
    /\b(?:Assessment|Teaching Plan|Moodle Course|Course Assessment|Learning Outcomes)\b/i,
  );
  if (!section) return [];

  const seen = new Set();
  const topics = [];
  const lines = section
    .split(/\n+| {2,}/)
    .map((line) => cleanSyllabusTopicLine(line))
    .filter(Boolean);

  for (const line of lines) {
    if (!looksLikeSyllabusTopic(line)) continue;
    const id = slugify(line);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    topics.push({
      id,
      label: line,
      description: `${line} (${courseCode} official syllabus detailed description)`,
    });
    if (topics.length >= 12) break;
  }

  return topics;
}

function extractBetween(text, startPattern, endPattern) {
  const start = text.search(startPattern);
  if (start < 0) return "";
  const afterStart = text.slice(start).replace(startPattern, "");
  const end = afterStart.search(endPattern);
  return end < 0 ? afterStart : afterStart.slice(0, end);
}

function cleanSyllabusTopicLine(line) {
  return line
    .replace(/\bMapped to CLOs?\b/gi, " ")
    .replace(/\bCLOs?\b/gi, " ")
    .replace(/\b\d+(?:\s*,\s*\d+)*\b/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[-•*]\s*/, "")
    .trim()
    .replace(/[.;:,]+$/g, "")
    .trim();
}

function looksLikeSyllabusTopic(line) {
  if (line.length < 4 || line.length > 80) return false;
  if (/^(basic|advanced)?\s*algorithm design technique$/i.test(line)) return false;
  if (/^(intractability|calendar entry)$/i.test(line)) return false;
  if (/course|students|understand|able to|including|these techniques/i.test(line)) return false;
  return /[A-Za-z]{4}/.test(line);
}

function sentenceCandidates(text, courseCode) {
  return text
    .split(/(?<=[.!?])\s+|\s+-\s+|[\n\r]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 24 && part.length <= 220)
    .filter((part) => !/mapping of courses|course code course title|curriculum course code|staff year/i.test(part))
    .filter(
      (part) =>
        part.toUpperCase().includes(courseCode) ||
        /learn|cover|topic|syllabus|concept|method|algorithm|theory|model|analysis|design/i.test(
          part,
        ),
    );
}

function stripHtml(html) {
  return html
    .replace(/<(?:br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function normalizeCourseCode(value) {
  return String(value).replace(/\s+/g, "").trim().toUpperCase();
}

function tagExtractedQuestion(question, config) {
  const questionTypeTag = classifyQuestion(question.prompt, question.type);
  if (config.status !== "ready" || config.topics.length === 0) {
    return {
      questionTypeTag,
      topicTags: [],
      taggingStatus: "unknown",
      taggedAt: new Date().toISOString(),
      tagSource: "none",
      taggingError: "No syllabus topics available during extraction.",
    };
  }

  const topicTags = fallbackTopicTags(question.prompt, config.topics, config.threshold);
  return {
    questionTypeTag,
    topicTags,
    taggingStatus: topicTags.length > 0 ? "tagged" : "unknown",
    taggedAt: new Date().toISOString(),
    tagSource: "extract-fallback",
  };
}

function fallbackTopicTags(prompt, topics, threshold) {
  const promptTokens = tokenSet(prompt);
  const scored = topics
    .map((topic) => {
      const labelTokens = tokenSet(topic.label);
      const topicTokens = tokenSet(`${topic.label} ${topic.description}`);
      const labelOverlap = countOverlap(promptTokens, labelTokens);
      const topicOverlap = countOverlap(promptTokens, topicTokens);
      const labelConfidence = labelTokens.size === 0 ? 0 : labelOverlap / labelTokens.size;
      const topicConfidence = topicTokens.size === 0 ? 0 : topicOverlap / topicTokens.size;
      const absoluteHitConfidence =
        labelOverlap > 0 ? (topicOverlap >= 4 ? 0.8 : topicOverlap >= 3 ? 0.7 : 0) : 0;
      const confidence = Math.min(
        0.95,
        Math.max(labelConfidence, topicConfidence, absoluteHitConfidence),
      );
      return {
        topicId: topic.id,
        label: topic.label,
        confidence: Number(confidence.toFixed(2)),
      };
    })
    .filter((tag) => tag.confidence >= threshold)
    .sort((a, b) => b.confidence - a.confidence);

  return scored.slice(0, 3);
}

function tokenSet(value) {
  const shortKeep = new Set(["ai", "ml", "os", "dp", "nlp", "sql", "dfs", "bfs"]);
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((token) => normalizeToken(token))
      .filter((token) => token.length >= 4 || shortKeep.has(token)),
  );
}

function normalizeToken(token) {
  if (token.length > 5 && token.endsWith("ing")) {
    return token.slice(0, -3);
  }
  if (token.length > 4 && token.endsWith("s")) {
    return token.slice(0, -1);
  }
  return token;
}

function countOverlap(left, right) {
  let count = 0;
  for (const token of right) {
    if (left.has(token)) count += 1;
  }
  return count;
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function splitQuestions(lines) {
  const questions = [];
  let current = null;
  let sectionHint = "";
  let seenFirstQuestion = false;
  let previousTopLevelQuestion = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const detectedSection = detectSectionHint(trimmed);
    if (detectedSection) {
      sectionHint = detectedSection;
      if (!current) {
        continue;
      }
    }

    const start = getQuestionStart(trimmed);
    if (start) {
      const currentQuestionNo = Number.parseInt(start.questionNo, 10);
      if (
        current &&
        Number.isFinite(currentQuestionNo) &&
        !/^\(\s*\d{1,3}\s*(?:points?|marks?)\s*\)/i.test(start.remaining) &&
        current.prompt.length > 200
      ) {
        current.prompt += `\n${trimmed}`;
        continue;
      }

      if (
        current &&
        Number.isFinite(currentQuestionNo) &&
        previousTopLevelQuestion > 0 &&
        currentQuestionNo <= previousTopLevelQuestion &&
        current.prompt.length > 200
      ) {
        current.prompt += `\n${trimmed}`;
        continue;
      }

      if (current) {
        questions.push(current);
      }
      if (
        Number.isFinite(currentQuestionNo) &&
        previousTopLevelQuestion > 0 &&
        currentQuestionNo <= previousTopLevelQuestion
      ) {
        sectionHint = "short_answer";
      }
      previousTopLevelQuestion = currentQuestionNo;
      seenFirstQuestion = true;
      current = {
        questionNo: start.questionNo,
        sectionHint,
        prompt: start.remaining,
      };
      continue;
    }

    if (!seenFirstQuestion || isInstructionLine(trimmed)) {
      continue;
    }

    if (current) {
      current.prompt += `\n${trimmed}`;
    }
  }

  if (current) {
    questions.push(current);
  }

  return questions;
}

function getQuestionStart(line) {
  const patterns = [
    /^(?:Question|Q)\s*(\d{1,2})\s*[:.)-]?\s*(.*)$/i,
    /^(\d{1,2})\.\s+(.*)$/,
    /^(\d{1,2})\)\s+(.*)$/,
  ];

  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (match) {
      return {
        questionNo: match[1],
        remaining: match[2]?.trim() ?? "",
      };
    }
  }

  return null;
}

function classifyQuestion(prompt, sectionHint) {
  const haystack = `${sectionHint}\n${prompt}`.toLowerCase();
  const hasChoiceOptions = /(^|\n)\s*a[.)]\s+[\s\S]*\n\s*b[.)]\s+[\s\S]*\n\s*c[.)]\s+[\s\S]*\n\s*d[.)]\s+/i.test(prompt);

  if (sectionHint === "multiple_choice") {
    return "multiple_choice";
  }

  if (sectionHint === "fill_blank") {
    return "fill_blank";
  }

  if (sectionHint === "short_answer") {
    return "short_answer";
  }

  if (/fill\s+(?:in\s+)?(?:the\s+)?blank|blank|_{4,}|____/.test(haystack)) {
    return "fill_blank";
  }

  if (hasChoiceOptions && /which|choose|following|correct|is\/are/i.test(prompt)) {
    return "multiple_choice";
  }

  if (/algorithm|program|code|pseudocode|dynamic programming|running time|complexity/i.test(prompt)) {
    return "coding";
  }

  if (/short\s+question|brief|explain briefly/.test(haystack) || prompt.length < 900) {
    return "short_answer";
  }

  if (/essay|discuss|design|prove|show that|argue for/i.test(prompt) || prompt.length >= 900) {
    return "long_answer";
  }

  return "unknown";
}

function detectSectionHint(line) {
  if (/multiple\s+choice/i.test(line)) {
    return "multiple_choice";
  }
  if (/fill\s+(?:in\s+)?(?:the\s+)?blank/i.test(line)) {
    return "fill_blank";
  }
  if (/short\s+questions?/i.test(line)) {
    return "short_answer";
  }
  if (/long\s+questions?|essay\s+questions?/i.test(line)) {
    return "long_answer";
  }
  return "";
}

function cleanPageLines(text) {
  return text
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line && !isBoilerplateLine(line));
}

function isBoilerplateLine(line) {
  return [
    /^Page\s+\d+\s+of\s+\d+$/i,
    /^P\.?\s*\d+\s+of\s+\d+$/i,
    /^University Number\b/i,
    /^THE UNIVERSITY OF HONG KONG$/i,
    /^The University of Hong Kong$/i,
    /^FACULTY OF\b/i,
    /^SCHOOL OF\b/i,
    /^DEPARTMENT OF\b/i,
    /^Date:\b/i,
    /^Time:\b/i,
    /^Brand and Type of Calculator\b/i,
    /END OF PAPER/i,
  ].some((pattern) => pattern.test(line));
}

function isInstructionLine(line) {
  return /^(answer|only approved calculators|candidates|you can type|please write|total mark|there are|all short questions|internet searching|upload your answer|each question carries|if more than)/i.test(line);
}

function normalizePrompt(prompt) {
  return prompt
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function extractCourseName(firstPageText, courseCode) {
  const normalizedCode = courseCode.replace(/([A-Z]+)(\d+)/, "$1\\s*$2");
  const pattern = new RegExp(`\\b${normalizedCode}\\b\\s*:?\\s+(.+)`, "i");
  const lines = firstPageText
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  for (const line of lines) {
    const match = line.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return "";
}

function metadataFromPdfPath(pdfPath) {
  const basename = path.basename(pdfPath, path.extname(pdfPath));
  const parentDir = path.basename(path.dirname(pdfPath));
  const match = basename.match(/^(\d{4})_(\d{2})_\d{2}_([A-Z]{2,5}\d{4}[A-Z]?)$/i);
  if (match) {
    const [, year, month, courseCode] = match;
    return {
      courseCode: courseCode.toUpperCase(),
      examYearMonth: `${year}-${month}`,
      fileYearMonth: `${year}_${month}`,
    };
  }

  const courseMatch = basename.match(/([A-Z]{2,5}\d{4}[A-Z]?)/i);
  const parentCourseMatch = parentDir.match(/^([A-Z]{2,5}\d{4}[A-Z]?)$/i);
  const yearMonthMatch =
    basename.match(/(\d{4})[_-](\d{2})/) ??
    basename.match(/^(\d{4})\s+\d{1,2}-(\d{1,2})-\d{4}\b/);
  const courseCode =
    courseMatch?.[1]?.toUpperCase() ?? parentCourseMatch?.[1]?.toUpperCase() ?? "UNKNOWN";
  const year = yearMonthMatch?.[1] ?? "unknown";
  const month = yearMonthMatch?.[2]?.padStart(2, "0") ?? "unknown";
  return {
    courseCode,
    examYearMonth: `${year}-${month}`,
    fileYearMonth: `${year}_${month}`,
  };
}

function buildQuestionId({ courseCode, examYearMonth, questionNo, index }) {
  const safeQuestionNo = String(questionNo).replace(/[^A-Za-z0-9_-]/g, "");
  const sequence = String(index + 1).padStart(2, "0");
  return `${courseCode}_${examYearMonth.replace("-", "_")}_Q${safeQuestionNo}_${sequence}`;
}

function extractPdfText(pdfPath) {
  const python = findPython();
  const code = String.raw`
import json
import sys
from pypdf import PdfReader

pdf_path = sys.argv[1]
reader = PdfReader(pdf_path)
pages = []
for index, page in enumerate(reader.pages, start=1):
    try:
        text = page.extract_text() or ""
    except Exception as exc:
        text = ""
    pages.append({"page": index, "text": text})
print(json.dumps({"pages": pages}))
`;

  const result = spawnSync(python, ["-c", code, pdfPath], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });

  if (result.error) {
    throw new Error(`Failed to run Python PDF extractor: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`PDF extraction failed:\n${result.stderr}`);
  }

  return JSON.parse(result.stdout);
}

function findPython() {
  const candidates = [
    process.env.EXTRACT_PYTHON,
    BUNDLED_PYTHON,
    "python3",
    "python",
  ].filter(Boolean);

  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["-c", "import pypdf"], {
      encoding: "utf8",
    });
    if (result.status === 0) {
      return candidate;
    }
  }

  throw new Error(
    "Could not find Python with pypdf. Set EXTRACT_PYTHON to a Python executable that can import pypdf.",
  );
}

function updateCourseAnalysis(courseCode) {
  const result = spawnSync(
    process.execPath,
    ["scripts/analyze-course-patterns.mjs", "--course", courseCode],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    },
  );

  if (result.error) {
    console.warn(`Could not update course analysis: ${result.error.message}`);
    return;
  }

  if (result.status !== 0) {
    console.warn(`Could not update course analysis for ${courseCode}:\n${result.stderr}`);
    return;
  }

  const saved = result.stdout.match(/->\s+(.+)$/m)?.[1]?.trim();
  if (saved) {
    console.log(`Updated analysis ${saved}`);
  }
}

function getTextStats(pages) {
  const chars = pages.reduce((total, page) => total + (page.text?.trim().length ?? 0), 0);
  const pagesWithText = pages.filter((page) => (page.text?.trim().length ?? 0) > 40).length;
  return {
    pages: pages.length,
    pagesWithText,
    chars,
  };
}

function hasReliableText(stats) {
  return stats.chars >= 300 && stats.pagesWithText >= 1;
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      continue;
    }

    const [key, inlineValue] = arg.slice(2).split("=", 2);
    const camelKey = key.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const next = args[index + 1];
    if (inlineValue !== undefined) {
      parsed[camelKey] = inlineValue;
    } else if (!next || next.startsWith("--")) {
      parsed[camelKey] = true;
    } else {
      parsed[camelKey] = next;
      index += 1;
    }
  }
  return parsed;
}

async function assertReadable(filepath) {
  try {
    await access(filepath);
  } catch {
    console.error(`PDF not found or not readable: ${filepath}`);
    process.exit(1);
  }
}

function printHelp() {
  console.log(`Usage:
  npm run extract:questions -- --pdf downloads/COMP3251/2025_05_17_COMP3251.pdf

Options:
  --pdf PATH       Input PDF path.
  --out PATH       Output JSON path. Default: extracted/{course}/{yyyy_mm_course}.questions.json
  --topics PATH    Optional JSON topic list. Also saves it to extracted/course-topics/{course}.topics.json.
  --no-tags        Disable extraction-time topic tagging.
  --no-syllabus-lookup
                  Do not search online for syllabus topics when no ready topic cache exists.
  --no-analysis    Do not refresh extracted/{course}/{course}.analysis.json after extraction.

Environment:
  EXTRACT_PYTHON           Optional Python executable with pypdf installed.
  EXTRACT_TOPIC_THRESHOLD  Optional topic confidence threshold. Default: 0.65.
  EXTRACT_SYLLABUS_TIMEOUT_MS
                           Optional per-source online syllabus lookup timeout. Default: 3000.`);
}
