const { chromium } = require("playwright");
const path = require("path");

const QUIZ_URL =
  "https://wf.holyrest.app/proj_fe239df4b93b44d184bf065eb41e2c61/flow_eb5e60c60451452fae077c90b41aec98";
const OUT_DIR = path.join(__dirname, "captured");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({
    viewport: { width: 430, height: 932 },
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
  })).newPage();

  await page.goto(QUIZ_URL, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(4000);

  // Speed run to step 11 (checkbox page)
  await page.locator('button:has-text("Okay")').click().catch(() => {});
  await page.waitForTimeout(300);
  await page.locator('a:has-text("Continue")').click();
  await page.waitForTimeout(2500);
  await page.locator('a:has-text("Continue")').click().catch(async () => {
    await page.locator('button:has-text("Continue")').click().catch(() => {});
  });
  await page.waitForTimeout(2500);
  for (let i = 0; i < 3; i++) { await page.locator("button.w-full.p-4").first().click(); await page.waitForTimeout(2500); }
  await page.locator('a:has-text("Continue")').click().catch(() => {});
  await page.waitForTimeout(2500);
  for (let i = 0; i < 3; i++) { await page.locator("button.w-full.p-4").first().click(); await page.waitForTimeout(2500); }
  await page.locator('a:has-text("Continue")').click().catch(() => {});
  await page.waitForTimeout(2500);
  await page.locator("button.w-full.p-4").first().click();
  await page.waitForTimeout(2500);

  console.log("At checkbox page:", page.url());

  // Click the parent DIV that has cursor-pointer (not the tiny checkbox button)
  const optionDiv = page.locator('div.cursor-pointer').first();
  console.log("Option div count:", await page.locator('div.cursor-pointer').count());

  await optionDiv.click();
  await page.waitForTimeout(1000);

  let state = await page.evaluate(() => {
    const cb = document.querySelector('button[role="checkbox"]');
    const cont = Array.from(document.querySelectorAll("button")).find(b => b.innerText?.trim() === "Continue");
    return {
      cbState: cb?.getAttribute("data-state"),
      contDisabled: cont?.disabled,
    };
  });
  console.log("After div click:", state);

  await page.screenshot({ path: path.join(OUT_DIR, "debug_div_click.png"), fullPage: true });

  if (!state.contDisabled) {
    console.log("Continue enabled! Clicking...");
    await page.locator('button:has-text("Continue")').click();
    await page.waitForTimeout(3000);
    console.log("New URL:", page.url());
    await page.screenshot({ path: path.join(OUT_DIR, "debug_after_checkbox_continue.png"), fullPage: true });

    // Check what's next
    const nextText = await page.evaluate(() => document.body.innerText?.substring(0, 200));
    console.log("Next page text:", nextText);
  }

  await browser.close();
})();
