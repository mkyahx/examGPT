#!/usr/bin/env node

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_DOWNLOADS_DIR = "downloads";
const DEFAULT_OUT_DIR = path.join("extracted", "course-topics");
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_MAX_TOPICS = 12;

const CS_COURSE_YEARS = [
  "2025",
  "2024",
  "2023",
  "2022",
  "2021",
  "2020",
  "2019",
  "2018",
];

const SYLLABUS_LOOKUP_BASES = [
  "https://www4.hku.hk/pubunit/drcd/",
  "https://ug.hkubs.hku.hk/course/",
  "https://www.cs.hku.hk/index.php/programmes/course-offered",
  "https://hkumath.hku.hk/web/course/undergrad",
];

const SECTION_STARTS = [
  { name: "detailed description", pattern: /\bDetailed Description\s*:?\s*/i },
  { name: "course contents", pattern: /\bCourse Contents?\s*:?\s*/i },
  { name: "contents", pattern: /\bContents?\s*:?\s*/i },
  { name: "syllabus", pattern: /\bSyllabus\s*:?\s*/i },
  { name: "topics", pattern: /\bTopics?\s*:?\s*/i },
  { name: "course description", pattern: /\bCourse Description\s*:?\s*/i },
  { name: "calendar entry", pattern: /\bCalendar Entry\s*:?\s*/i },
  { name: "learning outcomes", pattern: /\bLearning Outcomes?\s*:?\s*/i },
];

const SECTION_END =
  /\b(?:Assessment|Teaching Plan|Moodle Course|Course Assessment|Learning Outcomes?|Prerequisites?|Co-requisites?|Credits?|Offer(?:ed)?|Lecture|Tutorial|Examination|Reading List|Textbooks?|Course Learning Outcomes?|CLOs?|Remarks?)\s*:?\s*/i;

const TOPIC_REJECT =
  /\b(?:assessment|assignment|attendance|calendar entry|course code|course title|credit|credits|deadline|examination|grade|grading|lecture|lecturer|mapping|moodle|office hour|prerequisite|quiz|semester|staff|tutorial|venue|weekly hours)\b/i;

const argv = parseArgs(process.argv.slice(2));

if (argv.help) {
  printHelp();
  process.exit(0);
}

const downloadsDir = path.resolve(argv.downloads ?? DEFAULT_DOWNLOADS_DIR);
const outDir = path.resolve(argv.out ?? DEFAULT_OUT_DIR);
const timeoutMs = numberArg(argv.timeoutMs, DEFAULT_TIMEOUT_MS);
const concurrency = Math.max(1, numberArg(argv.concurrency, DEFAULT_CONCURRENCY));
const maxTopics = Math.max(1, numberArg(argv.maxTopics, DEFAULT_MAX_TOPICS));
const overwrite = Boolean(argv.overwrite);
const dryRun = Boolean(argv.dryRun);
const limit = argv.limit ? Math.max(0, numberArg(argv.limit, 0)) : undefined;

const courses = await resolveCourses();
const selectedCourses = typeof limit === "number" ? courses.slice(0, limit) : courses;

if (selectedCourses.length === 0) {
  console.error("No courses found. Pass --course COURSE or make sure downloads/ has course PDFs.");
  process.exit(1);
}

if (dryRun) {
  console.log(`Would fetch topics for ${selectedCourses.length} course(s):`);
  for (const course of selectedCourses) {
    console.log(course);
  }
  process.exit(0);
}

await mkdir(outDir, { recursive: true });

console.log(`Fetching syllabus topics for ${selectedCourses.length} course(s).`);
console.log(`Output: ${path.relative(process.cwd(), outDir) || "."}`);

const results = await runPool(selectedCourses, concurrency, processCourse);
const ready = results.filter((result) => result.status === "ready");
const skipped = results.filter((result) => result.status === "skipped");
const missing = results.filter((result) => result.status === "missing");
const failed = results.filter((result) => result.status === "failed");

console.log("\nDone.");
console.log(
  JSON.stringify(
    {
      courses: results.length,
      ready: ready.length,
      skipped: skipped.length,
      missing: missing.length,
      failed: failed.length,
      readyCourses: ready.map((result) => result.courseCode),
      missingCourses: missing.map((result) => result.courseCode),
      failedCourses: failed.map((result) => result.courseCode),
    },
    null,
    2,
  ),
);

