#!/usr/bin/env node
/**
 * 调试登录脚本 - 用于排查登录问题
 * 使用方式: node scripts/debug-login.mjs --headful
 */

import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const DEFAULT_BASE_URL =
  "https://eproxy.lib.hku.hk/login?url=https://exambase.lib.hku.hk/";

// 匹配 exambase 页面的多种 URL 模式
const EXAMBASE_URL_PATTERN = /exambase[.-]lib[.-]hku[.-]hk/i;

async function main() {
  const username = process.env.HKU_USERNAME;
  const password = process.env.HKU_PASSWORD;
  
  if (!username || !password) {
    console.error("请先设置环境变量:");
    console.error("  export HKU_USERNAME=你的UID");
    console.error("  export HKU_PASSWORD=你的密码");
    process.exit(1);
  }

  console.log("🔧 调试模式启动");
  console.log("=" .repeat(60));
  
  const { chromium } = await loadPlaywright();
  
  const browser = await chromium.launch({ 
    headless: false,  // 强制显示浏览器
    slowMo: 100,      // 慢动作，便于观察
  });
  
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1440, height: 1000 },
  });
  
  const page = await context.newPage();
  
  try {
    // 步骤 1: 打开登录页
    console.log("\n📍 步骤 1: 打开登录页面");
    console.log(`   URL: ${DEFAULT_BASE_URL}`);
    await page.goto(DEFAULT_BASE_URL, { waitUntil: "domcontentloaded" });
    console.log(`   当前页面: ${page.url()}`);
    
    await page.screenshot({ path: "debug-01-initial.png" });
    console.log("   📸 截图已保存: debug-01-initial.png");
    
    // 等待一下看看是否会自动跳转
    console.log("\n⏳ 等待 3 秒观察页面跳转...");
    await page.waitForTimeout(3000);
    console.log(`   当前页面: ${page.url()}`);
    
    // 步骤 2: 检查是否已经在 exambase
    if (page.url().includes("exambase.lib.hku.hk")) {
      console.log("\n✅ 已经登录到 Exambase，无需输入密码！");
      await analyzeExambasePage(page);
      return;
    }
    
    // 步骤 3: 查找登录表单
    console.log("\n📍 步骤 2: 查找登录表单");
    
    const usernameSelectors = [
      'input[type="email"]',
      'input[name*="user" i]',
      'input[id*="user" i]',
      'input[name*="login" i]',
      'input[id*="login" i]',
      'input[name="j_username"]',
      'input[name="username"]',
      'input#username',
      'input#login',
    ];
    
    const passwordSelectors = [
      'input[type="password"]',
      'input[name="j_password"]',
      'input[name="password"]',
      'input#password',
    ];
    
    let usernameInput = null;
    let passwordInput = null;
    
    for (const selector of usernameSelectors) {
      const el = page.locator(selector).first();
      if (await el.count() > 0 && await el.isVisible().catch(() => false)) {
        usernameInput = el;
        console.log(`   ✓ 找到用户名输入框: ${selector}`);
        break;
      }
    }
    
    for (const selector of passwordSelectors) {
      const el = page.locator(selector).first();
      if (await el.count() > 0 && await el.isVisible().catch(() => false)) {
        passwordInput = el;
        console.log(`   ✓ 找到密码输入框: ${selector}`);
        break;
      }
    }
    
    if (!usernameInput || !passwordInput) {
      console.log("\n❌ 未找到登录表单，页面内容:");
      const content = await page.content();
      console.log(content.substring(0, 2000));
      await page.screenshot({ path: "debug-02-no-form.png", fullPage: true });
      return;
    }
    
    // 步骤 4: 输入凭证
    console.log("\n📍 步骤 3: 输入登录凭证");
    await usernameInput.fill(username);
    console.log("   ✓ 用户名已输入");
    await passwordInput.fill(password);
    console.log("   ✓ 密码已输入");
    
    await page.screenshot({ path: "debug-03-filled.png" });
    console.log("   📸 截图已保存: debug-03-filled.png");
    
    // 步骤 5: 点击登录按钮
    console.log("\n📍 步骤 4: 点击登录按钮");
    const submitSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Login")',
      'button:has-text("Sign in")',
      'input[value*="Login" i]',
      'input[value*="Sign in" i]',
      'button#submit',
      'button.login',
    ];
    
    let submitButton = null;
    for (const selector of submitSelectors) {
      const el = page.locator(selector).first();
      if (await el.count() > 0 && await el.isVisible().catch(() => false)) {
        submitButton = el;
        console.log(`   ✓ 找到登录按钮: ${selector}`);
        break;
      }
    }
    
    if (submitButton) {
      console.log("   ⏳ 等待登录响应...");
      await Promise.all([
        page.waitForLoadState("domcontentloaded").catch(() => {}),
        submitButton.click(),
      ]);
      
      await page.waitForTimeout(3000);
      console.log(`   当前页面: ${page.url()}`);
      await page.screenshot({ path: "debug-04-after-login.png" });
      console.log("   📸 截图已保存: debug-04-after-login.png");
    }
    
    // 步骤 6: 检查是否需要 2FA
    if (!EXAMBASE_URL_PATTERN.test(page.url())) {
      console.log("\n📍 步骤 5: 检查是否需要 2FA");
      console.log("   ⚠️  当前未在 Exambase 页面");
      console.log("   请手动在浏览器中完成 2FA...");
      console.log("   按 Ctrl+C 结束调试");
      
      // 等待用户完成 2FA
      try {
        await page.waitForURL(EXAMBASE_URL_PATTERN, { timeout: 120_000 });
        console.log("\n   ✅ 成功登录到 Exambase!");
      } catch {
        console.log("\n   ⏰ 等待超时");
        return;
      }
    }
    
    // 分析 Exambase 页面
    await analyzeExambasePage(page);
    
    console.log("\n" + "=".repeat(60));
    console.log("调试完成，浏览器保持打开状态");
    console.log("按 Ctrl+C 结束");
    
  } catch (error) {
    console.error("\n❌ 错误:", error.message);
    await page.screenshot({ path: "debug-error.png" });
    console.log("📸 错误截图已保存: debug-error.png");
  }
}

