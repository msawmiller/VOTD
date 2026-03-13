import { writeFileSync } from 'fs';

const BIBLE_VERSION_ID = 111;
const VOTD_API = 'https://bible.youversionapi.com/3.3/verse_of_the_day.json';
const VERSES_API = 'https://bible.youversionapi.com/3.3/verses.json';
const IMAGES_SEARCH = 'https://search.youversionapi.com/4.0/images';
const S3_BASE = 'https://s3.amazonaws.com/static-youversionapi-com/images/base';
const PROXY_BASE = 'https://imageproxy.youversionapi.com';

const RENDITIONS = ['1280x1280', '1080x1920'];

const YV_HEADERS = {
  'X-YouVersion-Client': 'youversion',
  'X-YouVersion-App-Platform': 'ios',
  'X-YouVersion-App-Version': '2025211',
  'User-Agent': 'YouVersion/2025211 (iOS)',
  'Referer': 'https://ios.youversionapi.com',
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function checkRendition(imageId, size) {
  const url = `${PROXY_BASE}/64x64/${S3_BASE}/${imageId}/${size}.jpg`;
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.ok;
  } catch { return false; }
}

async function main() {
  console.log('Fetching VOTD calendar...');
  const calRes = await fetch(VOTD_API);
  const calJson = await calRes.json();
  const calendar = calJson.response.data;
  console.log(`Found ${calendar.length} days\n`);

  const results = [];
  const summary = { total: 0, withSquare: 0, withVertical: 0, withBoth: 0, noImages: 0 };

  for (const entry of calendar) {
    const { day, references } = entry;
    const usfm = references.join('+');

    // Get human-readable reference
    let humanRef = usfm;
    try {
      const vRes = await fetch(`${VERSES_API}?id=${BIBLE_VERSION_ID}&references[]=${encodeURIComponent(usfm)}`);
      const vJson = await vRes.json();
      humanRef = vJson.response?.data?.verses?.[0]?.reference?.human ?? usfm;
    } catch {}

    // Search for images
    let images = [];
    try {
      const imgRes = await fetch(
        `${IMAGES_SEARCH}?query=${encodeURIComponent(usfm)}&bible_version_id=${BIBLE_VERSION_ID}`,
        { headers: { 'Accept-Language': 'en' } }
      );
      const imgJson = await imgRes.json();
      images = imgJson.data || [];
    } catch {}

    // Filter to exact USFM matches
    const exact = images.filter(img => img.usfms.some(u => usfm.includes(u)));
    const others = images.filter(img => !img.usfms.some(u => usfm.includes(u)));

    // Check renditions for exact matches (up to 5 to keep it fast)
    const checked = [];
    for (const img of [...exact, ...others].slice(0, 5)) {
      const available = {};
      for (const size of RENDITIONS) {
        available[size] = await checkRendition(img.id, size);
      }
      checked.push({ id: img.id, exact: exact.some(e => e.id === img.id), ...available });
    }

    const hasSquare = checked.some(c => c['1280x1280']);
    const hasVertical = checked.some(c => c['1080x1920']);

    const row = {
      day,
      usfm,
      reference: humanRef,
      totalSearchResults: images.length,
      exactMatches: exact.length,
      images: checked,
      hasSquare,
      hasVertical,
    };
    results.push(row);

    summary.total++;
    if (hasSquare) summary.withSquare++;
    if (hasVertical) summary.withVertical++;
    if (hasSquare && hasVertical) summary.withBoth++;
    if (!hasSquare && !hasVertical) summary.noImages++;

    const status = [
      hasSquare ? '■' : '·',
      hasVertical ? '▮' : '·',
    ].join('');

    const pct = Math.round((day / calendar.length) * 100);
    process.stdout.write(`\r[${pct.toString().padStart(3)}%] Day ${String(day).padStart(3)} ${status} ${humanRef.padEnd(30)} (${exact.length} exact, ${images.length} total)`);

    // Rate limit
    await sleep(150);
  }

  console.log('\n\n═══ SUMMARY ═══');
  console.log(`Total days:        ${summary.total}`);
  console.log(`With square:       ${summary.withSquare} (${Math.round(summary.withSquare/summary.total*100)}%)`);
  console.log(`With vertical:     ${summary.withVertical} (${Math.round(summary.withVertical/summary.total*100)}%)`);
  console.log(`With both:         ${summary.withBoth} (${Math.round(summary.withBoth/summary.total*100)}%)`);
  console.log(`No images at all:  ${summary.noImages} (${Math.round(summary.noImages/summary.total*100)}%)`);

  // Days missing vertical
  const missingVertical = results.filter(r => !r.hasVertical);
  if (missingVertical.length > 0) {
    console.log(`\n═══ DAYS MISSING VERTICAL IMAGE ═══`);
    for (const r of missingVertical) {
      console.log(`  Day ${String(r.day).padStart(3)}: ${r.reference} (${r.exactMatches} exact matches, ${r.totalSearchResults} total)`);
    }
  }

  // Save full report
  const outPath = 'image-report.json';
  writeFileSync(outPath, JSON.stringify({ summary, days: results }, null, 2));
  console.log(`\nFull report saved to ${outPath}`);
}

main().catch(console.error);
