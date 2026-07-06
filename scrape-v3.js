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

// Click any element containing text (button, a, div, etc.)
async function clickText(page, text, opts = {}) {
  const timeout = opts.timeout || 5000;
  try {
    // Try exact text match on any clickable element
    await page.evaluate((txt) => {
      const els = Array.from(document.querySelectorAll("button, a, div, label, span"));
      const el = els.find(e => e.innerText?.trim() === txt && e.offsetParent !== null);
      if (el) el.click();
    }, text);
    return true;
  } catch (e) {
    return false;
  }
}

async function clickFirstQuizOption(page) {
  return page.evaluate(() => {
    // Find option buttons: button elements with w-full and p-4 classes
    const btns = Array.from(document.querySelectorAll("button.w-full"))
      .filter(b => b.classList.contains("p-4") && b.offsetParent !== null);
    if (btns.length > 0) { btns[0].click(); return btns[0].innerText?.trim(); }

    // Fallback: any button-like element with short text
    const fallback = Array.from(document.querySelectorAll("button"))
      .filter(b => {
        const t = b.innerText?.trim();
        return t && t.length > 1 && t.length < 50 && !/continue|okay|skip|back/i.test(t) && b.offsetParent !== null;
      });
    if (fallback.length > 0) { fallback[0].click(); return fallback[0].innerText?.trim(); }
    return null;
  });
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

  // STEP 0: Welcome
  allSteps.push(await capture(page, 0));
  await clickText(page, "Okay");
  await page.waitForTimeout(300);
  await clickText(page, "Continue"); // This is an <a> tag
  await page.waitForTimeout(3000);

  // Now loop through all remaining steps dynamically
  let idx = 1;
  let stuck = 0;
  const MAX = 30;

  while (idx < MAX && stuck < 5) {
    const beforeUrl = page.url();

    allSteps.push(await capture(page, idx));

    // Detect page type
    const pageInfo = await page.evaluate(() => {
      const text = document.body.innerText || "";
      const hasOptions = document.querySelectorAll("button.w-full.p-4").length;
      const isMulti = /select all/i.test(text);
      const hasContinue = !!Array.from(document.querySelectorAll("button, a")).find(
        e => e.innerText?.trim() === "Continue" && e.offsetParent !== null
      );
      return { hasOptions, isMulti, hasContinue };
    });

    console.log(`  type: options=${pageInfo.hasOptions} multi=${pageInfo.isMulti} continue=${pageInfo.hasContinue}`);

    if (pageInfo.hasOptions > 0) {
      const clicked = await clickFirstQuizOption(page);
      console.log(`  clicked: "${clicked}"`);
      await page.waitForTimeout(1000);

      if (pageInfo.isMulti || pageInfo.hasContinue) {
        await page.waitForTimeout(500);
        // For multi-select, Continue might be disabled until option is selected
        // Use evaluate to force click
        await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll("button, a"));
          const cont = btns.find(b => b.innerText?.trim() === "Continue" && b.offsetParent !== null);
          if (cont) {
            cont.removeAttribute("disabled");
            cont.click();
          }
        });
      }
    } else if (pageInfo.hasContinue) {
      await clickText(page, "Continue");
    } else {
      // Try clicking any visible button or link
      await page.evaluate(() => {
        const all = Array.from(document.querySelectorAll("button, a")).filter(
          e => e.offsetParent !== null && e.innerText?.trim().length > 0
        );
        if (all.length > 0) all[0].click();
      });
    }

    await page.waitForTimeout(2500);

    if (page.url() === beforeUrl) {
      stuck++;
      console.log(`  STUCK (${stuck}/5)`);

      // Brute force: try every button and link
      await page.evaluate(() => {
        const all = Array.from(document.querySelectorAll("button, a")).filter(
          e => e.offsetParent !== null
        );
        all.forEach(e => {
          e.removeAttribute("disabled");
        });
        if (all.length > 0) all[all.length - 1].click();
      });
      await page.waitForTimeout(2000);

      if (page.url() !== beforeUrl) stuck = 0;
    } else {
      stuck = 0;
    }

    idx++;
  }

  fs.writeFileSync(path.join(OUT_DIR, "quiz-data-complete.json"), JSON.stringify(allSteps, null, 2));
  console.log(`\n\nDONE! ${allSteps.length} steps captured.`);
  await browser.close();
})();