async function processCourse(courseCode) {
  const target = path.join(outDir, `${courseCode}.topics.json`);
  const existing = await readTopicFile(target);
  if (!overwrite && existing?.status === "ready" && Array.isArray(existing.topics) && existing.topics.length > 0) {
    console.log(`[${courseCode}] skipped existing ready file`);
    return { courseCode, status: "skipped", topics: existing.topics.length, target };
  }

  try {
    const syllabus = await fetchCourseSyllabus(courseCode);
    const payload = {
      courseCode,
      courseName: syllabus.courseName,
      status: syllabus.topics.length > 0 ? "ready" : "missing",
      source: "online-syllabus-lookup",
      ...(syllabus.sourceUrl ? { sourceUrl: syllabus.sourceUrl } : {}),
      searchedUrls: syllabus.searchedUrls,
      extractedAt: new Date().toISOString(),
      ...(syllabus.error ? { error: syllabus.error } : {}),
      topics: syllabus.topics,
    };

    await writeFile(target, `${JSON.stringify(payload, null, 2)}\n`);
    const relativeTarget = path.relative(process.cwd(), target);
    if (payload.status === "ready") {
      console.log(`[${courseCode}] ready ${payload.topics.length} topic(s) -> ${relativeTarget}`);
      return { courseCode, status: "ready", topics: payload.topics.length, target };
    }

    console.log(`[${courseCode}] missing topics -> ${relativeTarget}`);
    return { courseCode, status: "missing", topics: 0, target };
  } catch (error) {
    const payload = {
      courseCode,
      courseName: "",
      status: "failed",
      source: "online-syllabus-lookup",
      searchedUrls: buildSyllabusLookupUrls(courseCode),
      extractedAt: new Date().toISOString(),
      error: error?.message ?? String(error),
      topics: [],
    };
    await writeFile(target, `${JSON.stringify(payload, null, 2)}\n`);
    console.warn(`[${courseCode}] failed: ${payload.error}`);
    return { courseCode, status: "failed", topics: 0, target };
  }
}

async function fetchCourseSyllabus(courseCode) {
  const normalizedCourse = normalizeCourseCode(courseCode);
  const acceptableCourseCodes = [
    normalizedCourse,
    normalizedCourse.replace(/[A-Z]$/, ""),
  ].filter((value, index, list) => value && list.indexOf(value) === index);
  const searchedUrls = buildSyllabusLookupUrls(normalizedCourse);
  const errors = [];

  for (const url of searchedUrls) {
    try {
      const response = await fetchWithTimeout(url, timeoutMs);
      if (!response.ok) {
        errors.push(`${url}: HTTP ${response.status}`);
        continue;
      }

      const html = await response.text();
      const text = stripHtml(html);
      const focusedText = focusCourseText(text, acceptableCourseCodes);
      const upperFocused = focusedText.toUpperCase();
      if (!acceptableCourseCodes.some((code) => upperFocused.includes(code))) {
        continue;
      }

      const courseName = extractCourseName(focusedText, normalizedCourse);
      const topics = summarizeTopics(normalizedCourse, courseName, focusedText, maxTopics);
      if (topics.length > 0) {
        return {
          courseCode: normalizedCourse,
          courseName,
          sourceUrl: url,
          searchedUrls,
          topics,
        };
      }
    } catch (error) {
      errors.push(`${url}: ${error?.message ?? String(error)}`);
    }
  }

  return {
    courseCode: normalizedCourse,
    courseName: "",
    searchedUrls,
    topics: [],
    error:
      errors.length > 0
        ? `No extractable topics found. Last errors: ${errors.slice(-3).join(" | ")}`
        : "No HKU syllabus page with extractable topics was found.",
  };
}

async function fetchWithTimeout(url, timeout) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "ExamGPT-HKU syllabus topic fetcher",
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildSyllabusLookupUrls(courseCode) {
  const urls = [];
  if (/^COMP\d{4}[A-Z]?$/.test(courseCode)) {
    const variants = [
      courseCode,
      courseCode.replace(/[A-Z]$/, ""),
    ].filter((value, index, list) => value && list.indexOf(value) === index);

    for (const variant of variants) {
      const lower = variant.toLowerCase();
      for (const year of CS_COURSE_YEARS) {
        urls.push(
          `https://www.cs.hku.hk/index.php/programmes/course-offered?infile=${year}%2F${lower}.html`,
        );
      }
    }
  }

  for (const base of SYLLABUS_LOOKUP_BASES) {
    const url = new URL(base);
    url.searchParams.set("q", courseCode);
    urls.push(url.toString());
  }

  return [...new Set(urls)];
}