async function analyzeExambasePage(page) {
  console.log("\n📍 分析 Exambase 页面结构");
  console.log(`   当前 URL: ${page.url()}`);
  
  // 查找搜索框
  const searchSelectors = [
    'input[type="search"]',
    'input[name*="search" i]',
    'input[name*="query" i]',
    'input[placeholder*="search" i]',
    'input#search',
  ];
  
  console.log("\n   查找搜索框:");
  for (const selector of searchSelectors) {
    const el = page.locator(selector).first();
    const count = await el.count();
    const visible = count > 0 ? await el.isVisible().catch(() => false) : false;
    console.log(`     ${selector}: ${count > 0 ? (visible ? "✓ 可见" : "✗ 不可见") : "✗ 未找到"}`);
  }
  
  // 查找浏览课程链接
  console.log("\n   查找'Browse by Course Code'链接:");
  const browseLink = page.getByRole("link", { name: /browse.*course.*code/i }).first();
  if (await browseLink.count() > 0) {
    console.log("     ✓ 找到 Browse by Course Code 链接");
    const href = await browseLink.getAttribute("href");
    console.log(`     链接: ${href}`);
  } else {
    console.log("     ✗ 未找到");
  }
  
  // 查找所有链接
  console.log("\n   页面上的所有链接:");
  const links = await page.locator("a[href]").evaluateAll(anchors => 
    anchors.map(a => ({
      text: a.textContent?.trim()?.substring(0, 50) || "(无文本)",
      href: a.href,
    }))
  );
  
  const uniqueLinks = [...new Map(links.map(l => [l.href, l])).values()]
    .filter(l => l.text && l.text !== "(无文本)")
    .slice(0, 10);
  
  for (const link of uniqueLinks) {
    console.log(`     - ${link.text}: ${link.href.substring(0, 80)}...`);
  }
  
  await page.screenshot({ path: "debug-05-exambase.png", fullPage: true });
  console.log("\n   📸 完整截图已保存: debug-05-exambase.png");
}

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch (error) {
    console.error("请安装 Playwright: npm install --save-dev playwright");
    process.exit(1);
  }
}

main().catch(console.error);
