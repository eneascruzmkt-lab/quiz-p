const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const QUIZ_URL =
  "https://wf.holyrest.app/proj_fe239df4b93b44d184bf065eb41e2c61/flow_eb5e60c60451452fae077c90b41aec98";

const OUT_DIR = path.join(__dirname, "captured");
const IMG_DIR = path.join(OUT_DIR, "images");
fs.mkdirSync(IMG_DIR, { recursive: true });

function downloadFile(url, filepath) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    mod.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFile(res.headers.location, filepath).then(resolve).catch(reject);
      }
      const stream = fs.createWriteStream(filepath);
      res.pipe(stream);
      stream.on("finish", () => { stream.close(); resolve(); });
      stream.on("error", reject);
    }).on("error", reject);
  });
}

async function capture(page, idx) {
  console.log(`\n--- Step ${idx} | ${page.url().split("/").pop() || "root"} ---`);
  await page.screenshot({ path: path.join(OUT_DIR, `step_${idx}.png`), fullPage: true });
  fs.writeFileSync(path.join(OUT_DIR, `step_${idx}.html`), await page.content());

  const data = await page.evaluate(() => {
    const texts = [], seen = new Set();
    document.querySelectorAll("h1,h2,h3,h4,h5,h6,p,span,button,a,label,div,li").forEach(el => {
      const t = el.innerText?.trim();
      if (t && t.length > 0 && t.length < 500 && !seen.has(t)) { seen.add(t); texts.push({ tag: el.tagName.toLowerCase(), text: t }); }
    });
    const images = [];
    document.querySelectorAll("img").forEach(img => { if (img.src) images.push({ src: img.src, alt: img.alt || "" }); });
    document.querySelectorAll("*").forEach(el => {
      const bg = window.getComputedStyle(el).backgroundImage;
      if (bg && bg !== "none") { const m = bg.match(/url\(["']?(.*?)["']?\)/); if (m && !m[1].startsWith("data:")) images.push({ src: m[1], alt: "bg" }); }
    });
    return { texts, images };
  });

  for (let i = 0; i < data.images.length; i++) {
    const img = data.images[i];
    if (!img.src || img.src.startsWith("data:")) continue;
    try {
      const ext = path.extname(new URL(img.src).pathname) || ".png";
      await downloadFile(img.src, path.join(IMG_DIR, `step${idx}_img${i}${ext}`));
      data.images[i].localFile = `step${idx}_img${i}${ext}`;
    } catch (e) {}
  }

  const h = data.texts.find(t => t.text.length > 5)?.text.substring(0, 50) || "?";
  console.log(`  "${h}" | imgs:${data.images.length}`);
  return { index: idx, url: page.url(), ...data };
}

async function advancePage(page) {
  // Detect page type
  const optionCount = await page.locator("button.w-full.p-4").count();
  const checkboxCount = await page.locator('button[role="checkbox"]').count();

  if (optionCount > 0) {
    // Single select: click first option using Playwright (proper React events)
    await page.locator("button.w-full.p-4").first().click();
    return "option";
  }

  if (checkboxCount > 0) {
    // Multi-select: click first checkbox using Playwright, then Continue
    await page.locator('button[role="checkbox"]').first().click();
    await page.waitForTimeout(500);

    // Now Continue should be enabled
    const continueBtn = page.locator('button:has-text("Continue")');
    if (await continueBtn.count() > 0) {
      await continueBtn.click({ timeout: 3000 }).catch(async () => {
        // Still disabled? Force it
        await continueBtn.click({ force: true, timeout: 3000 }).catch(() => {});
      });
    }
    return "checkbox";
  }

  // Info/CTA screen: look for Continue button or link
  // First try <a> tag with Continue text
  const continueLink = page.locator('a:has-text("Continue")');
  if (await continueLink.count() > 0) {
    await continueLink.first().click();
    return "link:Continue";
  }

  const continueBtn = page.locator('button:has-text("Continue")');
  if (await continueBtn.count() > 0) {
    await continueBtn.first().click({ force: true });
    return "btn:Continue";
  }

  // Try any other CTA
  const anyBtn = page.locator("button, a").filter({ hasText: /get|claim|see|try|start|submit/i });
  if (await anyBtn.count() > 0) {
    await anyBtn.first().click({ force: true });
    return "cta";
  }

  return null;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({
    viewport: { width: 430, height: 932 },
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
  })).newPage();

  console.log("Loading quiz...");
  await page.goto(QUIZ_URL, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(4000);

  const allSteps = [];

  // Step 0: Welcome
  allSteps.push(await capture(page, 0));
  // Dismiss cookie
  const okayBtn = page.locator('button:has-text("Okay")');
  if (await okayBtn.count() > 0) await okayBtn.click().catch(() => {});
  await page.waitForTimeout(300);
  // Click Continue <a> tag
  const contLink = page.locator('a:has-text("Continue")');
  if (await contLink.count() > 0) await contLink.click();
  await page.waitForTimeout(3000);

  // Loop all remaining steps
  let idx = 1;
  let stuck = 0;

  while (idx < 30 && stuck < 5) {
    const beforeUrl = page.url();

    allSteps.push(await capture(page, idx));

    try {
      const action = await advancePage(page);
      console.log(`  action: ${action}`);
    } catch (e) {
      console.log(`  action failed: ${e.message.substring(0, 60)}`);
    }

    await page.waitForTimeout(2500);

    if (page.url() === beforeUrl) {
      stuck++;
      console.log(`  STUCK (${stuck}/5)`);
    } else {
      stuck = 0;
    }

    idx++;
  }

  fs.writeFileSync(path.join(OUT_DIR, "quiz-data-complete.json"), JSON.stringify(allSteps, null, 2));
  console.log(`\n\nDONE! ${allSteps.length} steps captured.`);
  await browser.close();
})();
