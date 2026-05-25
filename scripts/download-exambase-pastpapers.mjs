#!/usr/bin/env node

import { mkdir, writeFile, readFile, access, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SESSION_FILE = path.resolve(".exambase-session.json");

const DEFAULT_BASE_URL =
  "https://eproxy.lib.hku.hk/login?url=https://exambase.lib.hku.hk/";

// 匹配 exambase 页面的多种 URL 模式
// 包括: exambase.lib.hku.hk 或 exambase-lib-hku-hk.eproxy.lib.hku.hk
const EXAMBASE_URL_PATTERN = /exambase[.-]lib[.-]hku[.-]hk/i;

const argv = parseArgs(process.argv.slice(2));
const coursePrefix = (argv.prefix ?? "COMP").toUpperCase();
const outDir = path.resolve(argv.out ?? "downloads");
const username = argv.username ?? process.env.HKU_USERNAME;
const password = argv.password ?? process.env.HKU_PASSWORD;
const baseUrl = argv.baseUrl ?? DEFAULT_BASE_URL;
const headless = !argv.headful;
const dryRun = Boolean(argv.dryRun);
const limit = argv.limit ? Number(argv.limit) : undefined;
const saveSession = !argv.noSaveSession;
const useSession = !argv.noSession;

if (argv.help) {
  printHelp();
  process.exit(0);
}

if (!username || !password) {
  console.error(
    "Missing credentials. Pass --username/--password or set HKU_USERNAME/HKU_PASSWORD.",
  );
  process.exit(1);
}

const { chromium } = await loadPlaywright();

await mkdir(outDir, { recursive: true });

// 检查是否有保存的会话
const hasSession = useSession && await fileExists(SESSION_FILE);
if (hasSession) {
  console.log("📝 发现已保存的登录会话，将尝试复用...");
  console.log("   (如需重新登录，请删除 .exambase-session.json 或使用 --no-session)");
}

const browser = await chromium.launch({ headless });

// 尝试加载保存的会话
const contextOptions = {
  acceptDownloads: true,
  viewport: { width: 1440, height: 1000 },
};

if (hasSession) {
  try {
    const sessionData = await readFile(SESSION_FILE, "utf-8");
    contextOptions.storageState = JSON.parse(sessionData);
  } catch (e) {
    console.warn("⚠️  会话文件损坏，将重新登录");
  }
}

const context = await browser.newContext(contextOptions);
const page = await context.newPage();

try {
  // 检查是否已经有有效会话
  const needsLogin = !hasSession || !(await checkValidSession(page, baseUrl));
  
  if (needsLogin) {
    await login(page, { baseUrl, username, password });
    
    // 保存会话以便下次使用
    if (saveSession) {
      await saveSessionState(context);
    }
  } else {
    console.log("✅ 会话有效，跳过登录");
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(
      () => {},
    );
  }
  console.log(`🔍 正在发现 ${coursePrefix} 课程...`);
  const courseLinks = await discoverCourseLinks(page, coursePrefix);
  const selectedCourses = Number.isFinite(limit)
    ? courseLinks.slice(0, limit)
    : courseLinks;

  if (courseLinks.length === 0) {
    console.log(`\n⚠️  未找到任何 ${coursePrefix} 课程。`);
    console.log("   可能的原因:");
    console.log("   1. 该前缀没有课程 (尝试其他前缀如 MATH, STAT)");
    console.log("   2. 页面结构变化，需要更新脚本");
    console.log("   3. 运行调试查看详情: npm run download:debug:courses\n");
  } else {
    console.log(`✅ 找到 ${courseLinks.length} 个 ${coursePrefix} 课程页面。`);
  }
  if (dryRun) {
    for (const course of selectedCourses) {
      console.log(`${course.code}\t${course.url}`);
    }
    process.exit(0);
  }

  let saved = 0;
  for (const course of selectedCourses) {
    const courseDir = path.join(outDir, safePathSegment(course.code));
    if (await isNonEmptyDirectory(courseDir)) {
      console.log(`\n[${course.code}] 已存在非空目录，跳过: ${path.relative(process.cwd(), courseDir)}`);
      continue;
    }

    await mkdir(courseDir, { recursive: true });

    console.log(`\n[${course.code}] ${course.url}`);
    await page.goto(course.url, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(
      () => {},
    );

    const paperLinks = await collectPaperLinks(page);
    console.log(`  Found ${paperLinks.length} paper links.`);

    for (const paper of paperLinks) {
      const filename = buildFilename(course.code, paper);
      const target = path.join(courseDir, filename);
      const ok = await downloadPaper(context, page, paper, target);
      if (ok) {
        saved += 1;
        console.log(`  Saved ${path.relative(process.cwd(), target)}`);
      } else {
        console.warn(`  Skipped ${paper.title} (${paper.url})`);
      }
    }
  }

  console.log(`\nDone. Saved ${saved} files into ${outDir}`);
} finally {
  await browser.close();
}

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch (error) {
    console.error(
      [
        "This script needs Playwright.",
        "Install it with:",
        "  npm install --save-dev playwright",
        "  npx playwright install chromium",
        "",
        `Original error: ${error.message}`,
      ].join("\n"),
    );
    process.exit(1);
  }
}

async function login(page, { baseUrl, username, password }) {
  console.log(`\n🌐 正在打开 ${baseUrl}`);
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

  const usernameInput = page
    .locator(
      'input[type="email"], input[name*="user" i], input[id*="user" i], input[name*="login" i], input[id*="login" i], input[name="j_username"], input[name="username"]',
    )
    .first();
  const passwordInput = page
    .locator(
      'input[type="password"], input[name="j_password"], input[name="password"]',
    )
    .first();

  await usernameInput.waitFor({ timeout: 30_000 });
  console.log("🔑 正在输入登录凭证...");
  await usernameInput.fill(username);
  await passwordInput.fill(password);

  await Promise.all([
    page.waitForLoadState("domcontentloaded").catch(() => {}),
    page
      .locator(
        'button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Sign in"), input[value*="Login" i], input[value*="Sign in" i]',
      )
      .first()
      .click(),
  ]);

  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(
    () => {},
  );
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});

  const atExambase = EXAMBASE_URL_PATTERN.test(page.url());
  // 检查页面上是否仍有登录表单（密码输入框），若不可见则视为已登录
  const loginForm = page.locator('input[type="password"]').first();
  const loginFormVisible = await loginForm.isVisible({ timeout: 3_000 }).catch(() => false);

  if (!atExambase && loginFormVisible) {
    console.log("\n" + "=".repeat(60));
    console.log("🔐 需要双因素认证 (2FA)");
    console.log("=".repeat(60));
    console.log("请在浏览器中完成 2FA 验证：");
    console.log("  1. 检查你的手机 Duo Push 通知");
    console.log("  2. 或在浏览器中选择其他验证方式");
    console.log("\n⏳ 等待认证中... (最长 3 分钟)");
    console.log("=".repeat(60) + "\n");

    await page.waitForURL(EXAMBASE_URL_PATTERN, { timeout: 180_000 });
    console.log("✅ 2FA 验证成功！\n");
  } else if (atExambase) {
    console.log("✅ 已跳转到 Exambase，登录成功。\n");
  } else {
    console.log("✅ 未检测到登录表单，假定已登录，继续进行后续操作。\n");
  }

  // 确保后续流程在目标站点或 baseUrl 上运行：若当前不在 Exambase 域，尝试导航到 baseUrl
  try {
    if (!EXAMBASE_URL_PATTERN.test(page.url())) {
      console.log(`➡️ 尝试导航到 ${baseUrl} 以确保页面结构一致...`);
      await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
      console.log(`➡️ 当前页面 URL: ${page.url()}`);
    }
  } catch (e) {
    console.warn("⚠️ 导航到 baseUrl 时出错（忽略并继续）:", e.message);
  }

  // 若登录后未在 Exambase 展示页，尝试导航到常见的展示页路径
  try {
    const currentUrl = page.url();
    const origin = new URL(currentUrl).origin;
    const exhibitsHome = `${origin}/exhibits/show/exam/home`;
    const exhibitsCourse = `${origin}/exhibits/show/exam/course`;

    if (/exhibits\/show\/exam\/(home|course)/i.test(currentUrl)) {
      console.log("➡️ 已在 Exambase 展示页，继续搜索。");
    } else {
      console.log(`➡️ 尝试导航到 Exambase 展示页: ${exhibitsHome}`);
      await page.goto(exhibitsHome, { waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
      console.log(`➡️ 当前页面 URL: ${page.url()}`);

      // 如果仍然不是 home 或 course，尝试 course 路径
      if (!/exhibits\/show\/exam\/(home|course)/i.test(page.url())) {
        console.log(`➡️ home 未命中，尝试导航到 ${exhibitsCourse}`);
        await page.goto(exhibitsCourse, { waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => {});
        await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
        console.log(`➡️ 当前页面 URL: ${page.url()}`);
      }
    }
  } catch (e) {
    console.warn("⚠️ 跳转到展示页失败（忽略并继续）:", e.message);
  }
}

async function discoverCourseLinks(page, prefix) {
  // 如果已经在 course 列表页，直接从页面收集课程链接并返回
  try {
    const currentUrl = page.url();
    if (/exhibits\/show\/exam\/course/i.test(currentUrl)) {
      console.log('➡️ 当前在 Exambase 课程列表页');
      // 检查是否需要点击字母链接
      await navigateToLetterSection(page, prefix);
      return collectCourseLinks(page, prefix);
    }
  } catch (e) {
    // ignore url parsing errors and continue
  }

  await openBrowseCourseCode(page);

  // 点击 Browse 后，检查是否显示字母列表（A-Z）
  await navigateToLetterSection(page, prefix);

  const links = await collectCourseLinks(page, prefix);
  
  if (links.length > 0) {
    return links;
  }

  // 如果 Browse 页面没有找到，尝试搜索
  console.log(`   Browse 页面未找到课程，尝试搜索前缀 "${prefix}"...`);
  await searchCoursePrefix(page, prefix);
  const searchLinks = await collectCourseLinks(page, prefix);
  return searchLinks;
}

async function navigateToLetterSection(page, prefix) {
  // 检查页面上是否有字母导航链接（A, B, C...）
  const firstLetter = prefix.charAt(0).toUpperCase();
  
  // 在页面上查找字母链接（通过文本内容精确匹配单个字母）
  const letterLinks = await page.locator("a[href]").evaluateAll((anchors, letter) => {
    return anchors
      .filter(a => a.textContent?.trim() === letter)
      .map(a => a.href);
  }, firstLetter);
  
  if (letterLinks.length > 0) {
    console.log(`   点击字母 "${firstLetter}" 链接...`);
    await Promise.all([
      page.waitForLoadState("domcontentloaded").catch(() => {}),
      page.goto(letterLinks[0]),
    ]);
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    console.log(`   当前页面: ${page.url()}`);
    
    // 等待动态内容加载
    await page.waitForTimeout(1500);
    
    // 尝试滚动加载更多内容
    await autoScroll(page);
  }
}

// 自动滚动页面以加载动态内容
async function autoScroll(page) {
  try {
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 300;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;

          if (totalHeight >= scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 100);

        // 最多滚动 5 秒
        setTimeout(() => {
          clearInterval(timer);
          resolve();
        }, 5000);
      });
    });
  } catch (error) {
    if (!/Execution context was destroyed|Target page|closed/i.test(error.message)) {
      throw error;
    }
    await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(
      () => {},
    );
  }

  // 滚动后等待一下
  await page.waitForTimeout(500);
}

