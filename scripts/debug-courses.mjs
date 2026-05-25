#!/usr/bin/env node
/**
 * 调试课程发现脚本
 * 用于查看课程页面上的实际链接和结构
 */

import { writeFile } from "node:fs/promises";

const EXAMBASE_URL_PATTERN = /exambase[.-]lib[.-]hku[.-]hk/i;

async function main() {
  const username = process.env.HKU_USERNAME;
  const password = process.env.HKU_PASSWORD;
  const prefix = process.argv[2] || "COMP";
  
  if (!username || !password) {
    console.error("请先设置环境变量:");
    console.error("  export HKU_USERNAME=你的UID");
    console.error("  export HKU_PASSWORD=你的密码");
    process.exit(1);
  }

  console.log(`🔍 调试课程发现 - 查找前缀: ${prefix}`);
  console.log("=" .repeat(70));
  
  const { chromium } = await import("playwright");
  
  const browser = await chromium.launch({ 
    headless: false,
    slowMo: 50,
  });
  
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1440, height: 1000 },
  });
  
  const page = await context.newPage();
  
  try {
    // 1. 登录
    const baseUrl = "https://eproxy.lib.hku.hk/login?url=https://exambase.lib.hku.hk/";
    console.log("\n📍 步骤 1: 登录");
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    
    await page.locator('input[name*="user" i]').first().fill(username);
    await page.locator('input[type="password"]').first().fill(password);
    await page.locator('input[type="submit"]').first().click();
    
    await page.waitForLoadState("networkidle").catch(() => {});
    console.log(`   当前页面: ${page.url()}`);
    
    // 2. 点击 Browse by Course Code
    console.log("\n📍 步骤 2: 查找 Browse by Course Code 链接");
    const browseLink = page.getByRole("link", { name: /browse.*course.*code/i }).first();
    
    if (await browseLink.count() === 0) {
      console.log("   ❌ 未找到 Browse by Course Code 链接");
      return;
    }
    
    console.log("   ✓ 找到链接，正在点击...");
    await Promise.all([
      page.waitForLoadState("domcontentloaded").catch(() => {}),
      browseLink.click(),
    ]);
    
    await page.waitForLoadState("networkidle").catch(() => {});
    console.log(`   点击后页面: ${page.url()}`);
    
    await page.screenshot({ path: "debug-courses-page.png", fullPage: true });
    console.log("   📸 截图已保存: debug-courses-page.png");
    
    // 3. 点击对应字母链接
    console.log(`\n📍 步骤 3: 点击字母 "${prefix.charAt(0).toUpperCase()}" 链接`);
    
    const firstLetter = prefix.charAt(0).toUpperCase();
    
    // 尝试多种方式查找字母链接
    // 方式 1: 通过 href 查找
    let letterLink = page.locator(`a[href*="letter=${firstLetter}" i]`).filter({ hasText: new RegExp(`^${firstLetter}$`) }).first();
    
    // 方式 2: 通过文本查找
    if (await letterLink.count() === 0) {
      letterLink = page.getByRole("link", { name: new RegExp(`^${firstLetter}$`) }).first();
    }
    
    // 方式 3: 直接通过文本内容查找
    if (await letterLink.count() === 0) {
      const allLinks = await page.locator("a[href]").evaluateAll(anchors =>
        anchors.filter(a => a.textContent?.trim() === firstLetter)
          .map(a => a.href)
      );
      if (allLinks.length > 0) {
        console.log(`   找到 ${allLinks.length} 个字母 ${firstLetter} 的链接`);
        await page.goto(allLinks[0], { waitUntil: "domcontentloaded" });
        console.log(`   导航到: ${page.url()}`);
      } else {
        console.log(`   ❌ 未找到字母 ${firstLetter} 的链接`);
      }
    } else if (await letterLink.isVisible().catch(() => false)) {
      console.log(`   ✓ 找到字母 ${firstLetter} 链接，正在点击...`);
      await Promise.all([
        page.waitForLoadState("domcontentloaded").catch(() => {}),
        letterLink.click(),
      ]);
      await page.waitForLoadState("networkidle").catch(() => {});
      console.log(`   点击后页面: ${page.url()}`);
    } else {
      console.log(`   ❌ 字母 ${firstLetter} 链接不可见`);
    }
    
    await page.screenshot({ path: "debug-courses-letter.png", fullPage: true });
    console.log("   📸 截图已保存: debug-courses-letter.png");
    
    // 等待一下，看是否有动态内容加载
    console.log("   ⏳ 等待 2 秒让动态内容加载...");
    await page.waitForTimeout(2000);
    
    // 4. 分析课程链接（支持分页）
    console.log(`\n📍 步骤 4: 测试课程代码匹配 (前缀: ${prefix})`);
    
    const coursePattern = new RegExp(`\\b${prefix}\\s*\\d{4}[A-Z]?\\b`, "gi");
    const seen = new Map();
    let pageNum = 1;
    
    while (true) {
      console.log(`\n   📄 第 ${pageNum} 页:`);
      
      // 等待动态内容
      await page.waitForTimeout(1000);
      
      const raw = await page.locator("a[href]").evaluateAll((anchors) =>
        anchors.map((anchor) => ({
          text: anchor.textContent?.replace(/\s+/g, " ").trim() ?? "",
          href: anchor.href,
        }))
      );
      
      // 也检查页面文本内容
      const pageText = await page.evaluate(() => document.body.innerText);
      const pageMatches = pageText.match(coursePattern);
      
      if (pageMatches) {
        const uniqueMatches = [...new Set(pageMatches.map(m => m.replace(/\s+/g, "").toUpperCase()))];
        console.log(`      页面中找到 ${uniqueMatches.length} 个课程代码: ${uniqueMatches.slice(0, 10).join(", ")}${uniqueMatches.length > 10 ? '...' : ''}`);
        
        for (const code of uniqueMatches) {
          if (!seen.has(code)) {
            // 查找对应的链接
            const matchingLink = raw.find(item => 
              item.text.includes(code) || item.href.includes(code)
            );
            seen.set(code, { 
              code, 
              url: matchingLink?.href || page.url(),
              text: matchingLink?.text || code
            });
          }
        }
      } else {
        console.log(`      本页没有找到匹配的课程代码`);
      }
      
      // 检查是否有下一页
      const hasNext = await checkHasNextPage(page);
      if (!hasNext) {
        console.log(`      没有更多页面了`);
        break;
      }
      
      console.log(`      点击下一页...`);
      await clickNextPageDebug(page);
      pageNum++;
      
      if (pageNum > 20) {
        console.log(`      达到最大翻页数限制`);
        break;
      }
    }
    
    console.log(`\n   ✅ 总共找到 ${seen.size} 个唯一课程:`);
    const sortedCodes = [...seen.values()].sort((a, b) => a.code.localeCompare(b.code));
    for (const item of sortedCodes) {
      console.log(`      ${item.code}`);
    }
    
    console.log("\n" + "=".repeat(70));
    console.log("调试完成，浏览器保持打开");
    console.log("按 Ctrl+C 结束");
    
  } catch (error) {
    console.error("\n❌ 错误:", error);
    await page.screenshot({ path: "debug-courses-error.png" });
  }
}

