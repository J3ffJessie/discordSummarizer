/**
 * Renders a JavaScript-driven page in headless Chrome and returns its visible text.
 * Used for pages (like Torc profiles) whose content only exists after client-side rendering.
 */

const NAV_TIMEOUT_MS = 30_000;
const SETTLE_MS      = 1_500;  // time for expanded sections to render after clicking
const MAX_CONCURRENT = 2;      // each Chrome instance uses a few hundred MB

// Collapsed sections ("...MORE", "EXPAND ALL") hide bio and role details the rubric needs.
const EXPAND_LABELS = /^(\.{0,3}\s*more|expand all|show more|see more)$/i;

let active = 0;
const waiting = [];

async function withSlot(fn) {
  if (active >= MAX_CONCURRENT) await new Promise((resolve) => waiting.push(resolve));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

/**
 * @param {string} url
 * @returns {Promise<{ text: string, finalUrl: string }>}
 */
async function renderPageText(url) {
  return withSlot(async () => {
    const puppeteer = require('puppeteer');
    const browser = await puppeteer.launch({
      headless: true,
      // Render (and most containers) run without a usable sandbox or a large /dev/shm.
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    try {
      const page = await browser.newPage();
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if (['image', 'media', 'font'].includes(req.resourceType())) req.abort();
        else req.continue();
      });

      await page.goto(url, { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT_MS });

      const expanded = await page.evaluate((source) => {
        const labels = new RegExp(source, 'i');
        const els = [...document.querySelectorAll('button, a, span, div, p')]
          .filter((el) => el.children.length === 0 && labels.test(el.innerText.trim()));
        els.forEach((el) => el.click());
        return els.length;
      }, EXPAND_LABELS.source);
      if (expanded) await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

      const text = await page.evaluate(() => document.body.innerText);
      return { text, finalUrl: page.url() };
    } finally {
      await browser.close();
    }
  });
}

module.exports = { renderPageText };
