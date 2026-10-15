import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runCheck() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });

  // Set download behavior
  const client = await page.createCDPSession();
  const downloadPath = path.resolve(__dirname, 'test_downloads');
  if (!fs.existsSync(downloadPath)) {
    fs.mkdirSync(downloadPath, { recursive: true });
  }
  await client.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: downloadPath,
  });

  console.log('1. Navigating to http://127.0.0.1:5173/ ...');
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle0' });

  // --------------------------------------------------------------------------
  // Check 1 & 2 & 3: Chicago Fixture (Day 1, 2, 3)
  // --------------------------------------------------------------------------
  console.log('\n--- CHECKING CHICAGO FIXTURE ---');
  for (let day = 1; day <= 3; day++) {
    // Click Day tab
    const buttons = await page.$$('button');
    for (const b of buttons) {
      const text = await page.evaluate((el) => el.textContent, b);
      if (text.includes(`Day ${day} (`)) {
        await b.click();
        await new Promise((r) => setTimeout(r, 400));
        break;
      }
    }

    const data = await page.evaluate(() => {
      // 1. Check path d
      const pathEl = document.querySelector('svg path');
      const d = pathEl ? pathEl.getAttribute('d') : '';

      // Check transitions: count M and L commands
      const commands = d.match(/[ML]\s+[\d\.]+\s+[\d\.]+/g) || [];

      // 2. Row totals & sum
      const totalTextEl = Array.from(document.querySelectorAll('svg text')).find((el) =>
        el.textContent.includes('hrs') && el.textContent.includes('=')
      );
      const totalSum = totalTextEl ? totalTextEl.textContent.trim() : '';

      // Extract individual row totals from the 4 text elements in right column
      const rowTexts = Array.from(document.querySelectorAll('svg text'))
        .filter((el) => el.getAttribute('x') === '925')
        .map((el) => el.textContent.trim());

      // 3. Remarks count
      const remarkLines = Array.from(document.querySelectorAll('svg text')).filter(
        (el) => el.textContent.includes('[') && el.textContent.includes(']')
      );

      return {
        d,
        commandsCount: commands.length,
        totalSum,
        rowTexts,
        remarksCount: remarkLines.length,
      };
    });

    console.log(`Day ${day}:`);
    console.log(`  - Duty path command count: ${data.commandsCount}`);
    console.log(`  - Row totals: [OffDuty: ${data.rowTexts[1]}, Sleeper: ${data.rowTexts[2]}, Driving: ${data.rowTexts[3]}, OnDuty: ${data.rowTexts[4]}]`);
    console.log(`  - Row total sum box: "${data.rowTexts[5]}"`);
    console.log(`  - Remarks count: ${data.remarksCount}`);
  }

  // --------------------------------------------------------------------------
  // Check 4: Restart Fixture Day 2 (Flat Line on Off-Duty)
  // --------------------------------------------------------------------------
  console.log('\n--- CHECKING RESTART FIXTURE DAY 2 ---');
  const allBtns = await page.$$('button');
  for (const b of allBtns) {
    const text = await page.evaluate((el) => el.textContent, b);
    if (text.includes('2,500-Mile LA')) {
      await b.click();
      await new Promise((r) => setTimeout(r, 500));
      break;
    }
  }

  // Click Day 2
  const dayBtns = await page.$$('button');
  for (const b of dayBtns) {
    const text = await page.evaluate((el) => el.textContent, b);
    if (text.includes('Day 2 (')) {
      await b.click();
      await new Promise((r) => setTimeout(r, 400));
      break;
    }
  }

  const restartDay2 = await page.evaluate(() => {
    const pathEl = document.querySelector('svg path');
    const d = pathEl ? pathEl.getAttribute('d') : '';
    const rowTexts = Array.from(document.querySelectorAll('svg text'))
      .filter((el) => el.getAttribute('x') === '925')
      .map((el) => el.textContent.trim());

    return { d, rowTexts };
  });

  console.log(`Restart Day 2:`);
  console.log(`  - Path 'd': "${restartDay2.d}"`);
  console.log(`  - Row values: [OffDuty: ${restartDay2.rowTexts[1]}, Sleeper: ${restartDay2.rowTexts[2]}, Driving: ${restartDay2.rowTexts[3]}, OnDuty: ${restartDay2.rowTexts[4]}]`);
  console.log(`  - Day sum: "${restartDay2.rowTexts[5]}"`);

  // --------------------------------------------------------------------------
  // Check 5: PNG Export & PDF Export Verification
  // --------------------------------------------------------------------------
  console.log('\n--- CHECKING EXPORTS ---');
  // Click "Download PNG"
  const pngBtn = await page.evaluateHandle(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    return btns.find((b) => b.textContent.includes('Download PNG'));
  });
  if (pngBtn) {
    await pngBtn.click();
    console.log('  - Clicked Download PNG');
    await new Promise((r) => setTimeout(r, 1000));
  }

  // Click "Download All as PDF"
  const pdfBtn = await page.evaluateHandle(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    return btns.find((b) => b.textContent.includes('Download All as PDF'));
  });
  if (pdfBtn) {
    await pdfBtn.click();
    console.log('  - Clicked Download All as PDF (generating across all days)...');
    await new Promise((r) => setTimeout(r, 3000));
  }

  // Check downloaded files
  const downloadedFiles = fs.readdirSync(downloadPath);
  console.log(`  - Files in test_downloads:`, downloadedFiles);

  await browser.close();
}

runCheck().catch((err) => {
  console.error('Error during check:', err);
  process.exit(1);
});
