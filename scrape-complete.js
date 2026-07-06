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
  console.log(`\n--- Step ${idx} | ${page.url()} ---`);
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

  const heading = data.texts.find(t => t.text.length > 5)?.text.substring(0, 60) || "?";
  console.log(`  "${heading}" | imgs: ${data.images.length}`);
  return { index: idx, url: page.url(), ...data };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({
    viewport: { width: 430, height: 932 },
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
  })).newPage();

  console.log("Navigating through quiz...");
  await page.goto(QUIZ_URL, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);

  const allSteps = [];

  // === STEP 0: Welcome ===
  allSteps.push(await capture(page, 0));
  await page.evaluate(() => { const b = document.querySelector('button'); if (b && /okay/i.test(b.innerText)) b.click(); });
  await page.waitForTimeout(300);
  await page.locator('button:has-text("Continue")').click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(2500);

  // === STEP 1: 4 Million Hearts ===
  allSteps.push(await capture(page, 1));
  await page.locator('button:has-text("Continue")').click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(2500);

  // === STEPS 2-4: Single select questions ===
  for (let i = 2; i <= 4; i++) {
    allSteps.push(await capture(page, i));
    await page.locator("button.w-full.p-4").first().click({ timeout: 5000 });
    await page.waitForTimeout(2500);
  }

  // === STEP 5: Info screen (32% more likely) ===
  allSteps.push(await capture(page, 5));
  await page.locator('button:has-text("Continue")').click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(2500);

  // === STEPS 6-8: Single select questions ===
  for (let i = 6; i <= 8; i++) {
    allSteps.push(await capture(page, i));
    await page.locator("button.w-full.p-4").first().click({ timeout: 5000 });
    await page.waitForTimeout(2500);
  }

  // === STEP 9: Info screen (40% better) ===
  allSteps.push(await capture(page, 9));
  await page.locator('button:has-text("Continue")').click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(2500);

  // === STEPS 10-11: More single select + goal ===
  for (let i = 10; i <= 11; i++) {
    allSteps.push(await capture(page, i));
    await page.locator("button.w-full.p-4").first().click({ timeout: 5000 });
    await page.waitForTimeout(2500);
  }

  // === STEPS 12-13: Multi-select (checkboxes) ===
  for (let i = 12; i <= 13; i++) {
    allSteps.push(await capture(page, i));
    // Force click the first option to select checkbox
    await page.locator("button.w-full.p-4").first().click({ force: true, timeout: 5000 });
    await page.waitForTimeout(500);
    // Force click Continue (might be disabled initially)
    await page.locator('button:has-text("Continue")').click({ force: true, timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(2500);
  }

  // === Capture remaining steps dynamically ===
  let idx = 14;
  let stuck = 0;

  while (idx < 30 && stuck < 5) {
    const before = page.url();

    allSteps.push(await capture(page, idx));

    const pageText = await page.evaluate(() => document.body.innerText || "");
    const isMulti = /select all/i.test(pageText);

    try {
      if (isMulti) {
        await page.locator("button.w-full.p-4").first().click({ force: true, timeout: 3000 });
        await page.waitForTimeout(500);
        await page.locator('button:has-text("Continue")').click({ force: true, timeout: 3000 });
      } else {
        // Try single-select option
        const hasOptions = await page.locator("button.w-full.p-4").count();
        if (hasOptions > 0) {
          await page.locator("button.w-full.p-4").first().click({ timeout: 3000 });
        } else {
          // Info/CTA screen - click Continue or any prominent button
          await page.locator('button:has-text("Continue")').click({ force: true, timeout: 3000 }).catch(async () => {
            // Try any other button
            const btns = page.locator("button");
            const count = await btns.count();
            if (count > 0) await btns.last().click({ force: true }).catch(() => {});
          });
        }
      }
    } catch (e) {
      console.log("  Click failed:", e.message.substring(0, 80));
    }

    await page.waitForTimeout(2500);

    if (page.url() === before) {
      stuck++;
      console.log(`  Stuck (${stuck}/5)`);
      // Try force-clicking all buttons
      const btns = page.locator("button");
      const count = await btns.count();
      for (let b = count - 1; b >= 0; b--) {
        await btns.nth(b).click({ force: true }).catch(() => {});
        await page.waitForTimeout(1000);
        if (page.url() !== before) { stuck = 0; break; }
      }
    } else {
      stuck = 0;
    }

    idx++;
  }

  fs.writeFileSync(path.join(OUT_DIR, "quiz-data-complete.json"), JSON.stringify(allSteps, null, 2));
  console.log(`\n\nDONE! Total: ${allSteps.length} steps captured.`);
  await browser.close();
})();
