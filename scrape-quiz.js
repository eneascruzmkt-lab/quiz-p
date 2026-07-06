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

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 430, height: 932 },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });
  const page = await context.newPage();

  console.log("Opening quiz...");
  await page.goto(QUIZ_URL, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);

  const steps = [];
  let stepIndex = 0;
  const MAX_STEPS = 30;
  const seenUrls = new Set();

  while (stepIndex < MAX_STEPS) {
    const currentUrl = page.url();
    if (seenUrls.has(currentUrl) && stepIndex > 0) {
      console.log("Loop detected, stopping.");
      break;
    }
    seenUrls.add(currentUrl);

    console.log(`\n--- Step ${stepIndex} ---`);
    console.log(`URL: ${currentUrl}`);

    // Screenshot
    const screenshotPath = path.join(OUT_DIR, `step_${stepIndex}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`Screenshot: ${screenshotPath}`);

    // Get rendered HTML
    const html = await page.content();
    fs.writeFileSync(path.join(OUT_DIR, `step_${stepIndex}.html`), html);

    // Extract all visible text
    const textContent = await page.evaluate(() => {
      const elements = document.querySelectorAll("h1, h2, h3, h4, h5, h6, p, span, button, a, label, div, li");
      const texts = [];
      const seen = new Set();
      elements.forEach((el) => {
        const text = el.innerText?.trim();
        if (text && text.length > 0 && text.length < 500 && !seen.has(text)) {
          seen.add(text);
          texts.push({
            tag: el.tagName.toLowerCase(),
            text,
            classes: el.className,
          });
        }
      });
      return texts;
    });

    // Extract all computed styles for key elements
    const styles = await page.evaluate(() => {
      const body = document.body;
      const bodyStyle = window.getComputedStyle(body);
      return {
        backgroundColor: bodyStyle.backgroundColor,
        fontFamily: bodyStyle.fontFamily,
        color: bodyStyle.color,
      };
    });

    // Extract images
    const images = await page.evaluate(() => {
      const imgs = [];
      // <img> tags
      document.querySelectorAll("img").forEach((img) => {
        if (img.src) imgs.push({ src: img.src, alt: img.alt || "", width: img.naturalWidth, height: img.naturalHeight });
      });
      // Background images
      document.querySelectorAll("*").forEach((el) => {
        const bg = window.getComputedStyle(el).backgroundImage;
        if (bg && bg !== "none") {
          const match = bg.match(/url\(["']?(.*?)["']?\)/);
          if (match) imgs.push({ src: match[1], alt: "bg", width: 0, height: 0 });
        }
      });
      return imgs;
    });

    // Extract clickable options (quiz answers)
    const options = await page.evaluate(() => {
      const btns = [];
      document.querySelectorAll('button, [role="button"], [onclick], a, input[type="radio"], input[type="checkbox"]').forEach((el) => {
        const text = el.innerText?.trim() || el.value || el.getAttribute("aria-label") || "";
        if (text) {
          btns.push({
            tag: el.tagName.toLowerCase(),
            text,
            type: el.type || "",
            classes: el.className,
          });
        }
      });
      return btns;
    });

    const stepData = {
      index: stepIndex,
      url: currentUrl,
      texts: textContent,
      styles,
      images,
      options,
    };
    steps.push(stepData);

    console.log(`Texts: ${textContent.length} elements`);
    console.log(`Images: ${images.length}`);
    console.log(`Options: ${options.length}`);
    if (options.length > 0) {
      console.log("Options:", options.map((o) => o.text.substring(0, 50)).join(" | "));
    }

    // Download images
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      if (!img.src || img.src.startsWith("data:")) continue;
      const ext = path.extname(new URL(img.src).pathname) || ".png";
      const filename = `step${stepIndex}_img${i}${ext}`;
      try {
        await downloadFile(img.src, path.join(IMG_DIR, filename));
        images[i].localFile = filename;
      } catch (e) {
        console.log(`Failed to download: ${img.src}`);
      }
    }

    // Try to advance: look for continue/next button or clickable answer
    const advanced = await tryAdvance(page);
    if (!advanced) {
      console.log("No more steps found. Quiz complete.");
      break;
    }

    await page.waitForTimeout(2000);
    stepIndex++;
  }

  // Save all collected data
  fs.writeFileSync(
    path.join(OUT_DIR, "quiz-data.json"),
    JSON.stringify(steps, null, 2)
  );
  console.log(`\n\nDone! Captured ${steps.length} steps.`);
  console.log(`Data saved to: ${OUT_DIR}`);

  await browser.close();
})();

async function tryAdvance(page) {
  // Strategy 1: Click the first quiz answer option (not a "continue" type button)
  const answerClicked = await page.evaluate(() => {
    // Look for answer-like clickable elements
    const candidates = Array.from(
      document.querySelectorAll('button, [role="button"], div[class*="option"], div[class*="answer"], div[class*="choice"], label')
    ).filter((el) => {
      const text = el.innerText?.trim() || "";
      const isNav = /continue|next|skip|submit|back|previous/i.test(text);
      return text.length > 0 && text.length < 200 && !isNav && el.offsetParent !== null;
    });

    if (candidates.length > 0) {
      candidates[0].click();
      return true;
    }
    return false;
  });

  if (answerClicked) {
    await page.waitForTimeout(1000);
  }

  // Strategy 2: Click continue/next/submit button
  const navClicked = await page.evaluate(() => {
    const btns = Array.from(
      document.querySelectorAll('button, [role="button"], a, div[class*="button"], div[class*="btn"]')
    ).filter((el) => {
      const text = el.innerText?.trim() || "";
      return /continue|next|submit|get.*result|start|begin|let.*go|take.*quiz/i.test(text) && el.offsetParent !== null;
    });

    if (btns.length > 0) {
      btns[0].click();
      return true;
    }
    return false;
  });

  if (navClicked) {
    await page.waitForTimeout(1500);
    return true;
  }

  // Strategy 3: If answer was clicked but no nav button, maybe auto-advanced
  if (answerClicked) {
    return true;
  }

  // Strategy 4: Click any remaining clickable element
  const anyClicked = await page.evaluate(() => {
    const clickable = Array.from(
      document.querySelectorAll('button, [role="button"]')
    ).filter((el) => el.offsetParent !== null && el.innerText?.trim().length > 0);

    if (clickable.length > 0) {
      clickable[0].click();
      return true;
    }
    return false;
  });

  return anyClicked;
}
