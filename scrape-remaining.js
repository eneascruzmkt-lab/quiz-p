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

async function captureStep(page, stepIndex) {
  const currentUrl = page.url();
  console.log(`\n--- Step ${stepIndex} ---`);
  console.log(`URL: ${currentUrl}`);

  await page.screenshot({ path: path.join(OUT_DIR, `step_${stepIndex}.png`), fullPage: true });

  const html = await page.content();
  fs.writeFileSync(path.join(OUT_DIR, `step_${stepIndex}.html`), html);

  const data = await page.evaluate(() => {
    // Texts
    const texts = [];
    const seen = new Set();
    document.querySelectorAll("h1,h2,h3,h4,h5,h6,p,span,button,a,label,div,li").forEach((el) => {
      const text = el.innerText?.trim();
      if (text && text.length > 0 && text.length < 500 && !seen.has(text)) {
        seen.add(text);
        texts.push({ tag: el.tagName.toLowerCase(), text, classes: el.className });
      }
    });

    // Images
    const images = [];
    document.querySelectorAll("img").forEach((img) => {
      if (img.src) images.push({ src: img.src, alt: img.alt || "" });
    });
    document.querySelectorAll("*").forEach((el) => {
      const bg = window.getComputedStyle(el).backgroundImage;
      if (bg && bg !== "none") {
        const match = bg.match(/url\(["']?(.*?)["']?\)/);
        if (match) images.push({ src: match[1], alt: "bg" });
      }
    });

    // Styles
    const bodyStyle = window.getComputedStyle(document.body);
    const styles = {
      backgroundColor: bodyStyle.backgroundColor,
      fontFamily: bodyStyle.fontFamily,
      color: bodyStyle.color,
    };

    return { texts, images, styles };
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

  console.log(`Texts: ${data.texts.length}, Images: ${data.images.length}`);
  return { index: stepIndex, url: currentUrl, ...data };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 430, height: 932 },
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
  });
  const page = await context.newPage();

  console.log("Opening quiz and navigating to step 9...");
  await page.goto(QUIZ_URL, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);

  // Navigate through steps 0-8 quickly (click first option each time)
  for (let i = 0; i < 9; i++) {
    // Click first answer option
    await page.evaluate(() => {
      const candidates = Array.from(
        document.querySelectorAll('button, [role="button"], div[class*="option"], label')
      ).filter((el) => {
        const text = el.innerText?.trim() || "";
        return text.length > 0 && text.length < 200 && !/continue|next|skip|terms|privacy|cookie|okay/i.test(text) && el.offsetParent !== null;
      });
      if (candidates.length > 0) candidates[0].click();
    });
    await page.waitForTimeout(800);

    // Click continue if present
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, [role="button"], a')).filter((el) => {
        const text = el.innerText?.trim() || "";
        return /^continue$/i.test(text) && el.offsetParent !== null;
      });
      if (btns.length > 0) btns[0].click();
    });
    await page.waitForTimeout(1500);
    console.log(`Passed step ${i}`);
  }

  // Now at step 9 - handle checkboxes
  console.log("At step 9 - clicking checkboxes...");
  const steps = [];

  // Click first checkbox
  await page.evaluate(() => {
    const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"], div[class*="check"], label')).filter(
      (el) => el.offsetParent !== null
    );
    if (checkboxes.length > 0) checkboxes[0].click();
  });
  await page.waitForTimeout(500);

  // Also try clicking the option div itself
  await page.evaluate(() => {
    const options = Array.from(document.querySelectorAll('div, label, button')).filter((el) => {
      const text = el.innerText?.trim() || "";
      return text === "Reduce stress" && el.offsetParent !== null;
    });
    if (options.length > 0) options[0].click();
  });
  await page.waitForTimeout(500);

  // Take screenshot to verify
  await page.screenshot({ path: path.join(OUT_DIR, "step_9_debug.png"), fullPage: true });

  // Click Continue
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button, [role="button"]')).filter((el) => {
      const text = el.innerText?.trim() || "";
      return /continue/i.test(text) && el.offsetParent !== null;
    });
    if (btns.length > 0) btns[0].click();
  });
  await page.waitForTimeout(2000);

  // Now capture remaining steps
  let stepIndex = 10;
  const seenUrls = new Set();
  const MAX_STEPS = 30;

  while (stepIndex < MAX_STEPS) {
    const currentUrl = page.url();
    if (seenUrls.has(currentUrl)) {
      console.log("Loop detected, stopping.");
      break;
    }
    seenUrls.add(currentUrl);

    const stepData = await captureStep(page, stepIndex);
    steps.push(stepData);

    // Try to advance
    // First check for checkboxes (multi-select pages)
    const hasCheckboxes = await page.evaluate(() => {
      return document.querySelectorAll('input[type="checkbox"]').length > 0;
    });

    if (hasCheckboxes) {
      // Click first checkbox option
      await page.evaluate(() => {
        const labels = Array.from(document.querySelectorAll('label, div')).filter((el) => {
          const text = el.innerText?.trim() || "";
          return text.length > 0 && text.length < 100 && !/continue|select/i.test(text) && el.offsetParent !== null;
        });
        if (labels.length > 0) labels[0].click();
      });
      await page.waitForTimeout(500);
    }

    // Click answer options (single select)
    await page.evaluate(() => {
      const candidates = Array.from(
        document.querySelectorAll('button, [role="button"], div[class*="option"], label')
      ).filter((el) => {
        const text = el.innerText?.trim() || "";
        return text.length > 0 && text.length < 200 && !/continue|next|skip|submit|terms|privacy|cookie|okay|select/i.test(text) && el.offsetParent !== null;
      });
      if (candidates.length > 0) candidates[0].click();
    });
    await page.waitForTimeout(800);

    // Click continue/next
    const navClicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, [role="button"], a')).filter((el) => {
        const text = el.innerText?.trim() || "";
        return /^(continue|next|submit|get.*result|see.*result|start|claim|get.*plan)$/i.test(text) && el.offsetParent !== null;
      });
      if (btns.length > 0) { btns[0].click(); return true; }
      return false;
    });

    await page.waitForTimeout(2000);

    // Check if URL changed
    const newUrl = page.url();
    if (newUrl === currentUrl && !navClicked) {
      // Try clicking any visible button
      const anyClicked = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button')).filter(
          (el) => el.offsetParent !== null && el.innerText?.trim().length > 0
        );
        if (btns.length > 0) { btns[btns.length - 1].click(); return true; }
        return false;
      });
      if (!anyClicked) {
        console.log("No more navigation possible.");
        break;
      }
      await page.waitForTimeout(2000);
    }

    stepIndex++;
  }

  // Load existing quiz data and append
  const existingDataPath = path.join(OUT_DIR, "quiz-data.json");
  let allSteps = [];
  if (fs.existsSync(existingDataPath)) {
    allSteps = JSON.parse(fs.readFileSync(existingDataPath, "utf-8"));
  }
  allSteps.push(...steps);
  fs.writeFileSync(existingDataPath, JSON.stringify(allSteps, null, 2));

  console.log(`\nDone! Captured ${steps.length} additional steps (total: ${allSteps.length}).`);
  await browser.close();
})();
