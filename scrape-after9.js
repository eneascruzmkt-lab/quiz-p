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

async function captureAndSave(page, stepIndex) {
  console.log(`\n--- Step ${stepIndex} | URL: ${page.url()} ---`);
  await page.screenshot({ path: path.join(OUT_DIR, `step_${stepIndex}.png`), fullPage: true });
  const html = await page.content();
  fs.writeFileSync(path.join(OUT_DIR, `step_${stepIndex}.html`), html);

  const data = await page.evaluate(() => {
    const texts = [];
    const seen = new Set();
    document.querySelectorAll("h1,h2,h3,h4,h5,h6,p,span,button,a,label,div,li").forEach((el) => {
      const t = el.innerText?.trim();
      if (t && t.length > 0 && t.length < 500 && !seen.has(t)) {
        seen.add(t);
        texts.push({ tag: el.tagName.toLowerCase(), text: t });
      }
    });
    const images = [];
    document.querySelectorAll("img").forEach((img) => {
      if (img.src) images.push({ src: img.src, alt: img.alt || "" });
    });
    document.querySelectorAll("*").forEach((el) => {
      const bg = window.getComputedStyle(el).backgroundImage;
      if (bg && bg !== "none") {
        const m = bg.match(/url\(["']?(.*?)["']?\)/);
        if (m && !m[1].startsWith("data:")) images.push({ src: m[1], alt: "bg" });
      }
    });
    return { texts, images };
  });

  // Download images
  for (let i = 0; i < data.images.length; i++) {
    const img = data.images[i];
    if (!img.src || img.src.startsWith("data:")) continue;
    try {
      const ext = path.extname(new URL(img.src).pathname) || ".png";
      const filename = `step${stepIndex}_img${i}${ext}`;
      await downloadFile(img.src, path.join(IMG_DIR, filename));
      data.images[i].localFile = filename;
    } catch (e) {}
  }

  console.log(`Texts: ${data.texts.map(t => t.text.substring(0, 40)).join(" | ")}`);
  return { index: stepIndex, url: page.url(), ...data };
}

async function clickFirstOption(page) {
  // Use Playwright's locator API - click the first button inside .space-y-3
  const optionBtn = page.locator("button.w-full.p-4").first();
  if (await optionBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await optionBtn.click();
    return true;
  }
  return false;
}

async function clickContinue(page) {
  const btn = page.locator('button:has-text("Continue")');
  if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await btn.click();
    return true;
  }
  return false;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 430, height: 932 },
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
  });
  const page = await context.newPage();

  console.log("Opening quiz and speed-running to step 9...");
  await page.goto(QUIZ_URL, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);

  // Step 0: dismiss cookie + click Continue
  await page.click('text="Okay"').catch(() => {});
  await page.waitForTimeout(300);
  await page.click('button:has-text("Continue")').catch(() => {});
  await page.waitForTimeout(2500);

  // Step 1: click Continue
  await page.click('button:has-text("Continue")').catch(() => {});
  await page.waitForTimeout(2500);

  // Steps 2-8: click first option button each time
  for (let i = 2; i <= 8; i++) {
    await clickFirstOption(page);
    await page.waitForTimeout(2000);
    console.log(`Passed step ${i}`);
  }

  // Step 9: multi-select - click first option then Continue
  console.log("At step 9 (multi-select)...");
  await clickFirstOption(page);
  await page.waitForTimeout(500);
  await clickContinue(page);
  await page.waitForTimeout(2500);

  // Now capture everything from step 10 onwards
  const allSteps = [];
  let stepIndex = 10;
  let stuckCount = 0;

  while (stepIndex < 35 && stuckCount < 5) {
    const beforeUrl = page.url();

    const stepData = await captureAndSave(page, stepIndex);
    allSteps.push(stepData);

    // Check if it's a multi-select page
    const pageText = await page.evaluate(() => document.body.innerText);
    const isMulti = /select all/i.test(pageText);

    if (isMulti) {
      await clickFirstOption(page);
      await page.waitForTimeout(500);
      await clickContinue(page);
    } else {
      // Try single select option
      const clicked = await clickFirstOption(page);
      if (!clicked) {
        // Try any button (Continue, CTA, etc.)
        await clickContinue(page);
      }
    }

    await page.waitForTimeout(2500);

    const afterUrl = page.url();
    if (afterUrl === beforeUrl) {
      stuckCount++;
      console.log(`Stuck (${stuckCount}/5) - trying alternative clicks...`);

      // Try scrolling and clicking different elements
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(300);

      // Try clicking any button
      const buttons = page.locator("button");
      const count = await buttons.count();
      for (let b = count - 1; b >= 0; b--) {
        const btn = buttons.nth(b);
        if (await btn.isVisible()) {
          await btn.click().catch(() => {});
          await page.waitForTimeout(2000);
          if (page.url() !== beforeUrl) break;
        }
      }

      // Try clicking links
      if (page.url() === beforeUrl) {
        const links = page.locator("a");
        const lCount = await links.count();
        for (let l = 0; l < lCount; l++) {
          const link = links.nth(l);
          if (await link.isVisible()) {
            await link.click().catch(() => {});
            await page.waitForTimeout(2000);
            if (page.url() !== beforeUrl) break;
          }
        }
      }
    } else {
      stuckCount = 0;
    }

    stepIndex++;
  }

  fs.writeFileSync(path.join(OUT_DIR, "remaining-steps.json"), JSON.stringify(allSteps, null, 2));
  console.log(`\nDone! Captured ${allSteps.length} additional steps.`);
  await browser.close();
})();