function summarizeTopics(courseCode, courseName, text, limit) {
  const sections = extractTopicSections(text);
  const topics = [];
  const seen = new Set();

  for (const section of sections) {
    for (const candidate of splitTopicCandidates(section.text)) {
      addTopic(topics, seen, {
        courseCode,
        label: candidate,
        description: `${candidate} (${courseCode} ${section.name})`,
      });
      if (topics.length >= limit) return topics;
    }
  }

  for (const candidate of sentenceCandidates(text, courseCode, courseName)) {
    addTopic(topics, seen, {
      courseCode,
      label: candidate.label,
      description: candidate.description,
    });
    if (topics.length >= limit) break;
  }

  return topics;
}

function extractTopicSections(text) {
  const sections = [];
  for (const start of SECTION_STARTS) {
    const match = text.match(start.pattern);
    if (!match || typeof match.index !== "number") continue;

    const startIndex = match.index + match[0].length;
    const tail = text.slice(startIndex);
    const endMatch = tail.match(SECTION_END);
    const endIndex =
      endMatch && typeof endMatch.index === "number" && endMatch.index > 80
        ? endMatch.index
        : Math.min(tail.length, 5000);
    const sectionText = tail.slice(0, endIndex).trim();
    if (sectionText.length < 20) continue;
    sections.push({ name: start.name, text: sectionText });
  }

  if (sections.length > 0) return sections;
  return [{ name: "course page", text: text.slice(0, 7000) }];
}

function splitTopicCandidates(text) {
  const normalized = text
    .replace(/\r/g, "\n")
    .replace(/[•●▪◦]/g, "\n")
    .replace(/\b(?:\d+|[a-z])\)\s+/gi, "\n")
    .replace(/\b(?:\d+|[a-z])\.\s+/gi, "\n");

  const rawPieces = normalized
    .split(/\n+|;|(?<=[.!?])\s+/)
    .flatMap((piece) => splitLongList(piece))
    .map((piece) => cleanTopicLabel(piece))
    .filter(looksLikeTopic);

  const seen = new Set();
  const candidates = [];
  for (const piece of rawPieces) {
    const id = slugify(piece);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    candidates.push(piece);
  }
  return candidates;
}

function splitLongList(value) {
  const cleaned = String(value).replace(/\s+/g, " ").trim();
  if (cleaned.length <= 120) return [cleaned];
  return cleaned
    .split(/,\s+|\s+\band\b\s+|\s+\bor\b\s+/i)
    .map((piece) => piece.trim())
    .filter((piece) => piece.length >= 4);
}

function sentenceCandidates(text, courseCode, courseName) {
  const ignored = new Set([
    slugify(courseCode),
    slugify(courseName),
  ]);

  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => cleanTopicLabel(part))
    .filter(looksLikeTopic)
    .filter((part) => !ignored.has(slugify(part)))
    .map((part) => ({
      label: part.slice(0, 90),
      description: `${part} (${courseCode} syllabus summary)`,
    }));
}

function addTopic(topics, seen, { courseCode, label, description }) {
  const cleanedLabel = cleanTopicLabel(label);
  if (!looksLikeTopic(cleanedLabel)) return;
  const id = slugify(cleanedLabel);
  if (!id || seen.has(id)) return;
  seen.add(id);
  topics.push({
    id,
    label: cleanedLabel,
    description: description || `${cleanedLabel} (${courseCode} syllabus topic)`,
  });
}

