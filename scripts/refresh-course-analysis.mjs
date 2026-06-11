#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = { course: "", help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [flag, inlineValue] = arg.split("=", 2);
    const nextValue = () => {
      if (inlineValue !== undefined) return inlineValue;
      index += 1;
      return argv[index];
    };

    if (flag === "--course") args.course = String(nextValue() ?? "").trim().toUpperCase();
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/refresh-course-analysis.mjs [options]

Options:
  --course <code>   Refresh one course. If omitted, refresh all courses.
  --help            Show this help.
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

function normalizeSupabaseProjectUrl(value) {
  return String(value).trim().replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
}

function createHeaders(key, prefer) {
  return {
    apikey: key,
    "content-type": "application/json",
    ...(key.startsWith("sb_") ? {} : { authorization: `Bearer ${key}` }),
    ...(prefer ? { prefer } : {}),
  };
}

function createClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }
  const restUrl = `${normalizeSupabaseProjectUrl(supabaseUrl)}/rest/v1`;

  async function request(pathname, options = {}) {
    const url = new URL(`${restUrl}/${pathname}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: createHeaders(serviceRoleKey, options.prefer),
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${options.method ?? "GET"} ${url.pathname} failed (${response.status}): ${text}`);
    }
    return text ? JSON.parse(text) : null;
  }

  return { request };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  await loadLocalEnv(process.cwd());
  const client = createClient();
  const courses = args.course
    ? [{ code: args.course }]
    : await client.request("courses", {
        query: { select: "code", order: "code.asc" },
      });

  const results = [];
  for (const course of courses) {
    const analysis = await client.request("rpc/refresh_course_analysis", {
      method: "POST",
      body: { course_query: course.code },
    });
    results.push({
      courseCode: course.code,
      paperCount: analysis?.paperCount ?? 0,
      questionCount: analysis?.questionCount ?? 0,
    });
  }

  console.log(JSON.stringify({ ok: true, refreshed: results }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
