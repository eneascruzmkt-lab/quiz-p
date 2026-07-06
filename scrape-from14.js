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

  const h = data.texts.find(t => t.text.length > 5)?.text.substring(0, 60) || "?";
  console.log(`  "${h}" | imgs:${data.images.length}`);
  return { index: idx, url: page.url(), ...data };
}

async function advancePage(page) {
  // 1. Single select options: button.w-full.p-4
  const singleOptions = await page.locator("button.w-full.p-4").count();
  if (singleOptions > 0) {
    await page.locator("button.w-full.p-4").first().click();
    return "option";
  }

  // 2. Multi-select: div.cursor-pointer
  const multiOptions = await page.locator("div.cursor-pointer").count();
  if (multiOptions > 0) {
    await page.locator("div.cursor-pointer").first().click();
    await page.waitForTimeout(500);
    await page.locator('button:has-text("Continue")').click();
    return "checkbox";
  }

  // 3. Yes/No buttons (<a> with text Yes/No)
  const yesLink = page.locator('a:has-text("Yes")');
  if (await yesLink.count() > 0) {
    await yesLink.first().click();
    return "yes";
  }

  // 4. Continue link (<a>)
  const contLink = page.locator('a:has-text("Continue")');
  if (await contLink.count() > 0) {
    await contLink.first().click();
    return "link:Continue";
  }

  // 5. Continue button
  const contBtn = page.locator('button:has-text("Continue")');
  if (await contBtn.count() > 0) {
    await contBtn.first().click({ force: true });
    return "btn:Continue";
  }

  // 6. Any CTA link or button
  const ctaPatterns = ['a:has-text("Get")', 'a:has-text("Claim")', 'a:has-text("Start")',
    'a:has-text("Try")', 'a:has-text("See")', 'button:has-text("Get")',
    'button:has-text("Claim")', 'button:has-text("Start")'];
  for (const sel of ctaPatterns) {
    const el = page.locator(sel);
    if (await el.count() > 0) {
      await el.first().click({ force: true });
      return `cta:${sel}`;
    }
  }

  // 7. Any visible button or link
  const anyClickable = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll("button, a")).filter(
      e => e.offsetParent !== null && e.innerText?.trim().length > 0 &&
        !/terms|privacy|cookie/i.test(e.innerText)
    );
    if (els.length > 0) { els[0].click(); return els[0].innerText?.trim().substring(0, 30); }
    return null;
  });
  if (anyClickable) return `any:${anyClickable}`;

  return null;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({
    viewport: { width: 430, height: 932 },
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
  })).newPage();

  console.log("Speed-running to step 14...");
  await page.goto(QUIZ_URL, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(4000);

  // Step 0: dismiss cookie + Continue
  await page.locator('button:has-text("Okay")').click().catch(() => {});
  await page.waitForTimeout(300);
  await page.locator('a:has-text("Continue")').click();
  await page.waitForTimeout(2500);

  // Step 1: Continue
  await page.locator('a:has-text("Continue")').click().catch(async () => {
    await page.locator('button:has-text("Continue")').click().catch(() => {});
  });
  await page.waitForTimeout(2500);

  // Steps 2-4: single select
  for (let i = 0; i < 3; i++) { await page.locator("button.w-full.p-4").first().click(); await page.waitForTimeout(2500); }

  // Step 5: info Continue
  await page.locator('a:has-text("Continue")').click().catch(() => {});
  await page.waitForTimeout(2500);

  // Steps 6-8: single select
  for (let i = 0; i < 3; i++) { await page.locator("button.w-full.p-4").first().click(); await page.waitForTimeout(2500); }

  // Step 9: info Continue
  await page.locator('a:has-text("Continue")').click().catch(() => {});
  await page.waitForTimeout(2500);

  // Step 10: single select
  await page.locator("button.w-full.p-4").first().click();
  await page.waitForTimeout(2500);

  // Step 11: checkbox + Continue
  await page.locator("div.cursor-pointer").first().click();
  await page.waitForTimeout(500);
  await page.locator('button:has-text("Continue")').click();
  await page.waitForTimeout(2500);

  // Step 12: checkbox + Continue
  await page.locator("div.cursor-pointer").first().click();
  await page.waitForTimeout(500);
  await page.locator('button:has-text("Continue")').click();
  await page.waitForTimeout(2500);

  // Step 13: info Continue
  await page.locator('a:has-text("Continue")').click().catch(() => {});
  await page.waitForTimeout(2500);

  console.log("Now at step 14:", page.url());

  // Capture from step 14 onwards
  const allSteps = [];
  let idx = 14;
  let stuck = 0;

  while (idx < 30 && stuck < 5) {
    const beforeUrl = page.url();

    allSteps.push(await capture(page, idx));

    try {
      const action = await advancePage(page);
      console.log(`  action: ${action}`);
    } catch (e) {
      console.log(`  error: ${e.message.substring(0, 80)}`);
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

  // Merge with existing data
  const existingPath = path.join(OUT_DIR, "quiz-data-complete.json");
  let existing = [];
  if (fs.existsSync(existingPath)) {
    existing = JSON.parse(fs.readFileSync(existingPath, "utf-8"));
    // Keep steps 0-13 from existing
    existing = existing.filter(s => s.index < 14);
  }
  const merged = [...existing, ...allSteps];
  fs.writeFileSync(existingPath, JSON.stringify(merged, null, 2));

  console.log(`\nDONE! Captured ${allSteps.length} additional steps. Total: ${merged.length}`);

  // Summary
  console.log("\n=== FULL QUIZ FLOW ===");
  merged.forEach(s => {
    const h = s.texts.find(t => t.text.length > 5)?.text.substring(0, 60) || "?";
    console.log(`Step ${s.index}: ${h}`);
  });

  await browser.close();
})();