function cleanTopicLabel(value) {
  return String(value ?? "")
    .replace(/\b(?:Detailed Description|Course Contents?|Contents?|Syllabus|Topics?|Course Description|Calendar Entry|Learning Outcomes?)\b\s*:?\s*/gi, " ")
    .replace(/\b(?:This course|The course|Students|Student|Candidates?)\s+(?:will|are expected to|should|learn|covers?|introduces?|provides?)\b/gi, " ")
    .replace(/\b(?:covers?|covering|includes?|including|such as|with emphasis on|is designed to|aims? to)\b/gi, " ")
    .replace(/\b(?:Mapped to CLOs?|CLOs?)\b/gi, " ")
    .replace(/\b[A-Z]{2,5}\s*\d{4}[A-Z]?\b/g, " ")
    .replace(/^[\s:;,.()[\]-]+/, "")
    .replace(/[\s:;,.()[\]-]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeTopic(value) {
  const text = String(value ?? "").trim();
  if (text.length < 4 || text.length > 120) return false;
  if (!/[A-Za-z]{4}/.test(text)) return false;
  if (TOPIC_REJECT.test(text)) return false;
  if (/^(and|or|the|to|of|for|with|from|introduction)$/i.test(text)) return false;
  if (/^(course|module|students?|able to|understand|appreciate|describe|explain)\b/i.test(text)) return false;
  if (/^(basic|advanced)?\s*algorithm design technique$/i.test(text)) return false;
  return true;
}

function extractCourseName(text, courseCode) {
  const spacedCode = courseCode.replace(/([A-Z]+)(\d+)/, "$1\\s*$2");
  const patterns = [
    /\bCourse Title\s*:?\s*([^\n]{4,140})/i,
    new RegExp(`\\b${spacedCode}\\b\\s*[-:]*\\s*([^\\n]{4,140})`, "i"),
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = cleanCourseName(match?.[1] ?? "");
    if (value) return value;
  }

  return "";
}

function cleanCourseName(value) {
  const cleaned = String(value ?? "")
    .replace(/\b(?:Course Code|Credits?|Units?|Semester|Assessment|Prerequisites?).*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.;:,]+$/g, "")
    .trim();
  if (cleaned.length < 4 || cleaned.length > 100) return "";
  if (/course code|http|www\.|search results/i.test(cleaned)) return "";
  return cleaned;
}

function focusCourseText(text, acceptableCourseCodes) {
  const upperText = text.toUpperCase();
  let bestIndex = -1;
  for (const code of acceptableCourseCodes) {
    const spaced = code.replace(/([A-Z]+)(\d+)/, "$1 $2");
    const candidates = [code, spaced];
    for (const candidate of candidates) {
      const index = upperText.indexOf(candidate.toUpperCase());
      if (index >= 0 && (bestIndex < 0 || index < bestIndex)) {
        bestIndex = index;
      }
    }
  }

  if (bestIndex < 0) return text.slice(0, 9000);
  return text.slice(Math.max(0, bestIndex - 1200), bestIndex + 9000);
}

function stripHtml(html) {
  return String(html ?? "")
    .replace(/<(?:br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

async function resolveCourses() {
  const explicitCourses = getArgList(argv.course)
    .concat(argv._ ?? [])
    .flatMap((value) => String(value).split(","))
    .map(normalizeCourseCode)
    .filter(Boolean);

  if (explicitCourses.length > 0) {
    return [...new Set(explicitCourses)].sort(naturalCompare);
  }

  const entries = await readdir(downloadsDir, { withFileTypes: true });
  const courses = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const courseCode = normalizeCourseCode(entry.name);
    if (!courseCode) continue;
    const courseDir = path.join(downloadsDir, entry.name);
    const files = await readdir(courseDir, { withFileTypes: true });
    if (files.some((file) => file.isFile() && file.name.toLowerCase().endsWith(".pdf"))) {
      courses.push(courseCode);
    }
  }

  return [...new Set(courses)].sort(naturalCompare);
}

async function readTopicFile(filepath) {
  try {
    return JSON.parse(await readFile(filepath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function runPool(items, workerCount, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(workerCount, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
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
    const value =
      inlineValue !== undefined
        ? inlineValue
        : !next || next.startsWith("--")
          ? true
          : next;
    if (inlineValue === undefined && next && !next.startsWith("--")) {
      index += 1;
    }
    assignArg(parsed, camelKey, value);
  }
  return parsed;
}

function assignArg(target, key, value) {
  if (target[key] === undefined) {
    target[key] = value;
    return;
  }
  target[key] = Array.isArray(target[key]) ? [...target[key], value] : [target[key], value];
}

function getArgList(value) {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function numberArg(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeCourseCode(value) {
  return String(value ?? "").replace(/\s+/g, "").trim().toUpperCase();
}

function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function naturalCompare(left, right) {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function printHelp() {
  const script = path.relative(process.cwd(), fileURLToPath(import.meta.url));
  console.log(`Usage:
  node ${script} [options]
  npm run topics:fetch -- [options]

Options:
  --course COURSE        Fetch one course. Repeat or comma-separate for many.
  --downloads DIR        Downloads directory to scan. Default: downloads
  --out DIR              Output directory. Default: extracted/course-topics
  --overwrite            Refresh existing ready topics files.
  --limit N              Only process first N courses after sorting.
  --concurrency N        Number of courses to fetch in parallel. Default: 4
  --timeout-ms N         Per-page fetch timeout. Default: 5000
  --max-topics N         Max topics per course. Default: 12
  --dry-run              List courses without fetching.

Output:
  extracted/course-topics/{COURSE}.topics.json

The output shape is compatible with npm run extract:questions.`);
}