async function openBrowseCourseCode(page) {
  const browseLink = page
    .getByRole("link", { name: /browse.*course.*code/i })
    .first();

  if ((await browseLink.count()) > 0) {
    await Promise.all([
      page.waitForLoadState("domcontentloaded").catch(() => {}),
      browseLink.click(),
    ]);
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(
      () => {},
    );
  }
}

async function searchCoursePrefix(page, prefix) {
  const courseCodeRadio = page
    .locator(
      'input[type="radio"][value*="course" i], label:has-text("Course Code") input[type="radio"]',
    )
    .first();
  if ((await courseCodeRadio.count()) > 0) {
    await courseCodeRadio.check().catch(() => {});
  }

  const searchInput = page
    .locator(
      'input[type="search"], input[name*="search" i], input[name*="query" i], input[type="text"]',
    )
    .first();
  const hasSearchInput = await searchInput.isVisible({ timeout: 3_000 }).catch(
    () => false,
  );
  if (!hasSearchInput) {
    console.log("   当前页面没有搜索框，跳过搜索 fallback。");
    return;
  }

  await searchInput.fill(prefix);

  await Promise.all([
    page.waitForLoadState("domcontentloaded").catch(() => {}),
    page
      .locator(
        'button[type="submit"], input[type="submit"], button:has-text("Search"), input[value*="Search" i]',
      )
      .first()
      .click(),
  ]);
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(
    () => {},
  );
}

