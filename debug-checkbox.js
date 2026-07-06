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

  // Speed run to step 11
  // Step 0: Okay + Continue
  await page.locator('button:has-text("Okay")').click().catch(() => {});
  await page.waitForTimeout(300);
  await page.locator('a:has-text("Continue")').click();
  await page.waitForTimeout(2500);

  // Step 1: Continue
  await page.locator('a:has-text("Continue")').click().catch(async () => {
    await page.locator('button:has-text("Continue")').click().catch(() => {});
  });
  await page.waitForTimeout(2500);

  // Steps 2-4: option clicks
  for (let i = 0; i < 3; i++) {
    await page.locator("button.w-full.p-4").first().click();
    await page.waitForTimeout(2500);
  }
  // Step 5: Continue (info screen)
  await page.locator('a:has-text("Continue")').click().catch(async () => {
    await page.locator('button:has-text("Continue")').click({ force: true }).catch(() => {});
  });
  await page.waitForTimeout(2500);

  // Steps 6-8: option clicks
  for (let i = 0; i < 3; i++) {
    await page.locator("button.w-full.p-4").first().click();
    await page.waitForTimeout(2500);
  }
  // Step 9: Continue (info screen)
  await page.locator('a:has-text("Continue")').click().catch(async () => {
    await page.locator('button:has-text("Continue")').click({ force: true }).catch(() => {});
  });
  await page.waitForTimeout(2500);

  // Step 10: option click
  await page.locator("button.w-full.p-4").first().click();
  await page.waitForTimeout(2500);

  // NOW at step 11 (checkboxes)
  console.log("At step 11:", page.url());
  await page.screenshot({ path: path.join(OUT_DIR, "debug_before_click.png"), fullPage: true });

  // Check state before click
  let state = await page.evaluate(() => {
    const cb = document.querySelector('button[role="checkbox"]');
    const cont = Array.from(document.querySelectorAll("button")).find(b => b.innerText?.trim() === "Continue");
    return {
      cbState: cb?.getAttribute("data-state"),
      cbAriaChecked: cb?.getAttribute("aria-checked"),
      contDisabled: cont?.disabled,
      contClasses: cont?.className
    };
  });
  console.log("Before click:", state);

  // Click checkbox using Playwright
  await page.locator('button[role="checkbox"]').first().click();
  await page.waitForTimeout(1000);

  // Check state after click
  state = await page.evaluate(() => {
    const cb = document.querySelector('button[role="checkbox"]');
    const cont = Array.from(document.querySelectorAll("button")).find(b => b.innerText?.trim() === "Continue");
    return {
      cbState: cb?.getAttribute("data-state"),
      cbAriaChecked: cb?.getAttribute("aria-checked"),
      contDisabled: cont?.disabled,
      contClasses: cont?.className,
      contText: cont?.innerText
    };
  });
  console.log("After checkbox click:", state);

  await page.screenshot({ path: path.join(OUT_DIR, "debug_after_checkbox.png"), fullPage: true });

  // If continue is enabled, click it
  if (!state.contDisabled) {
    console.log("Continue is enabled! Clicking...");
    await page.locator('button:has-text("Continue")').click();
    await page.waitForTimeout(3000);
    console.log("After continue:", page.url());
    await page.screenshot({ path: path.join(OUT_DIR, "debug_after_continue.png"), fullPage: true });
  } else {
    console.log("Continue still disabled. Trying to click parent label...");

    // Maybe need to click the parent label/div that wraps the checkbox
    await page.evaluate(() => {
      const labels = document.querySelectorAll("label");
      console.log("Labels:", labels.length);
      if (labels.length > 0) labels[0].click();
    });
    await page.waitForTimeout(1000);

    state = await page.evaluate(() => {
      const cbs = document.querySelectorAll('button[role="checkbox"]');
      const states = Array.from(cbs).map(cb => cb.getAttribute("data-state"));
      const cont = Array.from(document.querySelectorAll("button")).find(b => b.innerText?.trim() === "Continue");
      return { checkboxStates: states, contDisabled: cont?.disabled };
    });
    console.log("After label click:", state);

    await page.screenshot({ path: path.join(OUT_DIR, "debug_after_label.png"), fullPage: true });
  }

  await browser.close();
})();
