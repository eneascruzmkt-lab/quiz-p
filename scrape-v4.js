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
  return page.evaluate(() => {
    // 1. Check for quiz option buttons (single select)
    const optionBtns = Array.from(document.querySelectorAll("button.w-full"))
      .filter(b => b.classList.contains("p-4") && b.offsetParent !== null);
    if (optionBtns.length > 0) {
      optionBtns[0].click();
      return "option:" + (optionBtns[0].innerText?.trim() || "?");
    }

    // 2. Check for checkbox buttons (multi-select)
    const checkboxes = Array.from(document.querySelectorAll('button[role="checkbox"]'))
      .filter(cb => cb.offsetParent !== null);
    if (checkboxes.length > 0) {
      checkboxes[0].click();
      // Wait a bit, then click Continue
      setTimeout(() => {
        const cont = Array.from(document.querySelectorAll("button, a"))
          .find(e => e.innerText?.trim() === "Continue" && e.offsetParent !== null);
        if (cont) {
          cont.removeAttribute("disabled");
          cont.style.pointerEvents = "auto";
          cont.click();
        }
      }, 300);
      return "checkbox+continue";
    }

    // 3. Click Continue/CTA button or link
    const navEls = Array.from(document.querySelectorAll("button, a"))
      .filter(e => {
        const t = e.innerText?.trim();
        return t && /^(continue|next|get|claim|see|try|start|submit)$/i.test(t) && e.offsetParent !== null;
      });
    if (navEls.length > 0) {
      navEls[0].click();
      return "nav:" + navEls[0].innerText?.trim();
    }

    // 4. Fallback: any clickable element
    const any = Array.from(document.querySelectorAll("button, a"))
      .filter(e => e.offsetParent !== null && e.innerText?.trim().length > 0 && !/terms|privacy|cookie/i.test(e.innerText));
    if (any.length > 0) {
      any[0].click();
      return "fallback:" + any[0].innerText?.trim().substring(0, 30);
    }

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

  // Step 0: Welcome - dismiss cookie + click Continue (which is an <a> tag)
  allSteps.push(await capture(page, 0));
  await page.evaluate(() => {
    // Click Okay on cookie banner
    const okay = Array.from(document.querySelectorAll("button")).find(b => b.innerText?.trim() === "Okay");
    if (okay) okay.click();
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    // Click Continue <a> tag
    const cont = Array.from(document.querySelectorAll("a")).find(a => a.innerText?.trim() === "Continue");
    if (cont) cont.click();
  });
  await page.waitForTimeout(3000);

  // Loop through all remaining steps
  let idx = 1;
  let stuck = 0;

  while (idx < 30 && stuck < 5) {
    const beforeUrl = page.url();

    allSteps.push(await capture(page, idx));

    const action = await advancePage(page);
    console.log(`  action: ${action}`);

    // For checkbox+continue, need extra wait for setTimeout
    if (action === "checkbox+continue") {
      await page.waitForTimeout(1000);
    }

    await page.waitForTimeout(2500);

    if (page.url() === beforeUrl) {
      stuck++;
      console.log(`  STUCK (${stuck}/5)`);

      // Extra attempt: force click everything
      await page.evaluate(() => {
        document.querySelectorAll("button, a").forEach(e => {
          e.removeAttribute("disabled");
          e.style.pointerEvents = "auto";
        });
        const cont = Array.from(document.querySelectorAll("button, a"))
          .find(e => /continue/i.test(e.innerText?.trim()) && e.offsetParent !== null);
        if (cont) cont.click();
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