async function collectCourseLinks(page, prefix) {
  const normalizedPrefix = normalizeCourseCode(prefix);
  const coursePattern = /\b[A-Z]{2,5}\s*\d{4}[A-Z]?\b/gi;
  const seen = new Map();
  let pageNum = 1;
  
  while (true) {
    if (pageNum > 1) {
      console.log(`   📄 正在收集第 ${pageNum} 页的课程...`);
    }
    
    // 等待页面加载
    await page.waitForTimeout(1000);
    await autoScroll(page);
    
    const raw = await page.locator("a[href]").evaluateAll((anchors) =>
      anchors.map((anchor) => ({
        text: anchor.textContent?.replace(/\s+/g, " ").trim() ?? "",
        href: anchor.href,
      })),
    );

    // 从链接文本和 href 提取标准课程号，再按用户输入的 prefix 过滤。
    for (const item of raw) {
      const matches = `${item.text} ${item.href}`.match(coursePattern) ?? [];
      for (const match of matches) {
        const code = normalizeCourseCode(match);
        if (!code.startsWith(normalizedPrefix) || seen.has(code)) {
          continue;
        }

        seen.set(code, { code, url: item.href });
      }
    }
    
    // 检查是否有下一页
    const hasNextPage = await clickNextPage(page);
    if (!hasNextPage) {
      break;
    }
    
    pageNum++;
    
    // 安全限制，最多翻页 50 次
    if (pageNum > 50) {
      console.log("   ⚠️ 达到最大翻页数限制 (50)");
      break;
    }
  }

  return [...seen.values()].sort((a, b) => a.code.localeCompare(b.code));
}

