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
      const t = el.innerText?.trim();
      if (t && t.length > 0 && t.length < 500 && !seen.has(t)) {
        seen.add(t);
        texts.push({ tag: el.tagName.toLowerCase(), text: t, classes: el.className });
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
        if (m) images.push({ src: m[1], alt: "bg" });
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

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 430, height: 932 },
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
  });
  const page = await context.newPage();

  console.log("Opening quiz...");
  await page.goto(QUIZ_URL, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(4000);

  // Step 0: Capture welcome screen
  const allSteps = [];
  allSteps.push(await captureStep(page, 0));

  // Dismiss cookie banner
  console.log("Dismissing cookie banner...");
  try {
    await page.click('text="Okay"', { timeout: 3000 });
  } catch (e) { console.log("No cookie banner found"); }
  await page.waitForTimeout(500);

  // Click Continue on welcome screen
  console.log("Clicking Continue...");
  try {
    await page.click('text="Continue"', { timeout: 3000 });
  } catch (e) { console.log("No Continue button"); }
  await page.waitForTimeout(3000);

  // Step 1: "4 Million Hearts" screen
  allSteps.push(await captureStep(page, 1));
  try {
    await page.click('text="Continue"', { timeout: 3000 });
  } catch (e) {}
  await page.waitForTimeout(2000);

  // Steps 2-8: Single choice questions
  for (let i = 2; i <= 8; i++) {
    allSteps.push(await captureStep(page, i));

    // Click first answer option (not continue/nav)
    const clicked = await page.evaluate(() => {
      // Get all visible option-like elements
      const all = Array.from(document.querySelectorAll("*"));
      const options = all.filter((el) => {
        const rect = el.getBoundingClientRect();
        const text = el.innerText?.trim() || "";
        const cs = window.getComputedStyle(el);
        // Look for bordered card-like elements with short text
        return (
          rect.width > 300 && rect.width < 450 &&
          rect.height > 40 && rect.height < 90 &&
          text.length > 1 && text.length < 50 &&
          !/continue|select|cookie|privacy|terms|okay/i.test(text) &&
          el.childElementCount < 5 &&
          el.offsetParent !== null
        );
      });
      if (options.length > 0) {
        options[0].click();
        return options[0].innerText?.trim();
      }
      return null;
    });
    console.log(`Clicked: ${clicked}`);
    await page.waitForTimeout(2500);
  }

  // Steps 9-10: Multi-select questions (checkboxes)
  for (let i = 9; i <= 10; i++) {
    allSteps.push(await captureStep(page, i));

    // Click first option (the whole row)
    await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll("*"));
      const options = all.filter((el) => {
        const rect = el.getBoundingClientRect();
        const text = el.innerText?.trim() || "";
        return (
          rect.width > 300 && rect.width < 450 &&
          rect.height > 40 && rect.height < 90 &&
          text.length > 2 && text.length < 50 &&
          !/continue|select|cookie|privacy|terms|okay/i.test(text) &&
          el.childElementCount < 5 &&
          el.offsetParent !== null
        );
      });
      if (options.length > 0) options[0].click();
    });
    await page.waitForTimeout(800);

    // Click Continue
    try {
      await page.click('text="Continue"', { timeout: 3000 });
    } catch (e) {
      // Try button that contains Continue
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll("button"));
        const btn = btns.find((b) => /continue/i.test(b.innerText));
        if (btn) btn.click();
      });
    }
    await page.waitForTimeout(2500);
  }

  // Continue capturing whatever comes after
  let stepIndex = 11;
  let stuckCount = 0;

  while (stepIndex < 35 && stuckCount < 4) {
    const beforeUrl = page.url();
    const beforeHtml = await page.evaluate(() => document.body.innerText?.substring(0, 200));

    allSteps.push(await captureStep(page, stepIndex));

    // Try multi-select first
    const isMulti = await page.evaluate(() => /select all/i.test(document.body.innerText || ""));

    if (isMulti) {
      await page.evaluate(() => {
        const all = Array.from(document.querySelectorAll("*"));
        const options = all.filter((el) => {
          const rect = el.getBoundingClientRect();
          const text = el.innerText?.trim() || "";
          return (
            rect.width > 300 && rect.height > 40 && rect.height < 90 &&
            text.length > 2 && text.length < 50 &&
            !/continue|select|cookie|privacy/i.test(text) &&
            el.childElementCount < 5 && el.offsetParent !== null
          );
        });
        if (options.length > 0) options[0].click();
      });
      await page.waitForTimeout(800);
      try { await page.click('text="Continue"', { timeout: 2000 }); } catch (e) {}
    } else {
      // Single select
      await page.evaluate(() => {
        const all = Array.from(document.querySelectorAll("*"));
        const options = all.filter((el) => {
          const rect = el.getBoundingClientRect();
          const text = el.innerText?.trim() || "";
          return (
            rect.width > 300 && rect.height > 40 && rect.height < 90 &&
            text.length > 1 && text.length < 50 &&
            !/continue|select|cookie|privacy|terms|okay|back|claim|get|try|start/i.test(text) &&
            el.childElementCount < 5 && el.offsetParent !== null
          );
        });
        if (options.length > 0) options[0].click();
      });
      await page.waitForTimeout(1000);

      // Also try Continue/CTA buttons
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll("button, a")).filter((el) => {
          const text = el.innerText?.trim() || "";
          return /continue|next|get|claim|see|try|start|submit/i.test(text) && el.offsetParent !== null;
        });
        if (btns.length > 0) btns[0].click();
      });
    }

    await page.waitForTimeout(2500);

    const afterUrl = page.url();
    const afterHtml = await page.evaluate(() => document.body.innerText?.substring(0, 200));

    if (afterUrl === beforeUrl && afterHtml === beforeHtml) {
      stuckCount++;
      console.log(`Stuck (${stuckCount}/4)`);
      // Try scrolling down and clicking
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(500);
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll("button, a")).filter(
          (el) => el.offsetParent !== null && el.innerText?.trim().length > 0
        );
        if (btns.length > 0) btns[btns.length - 1].click();
      });
      await page.waitForTimeout(2000);
    } else {
      stuckCount = 0;
    }

    stepIndex++;
  }

  fs.writeFileSync(path.join(OUT_DIR, "quiz-data-full.json"), JSON.stringify(allSteps, null, 2));
  console.log(`\nDone! Total steps captured: ${allSteps.length}`);
  await browser.close();
})();
