#!/usr/bin/env node

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const EXTRACTED_DIR = "extracted";
const COURSE_TOPICS_DIR = path.join(EXTRACTED_DIR, "course-topics");

const argv = parseArgs(process.argv.slice(2));

if (argv.help) {
  printHelp();
  process.exit(0);
}

const courses = argv.all
  ? await listExtractedCourses()
  : [normalizeCourseCode(argv.course ?? argv._?.[0])].filter(Boolean);

if (courses.length === 0) {
  console.error("Missing --course COURSE, or pass --all.");
  printHelp();
  process.exit(1);
}

const results = [];

for (const courseCode of courses) {
  const analysis = await analyzeCourse(courseCode);
  const outPath = getAnalysisOutPath(courseCode, argv.outDir);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(analysis, null, 2)}\n`);
  results.push({
    courseCode,
    papers: analysis.summary.paperCount,
    okPapers: analysis.summary.okPaperCount,
    questions: analysis.summary.questionCount,
    outPath: path.relative(process.cwd(), outPath),
  });
}

function getAnalysisOutPath(courseCode, outDir) {
  if (outDir) {
    return path.resolve(path.join(outDir, `${courseCode}.analysis.json`));
  }
  return path.resolve(path.join(EXTRACTED_DIR, courseCode, `${courseCode}.analysis.json`));
}

for (const result of results) {
  console.log(
    `${result.courseCode}: ${result.okPapers}/${result.papers} papers, ${result.questions} questions -> ${result.outPath}`,
  );
}

async function analyzeCourse(courseCode) {
  const courseDir = path.join(EXTRACTED_DIR, courseCode);
  const paperFiles = await listQuestionFiles(courseDir);
  const papers = [];
  const allQuestions = [];

  for (const filePath of paperFiles) {
    const paper = JSON.parse(await readFile(filePath, "utf8"));
    const questions = Array.isArray(paper.questions) ? paper.questions : [];
    const relativePath = path.relative(process.cwd(), filePath);
    const paperSummary = summarizePaper(paper, questions, relativePath);
    papers.push(paperSummary);

    for (const question of questions) {
      allQuestions.push({
        ...question,
        paperPath: relativePath,
        examYearMonth: paper.source?.examYearMonth ?? question.source?.examYearMonth ?? "unknown",
      });
    }
  }

  const topicsCache = await readCourseTopics(courseCode);
  const typeDistribution = countQuestionTypes(allQuestions);
  const topicDistribution = countQuestionTopics(allQuestions, topicsCache.topics);
  const questionCountStats = summarizeNumbers(papers.map((paper) => paper.questionCount));
  const positionPatterns = summarizeQuestionPositions(allQuestions);

  return {
    courseCode,
    courseName: firstNonEmpty(papers.map((paper) => paper.courseName)),
    generatedAt: new Date().toISOString(),
    inputs: {
      papersDir: path.relative(process.cwd(), path.resolve(courseDir)),
      topicsPath: topicsCache.path ? path.relative(process.cwd(), topicsCache.path) : null,
    },
    summary: {
      paperCount: papers.length,
      okPaperCount: papers.filter((paper) => paper.status === "ok").length,
      questionCount: allQuestions.length,
      questionCountPerPaper: questionCountStats,
      tagging: {
        topicStatus: topicsCache.status,
        knownTopicCount: topicsCache.topics.length,
        taggedQuestionCount: allQuestions.filter((question) => hasTopicTags(question)).length,
        unknownQuestionCount: allQuestions.filter((question) => !hasTopicTags(question)).length,
      },
    },
    patterns: {
      dominantQuestionTypes: topItems(typeDistribution.items, 5),
      recurringTopics: topicDistribution.primary.items.filter((topic) => topic.paperCount >= 2),
      uncoveredSyllabusTopics: topicDistribution.uncoveredTopics,
      commonQuestionPositions: positionPatterns,
    },
    distributions: {
      questionTypes: typeDistribution,
      topics: topicDistribution,
    },
    papers,
  };
}

function summarizePaper(paper, questions, filePath) {
  return {
    filePath,
    status: paper.status ?? "unknown",
    courseCode: paper.source?.courseCode ?? "UNKNOWN",
    courseName: paper.source?.courseName ?? "",
    examYearMonth: paper.source?.examYearMonth ?? "unknown",
    questionCount: questions.length,
    questionTypes: countQuestionTypes(questions).items,
    topics: countQuestionTopics(questions, []).primary.items,
  };
}

function countQuestionTypes(questions) {
  const counts = new Map();
  for (const question of questions) {
    increment(counts, question.questionTypeTag ?? question.type ?? "unknown");
  }
  return distributionFromCounts(counts, questions.length);
}

function countQuestionTopics(questions, syllabusTopics) {
  const primaryCounts = new Map();
  const primaryPapers = new Map();
  const allTagCounts = new Map();
  const allTagConfidence = new Map();
  const labelById = new Map(syllabusTopics.map((topic) => [topic.id, topic.label]));
  let unknownQuestionCount = 0;

  for (const question of questions) {
    const tags = Array.isArray(question.topicTags) ? question.topicTags : [];
    if (tags.length === 0) {
      unknownQuestionCount += 1;
      continue;
    }

    const primary = tags[0];
    const primaryId = String(primary.topicId ?? "unknown");
    labelById.set(primaryId, primary.label ?? primaryId);
    increment(primaryCounts, primaryId);
    addPaper(primaryPapers, primaryId, question.paperPath ?? question.source?.pdfPath ?? "unknown");

    for (const tag of tags) {
      const topicId = String(tag.topicId ?? "unknown");
      labelById.set(topicId, tag.label ?? topicId);
      increment(allTagCounts, topicId);
      allTagConfidence.set(
        topicId,
        Number((allTagConfidence.get(topicId) ?? 0) + Number(tag.confidence ?? 0)),
      );
    }
  }

  const primary = distributionFromCounts(primaryCounts, questions.length, {
    labelById,
    paperSets: primaryPapers,
  });
  const allTags = distributionFromCounts(allTagCounts, questions.length, {
    labelById,
    confidenceTotals: allTagConfidence,
  });
  const coveredTopicIds = new Set(allTags.items.map((item) => item.id));

  return {
    primary,
    allTags,
    unknownQuestionCount,
    uncoveredTopics: syllabusTopics
      .filter((topic) => !coveredTopicIds.has(topic.id))
      .map((topic) => ({ id: topic.id, label: topic.label })),
  };
}

function summarizeQuestionPositions(questions) {
  const byPosition = new Map();
  for (const question of questions) {
    const key = String(question.questionNo ?? "unknown");
    const bucket = byPosition.get(key) ?? {
      questionNo: key,
      questionCount: 0,
      typeCounts: new Map(),
      topicCounts: new Map(),
      topicLabels: new Map(),
    };
    bucket.questionCount += 1;
    increment(bucket.typeCounts, question.questionTypeTag ?? question.type ?? "unknown");
    const primary = Array.isArray(question.topicTags) ? question.topicTags[0] : null;
    const topicId = primary?.topicId ?? "unknown";
    increment(bucket.topicCounts, topicId);
    bucket.topicLabels.set(topicId, primary?.label ?? "unknown");
    byPosition.set(key, bucket);
  }

  return [...byPosition.values()]
    .sort((a, b) => naturalCompare(a.questionNo, b.questionNo))
    .map((bucket) => ({
      questionNo: bucket.questionNo,
      questionCount: bucket.questionCount,
      commonTypes: topItems(distributionFromCounts(bucket.typeCounts, bucket.questionCount).items, 3),
      commonPrimaryTopics: topItems(
        distributionFromCounts(bucket.topicCounts, bucket.questionCount, {
          labelById: bucket.topicLabels,
        }).items,
        3,
      ),
    }));
}

async function readCourseTopics(courseCode) {
  const filePath = path.resolve(path.join(COURSE_TOPICS_DIR, `${courseCode}.topics.json`));
  try {
    const raw = JSON.parse(await readFile(filePath, "utf8"));
    return {
      path: filePath,
      status: raw.status ?? "missing",
      topics: Array.isArray(raw.topics) ? raw.topics : [],
    };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return {
      path: filePath,
      status: "missing",
      topics: [],
    };
  }
}

async function listQuestionFiles(courseDir) {
  try {
    const names = await readdir(courseDir);
    return names
      .filter((name) => name.endsWith(".questions.json"))
      .sort(naturalCompare)
      .map((name) => path.resolve(path.join(courseDir, name)));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function listExtractedCourses() {
  const names = await readdir(EXTRACTED_DIR, { withFileTypes: true });
  const courseNames = names
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !["course-analysis", "course-topics"].includes(name))
    .sort(naturalCompare);
  const courses = [];
  for (const courseName of courseNames) {
    const questionFiles = await listQuestionFiles(path.join(EXTRACTED_DIR, courseName));
    if (questionFiles.length > 0) courses.push(courseName);
  }
  return courses;
}

function distributionFromCounts(counts, denominator, options = {}) {
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const items = [...counts.entries()]
    .map(([id, count]) => {
      const item = {
        id,
        label: options.labelById?.get(id) ?? id,
        count,
        shareOfQuestions: denominator > 0 ? round(count / denominator) : 0,
        shareOfTaggedItems: total > 0 ? round(count / total) : 0,
      };
      const paperSet = options.paperSets?.get(id);
      if (paperSet) item.paperCount = paperSet.size;
      const confidenceTotal = options.confidenceTotals?.get(id);
      if (confidenceTotal !== undefined) item.averageConfidence = round(confidenceTotal / count);
      return item;
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return {
    total,
    denominator,
    items,
  };
}

function summarizeNumbers(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  const counts = new Map();
  for (const value of sorted) increment(counts, String(value));
  const mode = [...counts.entries()].sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]))[0];

  return {
    min: sorted[0] ?? 0,
    max: sorted.at(-1) ?? 0,
    average: sorted.length > 0 ? round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length) : 0,
    median: median(sorted),
    mode: mode ? Number(mode[0]) : 0,
  };
}

function median(sorted) {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return round((sorted[mid - 1] + sorted[mid]) / 2);
}

function topItems(items, limit) {
  return items.slice(0, limit);
}

function hasTopicTags(question) {
  return Array.isArray(question.topicTags) && question.topicTags.length > 0;
}

function increment(map, key, amount = 1) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function addPaper(map, key, paperPath) {
  const set = map.get(key) ?? new Set();
  set.add(paperPath);
  map.set(key, set);
}

function firstNonEmpty(values) {
  return values.find((value) => typeof value === "string" && value.trim()) ?? "";
}

function normalizeCourseCode(value) {
  return String(value ?? "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

function naturalCompare(left, right) {
  return String(left).localeCompare(String(right), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function round(value) {
  return Number(value.toFixed(4));
}

function parseArgs(args) {
  const parsed = { _: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      parsed._.push(arg);
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

function printHelp() {
  console.log(`Usage:
  node scripts/analyze-course-patterns.mjs --course COMP3251
  node scripts/analyze-course-patterns.mjs --all

Options:
  --course COURSE   Course code to analyze, e.g. COMP3251.
  --all             Analyze every course under extracted/.
  --out-dir PATH    Optional output directory. Default: extracted/{course}/{course}.analysis.json.`);
}