async function checkHasNextPage(page) {
  // 策略 1: rel="next"
  let nextLink = page.locator('a[rel="next"]').first();
  if (await isValidNextLink(nextLink)) return true;
  
  // 策略 2: 在分页容器内
  const pagination = page.locator('.pagination, nav[aria-label*="pagination" i]').first();
  if (await pagination.count() > 0) {
    nextLink = pagination.locator('a:has-text("Next"), a:has-text(">")').first();
    if (await isValidNextLink(nextLink)) return true;
  }
  
  return false;
}

async function isValidNextLink(link) {
  if (await link.count() === 0) return false;
  const isVisible = await link.isVisible().catch(() => false);
  if (!isVisible) return false;
  
  const isDisabled = await link.evaluate(el => 
    el.hasAttribute('disabled') || 
    el.classList.contains('disabled') ||
    el.getAttribute('aria-disabled') === 'true'
  ).catch(() => false);
  
  return !isDisabled;
}

async function clickNextPageDebug(page) {
  console.log("      尝试点击下一页...");
  
  // 优先使用 rel="next"
  let nextLink = page.locator('a[rel="next"]').first();
  if (await isValidNextLink(nextLink)) {
    await nextLink.click();
    await page.waitForTimeout(1500);
    return;
  }
  
  // 在分页容器内查找
  const pagination = page.locator('.pagination, nav[aria-label*="pagination" i]').first();
  if (await pagination.count() > 0) {
    nextLink = pagination.locator('a:has-text("Next"), a:has-text(">")').first();
    if (await isValidNextLink(nextLink)) {
      await nextLink.click();
      await page.waitForTimeout(1500);
      return;
    }
  }
  
  console.log("      ⚠️ 未找到有效的下一页按钮");
}

main();
