import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const screenshotsDir = path.resolve(__dirname, '../../screenshots');

async function capture() {
  console.log('Launching browser for screenshots...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();

    // 1. Desktop full trip overview (Form + Map + Timeline + Summary Cards)
    console.log('Capturing Desktop full trip view...');
    await page.setViewport({ width: 1440, height: 1100, deviceScaleFactor: 2 });
    await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 2000)); // wait for Leaflet tiles
    await page.screenshot({
      path: path.join(screenshotsDir, 'phase4_desktop_overview.png'),
      fullPage: false,
    });

    // 2. Map & Timeline detail screenshot
    console.log('Capturing Map & Timeline detail...');
    await page.evaluate(() => window.scrollTo(0, 160));
    await new Promise((r) => setTimeout(r, 500));
    await page.screenshot({
      path: path.join(screenshotsDir, 'phase4_map_and_timeline.png'),
      fullPage: false,
    });

    // 3. Driver's Daily Log Sheet Day 1
    console.log('Capturing Daily Log Sheet Day 1...');
    await page.evaluate(() => {
      const el = document.querySelector('.log-sheet-container');
      if (el) el.scrollIntoView();
    });
    await new Promise((r) => setTimeout(r, 800));
    const logSheetEl = await page.$('.log-sheet-container');
    if (logSheetEl) {
      await logSheetEl.screenshot({
        path: path.join(screenshotsDir, 'phase4_logsheet_day1.png'),
      });
    }

    // 4. Dev Mode: 2,500-mile cross-country 34h restart (Day 2 pure Off Duty)
    console.log('Capturing Cross Country Day 2 (34h Restart)...');
    // Switch to dev_logs tab by text
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('header button'));
      const dev = btns.find((b) => b.textContent.includes('Log Sheets Dev View'));
      if (dev) dev.click();
    });
    await new Promise((r) => setTimeout(r, 800));

    // Click Cross-Country 34h Restart button
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('main button'));
      const cross = btns.find((b) => b.textContent.includes('Restart'));
      if (cross) cross.click();
    });
    await new Promise((r) => setTimeout(r, 800));

    // Click Day 2 tab
    await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('main button'));
      const day2 = tabs.find((b) => b.textContent.trim().startsWith('Day 2'));
      if (day2) day2.click();
    });
    await new Promise((r) => setTimeout(r, 800));

    const restartSheet = await page.$('.log-sheet-container');
    if (restartSheet) {
      await restartSheet.screenshot({
        path: path.join(screenshotsDir, 'phase4_restart_day2_offduty.png'),
      });
    }

    // 5. Mobile Viewport (iPhone 14 Pro style: 393 x 852)
    console.log('Capturing Mobile Viewport...');
    // Return to main app tab
    const appBtn = (await page.$$('header button'))[0];
    if (appBtn) await appBtn.click();
    await page.setViewport({ width: 393, height: 852, deviceScaleFactor: 2 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise((r) => setTimeout(r, 1000));
    await page.screenshot({
      path: path.join(screenshotsDir, 'phase4_mobile_viewport.png'),
      fullPage: false,
    });

    console.log('All screenshots captured successfully into /screenshots!');
  } finally {
    await browser.close();
  }
}

capture().catch((err) => {
  console.error('Screenshot error:', err);
  process.exit(1);
});
