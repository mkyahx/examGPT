#!/usr/bin/env node

import { chromium } from "playwright";

const baseUrl = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3000";
const courseCode = process.env.TEST_COURSE_CODE ?? "COMP3251";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const consoleMessages = [];

page.on("console", (message) => {
  consoleMessages.push(`${message.type()}: ${message.text()}`);
});
page.on("pageerror", (error) => {
  consoleMessages.push(`pageerror: ${error.message}`);
});

try {
  await page.goto(`${baseUrl}/generate`, { waitUntil: "networkidle" });
  await page.fill("#course", courseCode);
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("Original mode will directly") ||
      document.body.innerText.includes("certified original question"),
    null,
    { timeout: 15000 },
  );

  await page.getByRole("button", { name: "Generate originals" }).click();
  await page.waitForURL(/\/exam\//, { timeout: 15000 });
  await page.waitForSelector("text=Source question:", { timeout: 15000 });

  const bodyText = await page.locator("body").innerText();
  const sourceLines = bodyText.split("\n").filter((line) => line.includes("Source question:"));
  const firstPromptLine = bodyText
    .split("\n")
    .find((line) => line.includes("Design") || line.includes("algorithm") || line.includes("ranking"));

  console.log(
    JSON.stringify(
      {
        ok: sourceLines.length > 0,
        url: page.url(),
        courseCode,
        sourceLineCount: sourceLines.length,
        firstSourceLine: sourceLines[0] ?? null,
        firstPromptLine: firstPromptLine ?? null,
        consoleMessages: consoleMessages.slice(-10),
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