async function clickNextPage(page) {
  // Exambase uses a custom "navBar" with page query links, not standard pagination
  // markup. Prefer the URL-derived next page so we do not depend on active classes.
  const nextByQuery = await getNextPageLinkFromUrl(page);
  if (nextByQuery) {
    await page.goto(nextByQuery, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(
      () => {},
    );
    return true;
  }

  // 策略 1: 使用标准 rel="next" 属性（最可靠）
  const relNext = page.locator('a[rel="next"]').first();
  if (await tryClickLink(relNext, page)) return true;
  
  // 策略 2: 在分页导航容器内查找
  const paginationContainer = page.locator('.pagination, nav[aria-label*="pagination" i], .pager, .page-nav').first();
  if (await paginationContainer.count() > 0) {
    // 在分页容器内查找下一页链接
    const nextInPagination = paginationContainer.locator('a:has-text("Next"), a:has-text(">"), a:has-text("»"), a.next, a[aria-label*="next" i]').first();
    if (await tryClickLink(nextInPagination, page)) return true;
  }
  
  // 策略 3: 通过 aria-label 精确匹配
  const ariaNext = page.locator('a[aria-label="Next"], a[aria-label="next"], a[aria-label="Next Page"]').first();
  if (await tryClickLink(ariaNext, page)) return true;
  
  // 策略 4: 查找包含页码数字的导航，找到当前页码的下一个数字
  const currentPageNum = await getCurrentPageNumber(page);
  if (currentPageNum > 0) {
    const nextPageLink = page.locator(`a:has-text("${currentPageNum + 1}")`).filter({ hasNotText: /\d{3,}/ }).first();
    if (await tryClickLink(nextPageLink, page)) {
      // 验证是否真的翻页了
      await page.waitForTimeout(500);
      const newPageNum = await getCurrentPageNumber(page);
      if (newPageNum === currentPageNum + 1) {
        return true;
      }
    }
  }
  
  return false;
}

async function getNextPageLinkFromUrl(page) {
  const currentPage = getPageNumberFromUrl(page.url());
  const nextPage = currentPage + 1;

  return page.locator("a[href]").evaluateAll((anchors, pageNumber) => {
    for (const anchor of anchors) {
      const href = anchor.href;
      try {
        const url = new URL(href);
        if (url.searchParams.get("page") === String(pageNumber)) {
          return href;
        }
      } catch {
        // Ignore non-URL href values.
      }
    }
    return null;
  }, nextPage);
}

function getPageNumberFromUrl(url) {
  try {
    const value = new URL(url).searchParams.get("page");
    const pageNumber = Number.parseInt(value ?? "1", 10);
    return Number.isFinite(pageNumber) && pageNumber > 0 ? pageNumber : 1;
  } catch {
    return 1;
  }
}

async function tryClickLink(link, page) {
  if (await link.count() === 0) return false;
  
  const isVisible = await link.isVisible().catch(() => false);
  if (!isVisible) return false;
  
  // 检查是否被禁用
  const isDisabled = await link.evaluate(el => 
    el.hasAttribute('disabled') || 
    el.classList.contains('disabled') ||
    el.getAttribute('aria-disabled') === 'true' ||
    el.closest('.disabled') !== null
  ).catch(() => false);
  
  if (isDisabled) return false;
  
  // 验证 URL 不会跳转到课程详情页（避免误点课程链接）
  const href = await link.getAttribute('href').catch(() => '');
  // 如果链接看起来是课程链接（包含课程代码模式），则跳过
  if (/[A-Z]{2,4}\d{4}/i.test(href) && !href.includes('page') && !href.includes('offset')) {
    return false;
  }
  
  try {
    await Promise.all([
      page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => {}),
      link.click(),
    ]);
    await page.waitForTimeout(1000);
    return true;
  } catch {
    return false;
  }
}

