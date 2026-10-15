import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function capture() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 950 });

  console.log('Navigating to http://127.0.0.1:5173...');
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle0' });

  // 1. Capture Chicago -> Dallas -> Atlanta Day 1
  const out1 = path.resolve(__dirname, 'screenshot_chicago_day1.png');
  await page.screenshot({ path: out1, fullPage: true });
  console.log('Captured screenshot_chicago_day1.png');

  // Switch to cross country fixture
  const buttons = await page.$$('button');
  for (const b of buttons) {
    const text = await page.evaluate(el => el.textContent, b);
    if (text.includes('2,500-Mile LA')) {
      await b.click();
      break;
    }
  }
  await new Promise(r => setTimeout(r, 600));

  // Click Day 2 tab
  const dayTabs = await page.$$('button');
  for (const b of dayTabs) {
    const text = await page.evaluate(el => el.textContent, b);
    if (text.includes('Day 2')) {
      await b.click();
      break;
    }
  }
  await new Promise(r => setTimeout(r, 600));

  const out2 = path.resolve(__dirname, 'screenshot_restart_day2_offduty.png');
  await page.screenshot({ path: out2, fullPage: true });
  console.log('Captured screenshot_restart_day2_offduty.png');

  await browser.close();
}

capture().catch(err => {
  console.error('Capture error:', err);
  process.exit(1);
});
