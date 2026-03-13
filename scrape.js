import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const URL = 'https://www.bible.com/verse-of-the-day';

async function scrapeVOTD() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  console.log(`Navigating to ${URL} ...`);
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });

  // Give the React app a moment to hydrate
  await page.waitForTimeout(2000);

  const raw = await page.evaluate(() => {
    const meta = (prop) =>
      document.querySelector(`meta[property="${prop}"]`)?.content ??
      document.querySelector(`meta[name="${prop}"]`)?.content ??
      null;

    // Open Graph tags are the most reliable on this SPA
    const ogTitle = meta('og:title');       // e.g. "Verse of the Day - Genesis 1:1"
    const ogDesc  = meta('og:description'); // e.g. "Genesis 1:1 In the beginning God..."
    const ogImage = meta('og:image');
    const ogUrl   = meta('og:url');

    // Try to grab date from the page heading
    const dateEl = [...document.querySelectorAll('h1, h2, h3, p, span')]
      .find((el) => /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/.test(el.innerText ?? ''));
    const pageDate = dateEl?.innerText?.trim() ?? null;

    return { ogTitle, ogDesc, ogImage, ogUrl, pageDate };
  });

  // Parse reference + verse text from OG description
  // Format: "Book Chapter:Verse(–Verse)? Verse text..."
  const refMatch = raw.ogDesc?.match(/^([1-3]?\s?[A-Z][a-zA-Z]+\s+\d+:\d+(?:[-–]\d+)?)\s+([\s\S]+)$/);
  const reference = refMatch?.[1] ?? raw.ogTitle?.replace(/^Verse of the Day\s*[-–]\s*/i, '') ?? null;
  const verseText = refMatch?.[2] ?? raw.ogDesc ?? null;

  await page.screenshot({ path: 'votd-screenshot.png', fullPage: false });
  await browser.close();

  return {
    date: raw.pageDate,
    verseText: verseText?.trim(),
    reference: reference?.trim(),
    imageUrl: raw.ogImage,
    sourceUrl: raw.ogUrl ?? URL,
  };
}

(async () => {
  try {
    const result = await scrapeVOTD();

    console.log('\n========== Verse of the Day ==========');
    if (result.date)      console.log(`Date:      ${result.date}`);
    if (result.reference) console.log(`Reference: ${result.reference}`);
    if (result.verseText) console.log(`Verse:     ${result.verseText}`);
    if (result.imageUrl)  console.log(`Image:     ${result.imageUrl}`);
    console.log('======================================\n');

    const output = {
      scrapedAt: new Date().toISOString(),
      url: result.sourceUrl,
      date: result.date,
      reference: result.reference,
      verseText: result.verseText,
      imageUrl: result.imageUrl,
    };

    writeFileSync('votd.json', JSON.stringify(output, null, 2));
    console.log('Results saved to votd.json');
    console.log('Screenshot saved to votd-screenshot.png');
  } catch (err) {
    console.error('Scrape failed:', err);
    process.exit(1);
  }
})();