async function getCurrentPageNumber(page) {
  try {
    // 尝试找到当前页码（通常有 active/current 类）
    const currentPage = await page.locator('.active, .current, [aria-current="page"]').first();
    if (await currentPage.count() > 0) {
      const text = await currentPage.textContent().catch(() => '');
      const num = parseInt(text.trim());
      if (!isNaN(num) && num > 0 && num < 100) return num;
    }
    return 0;
  } catch {
    return 0;
  }
}

async function collectPaperLinks(page) {
  const raw = await page.locator('a[href*=".pdf" i]').evaluateAll((anchors) =>
    anchors.map((anchor) => {
      const rowText =
        anchor.closest("tr")?.textContent?.replace(/\s+/g, " ").trim() ?? "";
      const date =
        rowText.match(/Exam date \(d-m-yyyy\):\s*([0-9]{1,2}-[0-9]{1,2}-[0-9]{4})/i)?.[1] ??
        "";

      return {
        date,
        title: anchor.textContent?.replace(/\s+/g, " ").trim() ?? "",
        url: anchor.href,
      };
    }),
  );

  const seen = new Map();
  for (const link of raw) {
    if (!/\/archive\/files\/.+\.pdf(?:$|[?#])/i.test(link.url) || seen.has(link.url)) {
      continue;
    }

    seen.set(link.url, {
      date: link.date,
      title: link.title || path.basename(new URL(link.url).pathname),
      url: link.url,
    });
  }

  return [...seen.values()];
}

async function downloadPaper(context, page, paper, target) {
  const direct = await fetchPdf(context, paper.url);
  if (direct) {
    await writeFile(target, direct);
    return true;
  }

  const paperPage = await context.newPage();
  try {
    const response = await paperPage.goto(paper.url, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    if (response && isPdfResponse(response.headers())) {
      await writeFile(target, await response.body());
      return true;
    }

    await paperPage.waitForLoadState("networkidle", { timeout: 10_000 }).catch(
      () => {},
    );

    const nestedLinks = await collectPaperLinks(paperPage);
    for (const nested of nestedLinks) {
      const nestedPdf = await fetchPdf(context, nested.url);
      if (nestedPdf) {
        await writeFile(target, nestedPdf);
        return true;
      }
    }

    const download = await clickLikelyDownload(paperPage);
    if (download) {
      await download.saveAs(target);
      return true;
    }
  } finally {
    await paperPage.close().catch(() => {});
    await page.bringToFront().catch(() => {});
  }

  return false;
}

async function fetchPdf(context, url) {
  const response = await context.request.get(url, {
    maxRedirects: 10,
    timeout: 30_000,
  }).catch(() => null);

  if (!response?.ok() || !isPdfResponse(response.headers())) {
    return null;
  }

  return response.body();
}

async function clickLikelyDownload(page) {
  const downloadPromise = page.waitForEvent("download", { timeout: 8_000 }).catch(
    () => null,
  );
  const link = page
    .locator(
      'a[href*=".pdf" i], a:has-text("Download"), a:has-text("Full text"), a:has-text("PDF"), button:has-text("Download")',
    )
    .first();

  if ((await link.count()) === 0) {
    return null;
  }

  await link.click().catch(() => {});
  return downloadPromise;
}

function isPdfResponse(headers) {
  return /application\/pdf|octet-stream/i.test(headers["content-type"] ?? "");
}

function buildFilename(courseCode, paper) {
  const date = formatExamDate(paper.date);
  const code = normalizeCourseCode(courseCode);
  const base = date ? `${date}_${code}` : `unknown_date_${code}`;
  return `${safePathSegment(base)}.pdf`;
}

function formatExamDate(value) {
  const match = String(value ?? "").match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!match) {
    return "";
  }

  const [, day, month, year] = match;
  return `${year}_${month.padStart(2, "0")}_${day.padStart(2, "0")}`;
}

function normalizeCourseCode(value) {
  return String(value).replace(/\s+/g, "").toUpperCase();
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

function printHelp() {
  const script = path.relative(
    process.cwd(),
    fileURLToPath(import.meta.url),
  );
  console.log(`Usage:
  node ${script} --username UID --password PASSWORD [options]

Options:
  --prefix COMP          Course-code prefix to download. Default: COMP
  --out DIR             Output directory. Default: downloads
  --base-url URL        Exambase/eproxy entry URL.
  --headful             Show Chromium, useful for 2FA or debugging.
  --dry-run             List discovered course pages without downloading.
  --limit N             Only process the first N courses.
  --no-session          Do not reuse saved session (force re-login).
  --no-save-session     Do not save session after login.

Environment:
  HKU_USERNAME          Username if --username is omitted.
  HKU_PASSWORD          Password if --password is omitted.

Session:
  Login session is automatically saved to .exambase-session.json
  to avoid repeated 2FA. Delete this file or use --no-session to re-login.`);
}

function safePathSegment(value) {
  const cleaned = String(value)
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return cleaned || "paper";
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 辅助函数：检查文件是否存在
async function fileExists(filepath) {
  try {
    await access(filepath);
    return true;
  } catch {
    return false;
  }
}

async function isNonEmptyDirectory(filepath) {
  try {
    const entries = await readdir(filepath);
    return entries.length > 0;
  } catch {
    return false;
  }
}

// 辅助函数：检查会话是否有效
async function checkValidSession(page, baseUrl) {
  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 10_000 });
    // 检查是否已经在 exambase 页面（支持多种 URL 模式）
    if (EXAMBASE_URL_PATTERN.test(page.url())) {
      return true;
    }
    // 检查是否有登录表单，如果没有可能是已登录状态
    const loginForm = page.locator('input[type="password"]').first();
    return !(await loginForm.isVisible({ timeout: 3_000 }).catch(() => false));
  } catch {
    return false;
  }
}

// 辅助函数：保存会话状态
async function saveSessionState(context) {
  try {
    const storageState = await context.storageState();
    await writeFile(SESSION_FILE, JSON.stringify(storageState, null, 2));
    console.log(`💾 登录会话已保存到 ${SESSION_FILE}`);
    console.log("   下次运行将自动复用此会话\n");
  } catch (e) {
    console.warn("⚠️  无法保存会话:", e.message);
  }
}
