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
    const texts = [];
    const seen = new Set();
    document.querySelectorAll("h1,h2,h3,h4,h5,h6,p,span,button,a,label,div,li").forEach((el) => {
      const text = el.innerText?.trim();
      if (text && text.length > 0 && text.length < 500 && !seen.has(text)) {
        seen.add(text);
        texts.push({ tag: el.tagName.toLowerCase(), text, classes: el.className });
      }
    });
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
    return { texts, images };
  });

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

async function clickOption(page) {
  // Check if multi-select (checkboxes)
  const isMultiSelect = await page.evaluate(() => {
    const text = document.body.innerText || "";
    return /select all/i.test(text) || document.querySelectorAll('input[type="checkbox"]').length > 0;
  });

  if (isMultiSelect) {
    // Click first option by its text content
    await page.evaluate(() => {
      const divs = Array.from(document.querySelectorAll("div, label")).filter((el) => {
        const rect = el.getBoundingClientRect();
        const text = el.innerText?.trim() || "";
        // Must be a visible option, not header/button
        return (
          rect.height > 30 && rect.height < 100 &&
          text.length > 2 && text.length < 60 &&
          !/select|continue|skip|cookie|privacy|terms/i.test(text) &&
          el.offsetParent !== null
        );
      });
      if (divs.length > 0) divs[0].click();
    });
    await page.waitForTimeout(600);

    // Now click Continue
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button")).filter((el) => {
        return /continue/i.test(el.innerText?.trim()) && el.offsetParent !== null;
      });
      if (btns.length > 0) btns[0].click();
    });
    return true;
  }

  // Single select - click first answer
  const clicked = await page.evaluate(() => {
    const candidates = Array.from(
      document.querySelectorAll("button, [role='button'], div, label")
    ).filter((el) => {
      const text = el.innerText?.trim() || "";
      const rect = el.getBoundingClientRect();
      return (
        text.length > 1 && text.length < 200 &&
        rect.height > 30 && rect.height < 100 &&
        !/continue|next|skip|submit|terms|privacy|cookie|okay|select|back/i.test(text) &&
        el.offsetParent !== null
      );
    });
    if (candidates.length > 0) { candidates[0].click(); return true; }
    return false;
  });

  if (!clicked) {
    // Fallback: click any button
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button")).filter(
        (el) => el.offsetParent !== null && el.innerText?.trim().length > 0
      );
      if (btns.length > 0) btns[0].click();
    });
  }

  return clicked;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 430, height: 932 },
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
  });
  const page = await context.newPage();

  console.log("Opening quiz...");
  await page.goto(QUIZ_URL, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);

  const allSteps = [];
  let stepIndex = 0;
  let stuckCount = 0;
  const MAX_STEPS = 40;

  while (stepIndex < MAX_STEPS && stuckCount < 3) {
    const beforeUrl = page.url();

    const stepData = await captureStep(page, stepIndex);
    allSteps.push(stepData);

    await clickOption(page);
    await page.waitForTimeout(2000);

    // Also try continue button again after delay
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button")).filter((el) => {
        return /continue|next|get|claim|start|see|try/i.test(el.innerText?.trim()) && el.offsetParent !== null;
      });
      if (btns.length > 0) btns[0].click();
    });
    await page.waitForTimeout(2000);

    const afterUrl = page.url();
    if (afterUrl === beforeUrl) {
      stuckCount++;
      console.log(`Stuck (${stuckCount}/3) - same URL`);

      // Try scrolling and clicking lower buttons
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(500);
      await page.evaluate(() => {
        const allBtns = Array.from(document.querySelectorAll("button, a[href]")).filter(
          (el) => el.offsetParent !== null
        );
        if (allBtns.length > 0) allBtns[allBtns.length - 1].click();
      });
      await page.waitForTimeout(2000);
    } else {
      stuckCount = 0;
    }

    stepIndex++;
  }

  fs.writeFileSync(path.join(OUT_DIR, "quiz-data-full.json"), JSON.stringify(allSteps, null, 2));
  console.log(`\nDone! Captured ${allSteps.length} steps total.`);
  await browser.close();
})();
