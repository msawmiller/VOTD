import express from 'express';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Vibrant } from 'node-vibrant/node';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = 3000;

const BIBLE_VERSION_ID = 111; // NIV
const VOTD_API = 'https://bible.youversionapi.com/3.3/verse_of_the_day.json';
const VERSES_API = 'https://bible.youversionapi.com/3.3/verses.json';
const VOTD_PAGE = 'https://www.bible.com/verse-of-the-day';
const MOMENTS_API = 'https://moments.youversionapi.com/3.1/votd.json?language_tag=en';
const IMAGE_PROXY_BASE = 'https://imageproxy.youversionapi.com/1280x1280/https://s3.amazonaws.com/static-youversionapi-com/images/base';
const BG_IMAGES_API = 'https://images.youversionapi.com/3.2/items.json';

const YV_HEADERS = {
  'X-YouVersion-Client': 'youversion',
  'X-YouVersion-App-Platform': 'ios',
  'X-YouVersion-App-Version': '2025211',
  'Referer': 'https://ios.youversionapi.com',
};

// Load scraped header/footer
let layout = { headerHTML: '', footerHTML: '' };
try {
  layout = JSON.parse(readFileSync(join(__dirname, 'scraped-layout.json'), 'utf8'));

  // Wrap: logo+nav links in .nav-left, search alone in .nav-center, right items in .nav-right
  layout.headerHTML = layout.headerHTML
    .replace(
      '<a href="/">',
      '<div class="nav-left"><a href="/">'
    )
    .replace(
      '<div class="relative hidden flex-1',
      '</div><div class="nav-center"><div class="relative hidden flex-1'
    )
    .replace(
      '<a class="hidden whitespace-nowrap',
      '</div><div class="nav-right"><a class="hidden whitespace-nowrap'
    )
    .replace(
      '</div></header>',
      '</div></div></header>'
    );
} catch {
  console.warn('scraped-layout.json not found — run: node scrape-layout.js');
}

// VOTD cache — refreshes every hour
let cache = null;
let cacheDate = null;
let votdCalendar = null; // full 366-day calendar for search

const USFM_BOOKS = {
  'genesis': 'GEN', 'gen': 'GEN',
  'exodus': 'EXO', 'exo': 'EXO', 'ex': 'EXO',
  'leviticus': 'LEV', 'lev': 'LEV',
  'numbers': 'NUM', 'num': 'NUM',
  'deuteronomy': 'DEU', 'deu': 'DEU', 'deut': 'DEU', 'dt': 'DEU',
  'joshua': 'JOS', 'jos': 'JOS', 'josh': 'JOS',
  'judges': 'JDG', 'jdg': 'JDG', 'judg': 'JDG',
  'ruth': 'RUT', 'rut': 'RUT',
  '1 samuel': '1SA', '1samuel': '1SA', '1sa': '1SA', '1 sam': '1SA', '1sam': '1SA',
  '2 samuel': '2SA', '2samuel': '2SA', '2sa': '2SA', '2 sam': '2SA', '2sam': '2SA',
  '1 kings': '1KI', '1kings': '1KI', '1ki': '1KI', '1 kgs': '1KI',
  '2 kings': '2KI', '2kings': '2KI', '2ki': '2KI', '2 kgs': '2KI',
  '1 chronicles': '1CH', '1chronicles': '1CH', '1ch': '1CH', '1 chr': '1CH',
  '2 chronicles': '2CH', '2chronicles': '2CH', '2ch': '2CH', '2 chr': '2CH',
  'ezra': 'EZR', 'ezr': 'EZR',
  'nehemiah': 'NEH', 'neh': 'NEH',
  'esther': 'EST', 'est': 'EST',
  'job': 'JOB',
  'psalms': 'PSA', 'psalm': 'PSA', 'psa': 'PSA', 'ps': 'PSA',
  'proverbs': 'PRO', 'proverb': 'PRO', 'pro': 'PRO', 'prov': 'PRO',
  'ecclesiastes': 'ECC', 'ecc': 'ECC', 'eccl': 'ECC',
  'song of solomon': 'SNG', 'song': 'SNG', 'sng': 'SNG', 'sos': 'SNG',
  'isaiah': 'ISA', 'isa': 'ISA',
  'jeremiah': 'JER', 'jer': 'JER',
  'lamentations': 'LAM', 'lam': 'LAM',
  'ezekiel': 'EZK', 'ezk': 'EZK', 'eze': 'EZK',
  'daniel': 'DAN', 'dan': 'DAN',
  'hosea': 'HOS', 'hos': 'HOS',
  'joel': 'JOL', 'jol': 'JOL',
  'amos': 'AMO', 'amo': 'AMO',
  'obadiah': 'OBA', 'oba': 'OBA',
  'jonah': 'JON', 'jon': 'JON',
  'micah': 'MIC', 'mic': 'MIC',
  'nahum': 'NAM', 'nam': 'NAM',
  'habakkuk': 'HAB', 'hab': 'HAB',
  'zephaniah': 'ZEP', 'zep': 'ZEP',
  'haggai': 'HAG', 'hag': 'HAG',
  'zechariah': 'ZEC', 'zec': 'ZEC', 'zech': 'ZEC',
  'malachi': 'MAL', 'mal': 'MAL',
  'matthew': 'MAT', 'matt': 'MAT', 'mat': 'MAT', 'mt': 'MAT',
  'mark': 'MRK', 'mrk': 'MRK', 'mk': 'MRK',
  'luke': 'LUK', 'luk': 'LUK', 'lk': 'LUK',
  'john': 'JHN', 'jhn': 'JHN', 'jn': 'JHN',
  'acts': 'ACT', 'act': 'ACT',
  'romans': 'ROM', 'rom': 'ROM',
  '1 corinthians': '1CO', '1corinthians': '1CO', '1co': '1CO', '1 cor': '1CO', '1cor': '1CO',
  '2 corinthians': '2CO', '2corinthians': '2CO', '2co': '2CO', '2 cor': '2CO', '2cor': '2CO',
  'galatians': 'GAL', 'gal': 'GAL',
  'ephesians': 'EPH', 'eph': 'EPH',
  'philippians': 'PHP', 'php': 'PHP', 'phil': 'PHP',
  'colossians': 'COL', 'col': 'COL',
  '1 thessalonians': '1TH', '1thessalonians': '1TH', '1th': '1TH', '1 thess': '1TH', '1thess': '1TH',
  '2 thessalonians': '2TH', '2thessalonians': '2TH', '2th': '2TH', '2 thess': '2TH', '2thess': '2TH',
  '1 timothy': '1TI', '1timothy': '1TI', '1ti': '1TI', '1 tim': '1TI', '1tim': '1TI',
  '2 timothy': '2TI', '2timothy': '2TI', '2ti': '2TI', '2 tim': '2TI', '2tim': '2TI',
  'titus': 'TIT', 'tit': 'TIT',
  'philemon': 'PHM', 'phm': 'PHM',
  'hebrews': 'HEB', 'heb': 'HEB',
  'james': 'JAS', 'jas': 'JAS',
  '1 peter': '1PE', '1peter': '1PE', '1pe': '1PE', '1 pet': '1PE', '1pet': '1PE',
  '2 peter': '2PE', '2peter': '2PE', '2pe': '2PE', '2 pet': '2PE', '2pet': '2PE',
  '1 john': '1JN', '1john': '1JN', '1jn': '1JN',
  '2 john': '2JN', '2john': '2JN', '2jn': '2JN',
  '3 john': '3JN', '3john': '3JN', '3jn': '3JN',
  'jude': 'JUD', 'jud': 'JUD',
  'revelation': 'REV', 'rev': 'REV', 'revelations': 'REV',
};

const USFM_TO_HUMAN = {};
for (const [name, code] of Object.entries(USFM_BOOKS)) {
  if (!USFM_TO_HUMAN[code] || name.length > USFM_TO_HUMAN[code].length) {
    USFM_TO_HUMAN[code] = name.charAt(0).toUpperCase() + name.slice(1);
  }
}

function dayToDate(dayNum) {
  const year = new Date().getFullYear();
  const d = new Date(year, 0, dayNum);
  return d.toISOString().slice(0, 10);
}

function usfmToHuman(usfm) {
  const parts = usfm.split('.');
  const book = USFM_TO_HUMAN[parts[0]] || parts[0];
  return parts.length === 3 ? `${book} ${parts[1]}:${parts[2]}` : parts.length === 2 ? `${book} ${parts[1]}` : book;
}

function parseQuery(q) {
  q = q.trim().toLowerCase();
  const match = q.match(/^(.+?)\s+(\d+)(?::(\d+))?$/);
  if (match) {
    const bookName = match[1].trim();
    const chapter = match[2];
    const verse = match[3];
    const bookCode = USFM_BOOKS[bookName];
    if (bookCode) {
      const usfmPattern = verse ? `${bookCode}.${chapter}.${verse}` : `${bookCode}.${chapter}.`;
      return { bookCode, chapter, verse, usfmPattern, type: verse ? 'exact' : 'chapter' };
    }
  }
  const bookCode = USFM_BOOKS[q];
  if (bookCode) return { bookCode, usfmPattern: bookCode + '.', type: 'book' };
  return null;
}

function searchCalendar(query) {
  if (!votdCalendar) return [];
  const parsed = parseQuery(query);
  if (!parsed) return [];

  return votdCalendar
    .filter((entry) => {
      return entry.usfm.some((u) => {
        if (parsed.type === 'exact') return u === parsed.usfmPattern;
        return u.startsWith(parsed.usfmPattern);
      });
    })
    .map((entry) => ({
      day: entry.day,
      date: dayToDate(entry.day),
      dateFormatted: new Date(new Date().getFullYear(), 0, entry.day)
        .toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      references: entry.usfm.map(usfmToHuman),
    }));
}

function dayOfYear(date) {
  const d = date || new Date();
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d - start) / 86400000);
}

function stripHtml(html) {
  const matches = [...html.matchAll(/class="content"[^>]*>([^<]+)</g)];
  return matches.map((m) => m[1]).join(' ').replace(/\s+/g, ' ').trim();
}

function formatDate(date) {
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

// ── Color helpers ──

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) { h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function hsl(h, s, l) { return `hsl(${h}, ${s}%, ${l}%)`; }

function ensureContrast(fgHsl, bgHsl, minDiff = 40) {
  const [fh, fs, fl] = fgHsl;
  const [, , bl] = bgHsl;
  if (Math.abs(fl - bl) >= minDiff) return hsl(fh, fs, fl);
  return bl > 50 ? hsl(fh, fs, Math.max(fl, 8)) : hsl(fh, fs, Math.min(fl, 95));
}

async function extractPalette(imageUrl) {
  const defaults = {
    panelBg: '#e1d5cc',
    textColor: '#121212',
    accentColor: '#c83f0c',
    barDark: '#10100f',
    barAccent: '#c83f0c',
    deeperBg: '#f5f0ea',
    cardBg: '#ffffff',
    linkColor: '#c83f0c',
    eyebrowDateBg: '#ffffff',
    highlightColor: 'rgba(243, 63, 5, 0.2)',
  };

  if (!imageUrl) return defaults;

  try {
    const palette = await Vibrant.from(imageUrl).getPalette();

    const muted = palette.Muted?.rgb;
    const darkMuted = palette.DarkMuted?.rgb;
    const darkVibrant = palette.DarkVibrant?.rgb;
    const vibrant = palette.Vibrant?.rgb;
    const lightMuted = palette.LightMuted?.rgb;
    const lightVibrant = palette.LightVibrant?.rgb;

    // Panel bg: a soft, desaturated tint from the muted swatch
    const panelBase = muted || lightMuted || [225, 213, 204];
    const [ph, ps, pl] = rgbToHsl(...panelBase);
    const panelBg = hsl(ph, Math.min(ps, 25), Math.max(pl, 78));

    // Text: darkest available swatch, guaranteed high contrast
    const textBase = darkMuted || darkVibrant || [18, 18, 18];
    const [th, ts, tl] = rgbToHsl(...textBase);
    const textColor = ensureContrast([th, Math.min(ts, 15), Math.min(tl, 15)], [ph, ps, Math.max(pl, 78)]);

    // Accent: the vibrant or dark vibrant — the editorial "pop"
    const accentBase = vibrant || darkVibrant || [200, 63, 12];
    const [ah, as, al] = rgbToHsl(...accentBase);
    const accentColor = hsl(ah, Math.max(as, 50), Math.min(Math.max(al, 35), 50));

    // Bar dark: derived from darkMuted, very dark
    const barBase = darkMuted || [16, 16, 15];
    const [bh, bs, bl] = rgbToHsl(...barBase);
    const barDark = hsl(bh, Math.min(bs, 20), Math.min(bl, 12));

    // Bar accent: same hue as accent but deeper saturation
    const barAccent = hsl(ah, Math.max(as, 60), Math.min(Math.max(al, 30), 45));

    // Deeper bg: very light tint from light muted
    const deeperBase = lightMuted || lightVibrant || [245, 240, 234];
    const [dh, ds, dl] = rgbToHsl(...deeperBase);
    const deeperBg = hsl(dh, Math.min(ds, 20), Math.max(dl, 92));

    // Card bg: near-white with a hint of the palette's warmth
    const cardBg = hsl(ph, Math.min(ps, 10), 98);

    // Link color: same as accent
    const linkColor = accentColor;

    // Eyebrow date badge: white with a whisper of warmth
    const eyebrowDateBg = hsl(ph, Math.min(ps, 12), 97);

    // Highlight behind verse text: accent at very low opacity
    const highlightColor = `hsla(${ah}, ${Math.max(as, 40)}%, ${Math.min(Math.max(al, 40), 60)}%, 0.18)`;

    return { panelBg, textColor, accentColor, barDark, barAccent, deeperBg, cardBg, linkColor, eyebrowDateBg, highlightColor };
  } catch (e) {
    console.warn('Palette extraction failed, using defaults:', e.message);
    return defaults;
  }
}

async function fetchVOTD(targetDate) {
  const dateObj = targetDate ? new Date(targetDate + 'T00:00:00') : new Date();
  const day = dayOfYear(dateObj);

  const calRes = await fetch(VOTD_API);
  const calJson = await calRes.json();
  const entry = calJson.response.data.find((d) => d.day === day);
  if (!entry) throw new Error(`No VOTD entry found for day ${day}`);

  const usfm = entry.references.join('+');

  const verseUrl = `${VERSES_API}?id=${BIBLE_VERSION_ID}&references[]=${encodeURIComponent(usfm)}`;
  const verseRes = await fetch(verseUrl);
  const verseJson = await verseRes.json();
  const verseData = verseJson.response?.data?.verses?.[0];
  if (!verseData) throw new Error('No verse data returned from API');

  const reference = verseData.reference.human;
  const verseText = stripHtml(verseData.content);

  // Step 1: Get the official prerendered image_id from moments API (anchors both images)
  const usfmRefs = entry.references;
  let momentsImageId = null;
  try {
    const momentsRes = await fetch(MOMENTS_API, { headers: YV_HEADERS });
    const momentsJson = await momentsRes.json();
    const momentsList = momentsJson.response?.data ?? [];
    const todayMoment = momentsList.find((d) => d.day === day);
    momentsImageId = todayMoment?.image_id ?? null;
  } catch (e) {
    console.warn('Could not fetch moments API:', e.message);
  }

  // Step 2: Share card — use the moments prerendered image (with text/artwork)
  let shareImageUrl = null;
  if (momentsImageId) {
    shareImageUrl = `${IMAGE_PROXY_BASE}/${momentsImageId}/1280x1280.jpg`.replace('1280x1280/https', '320x568/https');
    console.log(`Share image (moments): id=${momentsImageId}`);
  }

  // Step 3: Background — find the prerendered_bg that matches the moments image (closest ID = same photo batch)
  let imageUrl = null;
  try {
    const bgParams = new URLSearchParams({ category: 'prerendered_bg' });
    usfmRefs.forEach((ref) => bgParams.append('usfm[]', ref));
    let allBgImages = [];
    for (let page = 1; page <= 4; page++) {
      bgParams.set('page', page);
      const bgRes = await fetch(`${BG_IMAGES_API}?${bgParams}`, { headers: YV_HEADERS });
      const bgJson = await bgRes.json();
      const imgs = bgJson.response?.data?.images ?? [];
      if (imgs.length === 0) break;
      allBgImages.push(...imgs);
    }

    if (allBgImages.length > 0 && momentsImageId) {
      // Pick the bg image closest in ID to the moments prerendered image (same design batch)
      allBgImages.sort((a, b) => Math.abs(a.id - momentsImageId) - Math.abs(b.id - momentsImageId));
      const chosen = allBgImages[0];
      const rawUrl = chosen.urls.regular.replace('{w}', '1280').replace('{h}', '1280');
      imageUrl = rawUrl.startsWith('//') ? 'https:' + rawUrl : rawUrl;
      console.log(`VOTD bg image: id=${chosen.id} (Δ${Math.abs(chosen.id - momentsImageId)} from moments ${momentsImageId})`);
    } else if (allBgImages.length > 0) {
      // No moments anchor — pick newest square
      const square = allBgImages.find((img) => img.width === img.height);
      const chosen = square || allBgImages[0];
      const rawUrl = chosen.urls.regular.replace('{w}', '1280').replace('{h}', '1280');
      imageUrl = rawUrl.startsWith('//') ? 'https:' + rawUrl : rawUrl;
      console.log(`VOTD bg image (no anchor): id=${chosen.id}`);
    }
  } catch (e) {
    console.warn('Could not fetch prerendered_bg image:', e.message);
  }

  // Fallback: use the moments prerendered image directly as bg
  if (!imageUrl && momentsImageId) {
    imageUrl = `${IMAGE_PROXY_BASE}/${momentsImageId}/1280x1280.jpg`;
    console.log(`VOTD image (moments fallback): id=${momentsImageId}`);
  }

  const theme = await extractPalette(imageUrl);

  return {
    day,
    date: formatDate(dateObj),
    shortDate: dateObj.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }),
    usfm,
    reference,
    verseText,
    imageUrl,
    shareImageUrl,
    theme,
    sourceUrl: `https://www.bible.com/verse-of-the-day`,
    fetchedAt: new Date().toISOString(),
  };
}

function isCacheStale() {
  if (!cache || !cacheDate) return true;
  return (new Date() - cacheDate) / 1000 / 60 > 60;
}

// Warm cache + load calendar on startup
(async () => {
  try {
    console.log('Fetching VOTD from API...');
    cache = await fetchVOTD();
    cacheDate = new Date();
    console.log(`Cached: ${cache.reference} — ${cache.date}`);
  } catch (e) {
    console.error('Startup fetch failed:', e.message);
  }

  try {
    const calRes = await fetch(MOMENTS_API, { headers: YV_HEADERS });
    const calJson = await calRes.json();
    votdCalendar = calJson.response?.data ?? [];
    console.log(`VOTD calendar loaded: ${votdCalendar.length} days`);
  } catch (e) {
    console.error('Calendar fetch failed:', e.message);
  }
})();

// Serve font files
app.use('/fonts', express.static(join(__dirname, 'fonts')));
app.use('/public', express.static(join(__dirname, 'public')));
app.use('/images', express.static(join(__dirname, 'images')));

app.get('/api/search', (req, res) => {
  const q = req.query.q || '';
  if (!q.trim()) return res.json({ results: [] });
  const results = searchCalendar(q);
  res.json({ results });
});

app.get('/', async (req, res) => {
  try {
    const requestedDate = req.query.date; // e.g. ?date=2026-01-15
    let data;

    if (requestedDate) {
      data = await fetchVOTD(requestedDate);
    } else {
      if (isCacheStale()) {
        console.log('Refreshing VOTD cache...');
        cache = await fetchVOTD();
        cacheDate = new Date();
      }
      data = cache;
    }

    const { date, shortDate, verseText, reference, imageUrl, shareImageUrl, sourceUrl, theme } = data;

    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Verse of the Day — YouVersion</title>

  <!-- bible.com fonts & styles -->
  <link rel="stylesheet" href="https://use.typekit.net/wfn2tts.css" />
  <link rel="stylesheet" href="https://www.bible.com/_next/static/chunks/5754d9b1c1415c11.css" />
  <link rel="stylesheet" href="https://www.bible.com/_next/static/chunks/bbf1b40dcd92e542.css" />

  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,700;1,500&display=swap" rel="stylesheet" />

  <style>
    @font-face {
      font-family: 'Editor';
      src: url('/fonts/Editor-Light.otf') format('opentype');
      font-weight: 300; font-style: normal;
    }
    @font-face {
      font-family: 'Editor';
      src: url('/fonts/Editor-Regular.otf') format('opentype');
      font-weight: 400; font-style: normal;
    }
    @font-face {
      font-family: 'Editor';
      src: url('/fonts/Editor-Medium.otf') format('opentype');
      font-weight: 500; font-style: normal;
    }
    @font-face {
      font-family: 'Editor';
      src: url('/fonts/Editor-Bold.otf') format('opentype');
      font-weight: 700; font-style: normal;
    }
    @font-face {
      font-family: 'Editor';
      src: url('/fonts/Editor-Extrabold.otf') format('opentype');
      font-weight: 800; font-style: normal;
    }

    @font-face {
      font-family: 'EditorCondensed';
      src: url('/fonts/font/EditorCondensed-Light.woff2') format('woff2'),
           url('/fonts/font/EditorCondensed-Light.woff') format('woff');
      font-weight: 300; font-style: normal;
    }
    @font-face {
      font-family: 'EditorCondensed';
      src: url('/fonts/font/EditorCondensed-LightItalic.woff2') format('woff2'),
           url('/fonts/font/EditorCondensed-LightItalic.woff') format('woff');
      font-weight: 300; font-style: italic;
    }
    @font-face {
      font-family: 'EditorCondensed';
      src: url('/fonts/font/EditorCondensed-Regular.woff2') format('woff2'),
           url('/fonts/font/EditorCondensed-Regular.woff') format('woff');
      font-weight: 400; font-style: normal;
    }
    @font-face {
      font-family: 'EditorCondensed';
      src: url('/fonts/font/EditorCondensed-Italic.woff2') format('woff2'),
           url('/fonts/font/EditorCondensed-Italic.woff') format('woff');
      font-weight: 400; font-style: italic;
    }
    @font-face {
      font-family: 'EditorCondensed';
      src: url('/fonts/font/EditorCondensed-Medium.woff2') format('woff2'),
           url('/fonts/font/EditorCondensed-Medium.woff') format('woff');
      font-weight: 500; font-style: normal;
    }
    @font-face {
      font-family: 'EditorCondensed';
      src: url('/fonts/font/EditorCondensed-MediumItalic.woff2') format('woff2'),
           url('/fonts/font/EditorCondensed-MediumItalic.woff') format('woff');
      font-weight: 500; font-style: italic;
    }
    @font-face {
      font-family: 'EditorCondensed';
      src: url('/fonts/font/EditorCondensed-Bold.woff2') format('woff2'),
           url('/fonts/font/EditorCondensed-Bold.woff') format('woff');
      font-weight: 700; font-style: normal;
    }
    @font-face {
      font-family: 'EditorCondensed';
      src: url('/fonts/font/EditorCondensed-BoldItalic.woff2') format('woff2'),
           url('/fonts/font/EditorCondensed-BoldItalic.woff') format('woff');
      font-weight: 700; font-style: italic;
    }
    @font-face {
      font-family: 'EditorCondensed';
      src: url('/fonts/font/EditorCondensed-ExtraBold.woff2') format('woff2'),
           url('/fonts/font/EditorCondensed-ExtraBold.woff') format('woff');
      font-weight: 800; font-style: normal;
    }
    @font-face {
      font-family: 'EditorCondensed';
      src: url('/fonts/font/EditorCondensed-ExtraBoldItalic.woff2') format('woff2'),
           url('/fonts/font/EditorCondensed-ExtraBoldItalic.woff') format('woff');
      font-weight: 800; font-style: italic;
    }

    :root {
      --panel-bg: ${theme.panelBg};
      --text-color: ${theme.textColor};
      --accent: ${theme.accentColor};
      --bar-dark: ${theme.barDark};
      --bar-accent: ${theme.barAccent};
      --deeper-bg: ${theme.deeperBg};
      --card-bg: ${theme.cardBg};
      --link-color: ${theme.linkColor};
      --date-bg: ${theme.eyebrowDateBg};
      --highlight: ${theme.highlightColor};
    }

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    html { scroll-behavior: smooth; }

    /* Override any max-width containers the bible.com stylesheet might apply globally */
    html, body {
      width: 100% !important;
      max-width: 100% !important;
      overflow-x: hidden !important;
    }

    body {
      background: var(--panel-bg);
      display: flex;
      flex-direction: column;
      min-height: 100dvh;
      padding-top: 76px;
    }

    /* ── Hero: fills remaining viewport after header ── */
    .page-hero {
      display: flex;
      width: 100%;
      height: calc(100dvh - 76px);
      animation: fadeIn 0.7s ease both;
      flex-shrink: 0;
      overflow: hidden;
    }

    /* Full-width container for both header and footer */
    .max-w-container-xl {
      max-width: 100% !important;
      padding-left: 2rem !important;
      padding-right: 2rem !important;
    }


    /* 3-column grid: logo+links | search (centered) | right items */
    header > .max-w-container-xl {
      display: grid !important;
      grid-template-columns: 1fr auto 1fr !important;
      align-items: center !important;
      padding-left: 3rem !important;
      padding-right: 3rem !important;
      padding-inline: 3rem !important;
    }

    .nav-left {
      display: flex;
      align-items: center;
      gap: 1.5rem;
      justify-self: start;
    }

    .nav-center {
      justify-self: center;
    }

    .nav-center .flex-1 {
      flex: 0 1 auto !important;
      width: 380px;
      max-width: 380px;
    }

    .nav-right {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      justify-self: end;
    }

    /* Ensure footer is full-width and visible */
    footer {
      width: 100% !important;
      max-width: 100% !important;
      display: block !important;
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to   { opacity: 1; }
    }

    /* ── Left panel: column layout filling half the hero ── */
    .panel-left {
      flex: 1;
      background: var(--panel-bg);
      display: flex;
      flex-direction: column;
      min-width: 0;
      overflow: hidden;
    }

    /* Scrollable content area above the bar */
    .panel-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
      padding: 2.5rem 3.5rem 2.5rem 5rem;
      min-height: 0;
      overflow: hidden;
    }

    .votd-group {
      display: flex;
      flex-direction: column;
    }

    .votd-eyebrow {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      font-family: 'EditorCondensed', sans-serif;
      font-weight: 500;
      font-size: 2rem;
      letter-spacing: -0.01em;
      color: var(--text-color);
      margin-bottom: 1.25rem;
    }

    .votd-eyebrow-date {
      display: inline-flex;
      align-items: center;
      background: var(--date-bg);
      font-family: 'EditorCondensed', sans-serif;
      font-weight: 500;
      font-size: 1.5rem;
      color: var(--text-color);
      padding: 0.55rem 0.4rem 0.35rem;
      line-height: 1cap;
      border-radius: 2px;
      letter-spacing: -0.04em;
    }

    .votd-share {
      margin-left: 1rem;
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      font-family: 'aktiv-grotesk', sans-serif;
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--text-color);
      text-decoration: none;
      opacity: 0.5;
    }

    .votd-verse {
      font-family: 'EditorCondensed', Georgia, serif;
      font-weight: 400;
      font-size: clamp(2.5rem, calc(5.2vw * var(--verse-scale, 1)), calc(5.6rem * var(--verse-scale, 1)));
      line-height: 0.95;
      letter-spacing: -0.028em;
      color: var(--text-color);
    }

    .votd-reference {
      font-family: 'aktiv-grotesk', sans-serif;
      font-size: 1.125rem;
      font-weight: 900;
      letter-spacing: 0.03em;
      text-transform: uppercase;
      color: var(--text-color);
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding-top: 1.25rem;
    }

    .votd-reference a { color: inherit; text-decoration: none; }

    /* ── Action bar — inside left panel only, 142px tall ── */
    .panel-bar {
      display: flex;
      flex-direction: row;
      height: 142px;
      flex-shrink: 0;
      width: 100%;
    }

    .bar-left {
      flex: 0 0 50%;
      width: 50%;
      background: var(--bar-dark);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 1rem;
      gap: 1rem;
      text-decoration: none;
      overflow: hidden;
      transition: background 0.15s;
      box-sizing: border-box;
    }
    .bar-left:hover { filter: brightness(1.3); }

    .bar-thumb {
      width: 72px;
      height: 114px;
      object-fit: cover;
      object-position: center top;
      flex-shrink: 0;
      border-radius: 5px;
      margin: 14px 0;
    }

    .bar-left-text {
      display: flex;
      align-items: center;
      gap: 0.625rem;
    }

    .bar-label {
      font-family: 'aktiv-grotesk', sans-serif;
      font-size: 1.125rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #fff;
    }

    .bar-arrow {
      color: #fff;
      font-size: 1.1rem;
      display: inline-block;
      line-height: 1;
    }

    .bar-right {
      flex: 0 0 50%;
      width: 50%;
      background: var(--bar-accent);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 1.5rem;
      gap: 0.75rem;
      text-decoration: none;
      transition: background 0.15s;
    }
    .bar-right:hover { filter: brightness(0.85); }
    .bar-right .bar-label { color: #fff; }

    .bible-icon {
      width: 24px;
      height: 24px;
      flex-shrink: 0;
    }

    /* ── Right panel: full height photo ── */
    .panel-right {
      flex: 1;
      position: relative;
      background: var(--bar-dark);
      overflow: hidden;
      min-width: 0;
    }

    @keyframes breathe {
      0%   { opacity: 0.35; transform: scale(1.04); }
      50%  { opacity: 1;    transform: scale(1); }
      100% { opacity: 0.35; transform: scale(1.04); }
    }

    .panel-right-img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: center top;
      animation: breathe 12s cubic-bezier(0.45, 0, 0.55, 1) infinite;
    }

    .panel-right-overlay {
      position: absolute;
      inset: 0;
      background: linear-gradient(160deg, rgba(60,60,60,0.2) 0%, rgba(20,20,20,0.45) 100%);
    }

    /* ── Share verse card — floats top-right of image panel ── */
    .share-card {
      position: absolute;
      top: 46px;
      right: 56px;
      width: 91px;
      background: #fff;
      border-radius: 5px;
      padding: 9px;
      padding-bottom: 12px;
      display: flex;
      flex-direction: column;
      align-items: center;
      z-index: 2;
      cursor: pointer;
      transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1),
                  box-shadow 0.3s ease;
      box-shadow: 0 2px 12px rgba(0,0,0,0.1);
    }

    .share-card:hover {
      transform: scale(1.08);
      box-shadow: 0 12px 40px rgba(0,0,0,0.25);
    }

    .share-card-img {
      width: 73px;
      height: 130px;
      object-fit: cover;
      border-radius: 4px;
      box-shadow: 0 4px 52px 20px rgba(0,0,0,0.25);
      transition: box-shadow 0.3s ease;
    }

    .share-card:hover .share-card-img {
      box-shadow: 0 6px 64px 24px rgba(0,0,0,0.35);
    }

    .share-card-action {
      display: flex;
      align-items: center;
      gap: 5px;
      margin-top: 10px;
      text-decoration: none;
      color: #000;
    }

    .share-card-action svg {
      width: 14px;
      height: 14px;
    }

    .share-card-action span {
      font-family: 'aktiv-grotesk', sans-serif;
      font-size: 12px;
      font-weight: 500;
    }

    /* ── Go Deeper section (below fold) — editorial layout ── */
    .page-deeper {
      background: #fff;
      padding: 0;
      position: relative;
      overflow: visible;
    }

    .deeper-date {
      font-family: 'EditorCondensed', sans-serif;
      font-weight: 800;
      font-size: 1.75rem;
      color: #121212;
      letter-spacing: -0.01em;
      line-height: 1;
      margin: 0;
      padding: 3rem 5rem 0;
    }

    .deeper-divider {
      border: none;
      height: 2px;
      background: #121212;
      margin: 0.75rem 5rem;
    }

    .deeper-plan-title {
      font-family: 'EditorCondensed', sans-serif;
      font-weight: 400;
      font-size: clamp(4rem, 12vw, 135px);
      color: #121212;
      letter-spacing: -0.03em;
      line-height: 0.93;
      padding: 6rem 5rem 0;
      margin: 0;
    }

    .deeper-plan-ref {
      font-family: 'aktiv-grotesk', sans-serif;
      font-weight: 500;
      font-size: 1.25rem;
      color: #121212;
      letter-spacing: 0.01em;
      padding: 1.25rem 5rem 0;
      margin: 0;
    }

    .deeper-subtitle {
      font-family: 'aktiv-grotesk', sans-serif;
      font-weight: 400;
      font-size: 1.1rem;
      color: #444;
      letter-spacing: 0.01em;
      padding: 1.5rem 5rem 2rem;
      margin: 0;
    }

    .deeper-subtitle em {
      font-style: italic;
    }

    .deeper-article-title {
      display: none; /* merged into plan-title */
      margin: 0 auto;
      padding: 0 1.5rem 2rem;
    }

    .deeper-body {
      max-width: 680px;
      margin: 0 auto;
      padding: 0 1.5rem;
    }

    .deeper-body p {
      font-family: 'Editor', Georgia, serif;
      font-weight: 400;
      font-size: 1.25rem;
      color: #121212;
      line-height: 1.35;
      letter-spacing: -0.01em;
      margin: 0 0 2.5rem;
    }

    .deeper-body {
      padding-top: 1.5rem;
      padding-bottom: 1.5rem;
    }

    .deeper-video {
      width: 100%;
      margin: 3rem 0 4rem;
    }

    .deeper-video video {
      width: 100%;
      height: auto;
      display: block;
      max-height: 700px;
    }

    .deeper-image {
      width: 100%;
      margin: 4rem 0;
      overflow: hidden;
    }

    .deeper-image img {
      width: 100%;
      height: auto;
      display: block;
      object-fit: cover;
      max-height: 600px;
    }

    .deeper-pullquote {
      font-family: 'EditorCondensed', sans-serif;
      font-weight: 700;
      font-size: clamp(1.75rem, 3.5vw, 2.75rem);
      color: #121212;
      text-align: center;
      max-width: 680px;
      margin: 0 auto;
      line-height: 1;
      letter-spacing: -0.03em;
      padding: 4rem 1.5rem;
      text-wrap: balance;
    }

    .deeper-body-light p {
      font-family: 'Editor', Georgia, serif !important;
      font-weight: 400 !important;
      font-size: 1.25rem;
      color: #121212;
      line-height: 1.35;
      letter-spacing: -0.01em;
      margin: 0 0 2rem;
    }

    /* ── Recommended Plans ── */
    .rec-plans {
      padding: 3rem 5rem 5rem;
    }

    .rec-plans-heading {
      font-family: 'EditorCondensed', sans-serif;
      font-weight: 700;
      font-size: clamp(2rem, 3.5vw, 3.15rem);
      color: #121212;
      letter-spacing: -0.03em;
      line-height: 1;
      margin-bottom: 2rem;
    }

    .rec-plans-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 2rem;
    }

    .rec-plan-card {
      display: flex;
      flex-direction: column;
    }

    .rec-plan-img {
      width: 100%;
      aspect-ratio: 321 / 232;
      object-fit: cover;
      border-radius: 12px;
      margin-bottom: 1rem;
    }

    .rec-plan-title {
      font-family: 'aktiv-grotesk', sans-serif;
      font-weight: 800;
      font-size: 1.1rem;
      color: #121212;
      letter-spacing: -0.04em;
      line-height: 1.1;
      margin-bottom: 0.5rem;
    }

    .rec-plan-desc {
      font-family: 'aktiv-grotesk', sans-serif;
      font-weight: 400;
      font-size: 0.95rem;
      color: #121212;
      line-height: 1.24;
      margin-bottom: 1.25rem;
      flex: 1;
    }

    .rec-plan-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: #121212;
      color: #fff;
      font-family: 'aktiv-grotesk', sans-serif;
      font-weight: 700;
      font-size: 0.8rem;
      border: none;
      border-radius: 40px;
      padding: 0.55rem 1.4rem;
      cursor: pointer;
      text-decoration: none;
      transition: opacity 0.15s;
      align-self: flex-start;
    }
    .rec-plan-btn:hover { opacity: 0.8; }

    .plan-cta {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1rem;
      padding: 3rem 1.5rem;
      max-width: 680px;
      margin: 0 auto;
      text-align: center;
    }

    .plan-cta-label {
      font-family: 'aktiv-grotesk', sans-serif;
      font-weight: 400;
      font-size: 1rem;
      color: #666;
      letter-spacing: 0.02em;
      margin: 0;
    }

    .plan-cta-title {
      font-family: 'EditorCondensed', sans-serif;
      font-weight: 700;
      font-size: clamp(2rem, 4vw, 3rem);
      color: #121212;
      letter-spacing: -0.02em;
      line-height: 1;
      margin: 0 0 1rem;
    }

    .plan-cta-img {
      width: 100%;
      height: auto;
      display: block;
      border-radius: 8px;
      margin-bottom: 0.5rem;
    }

    .plan-cta .rec-plan-btn {
      align-self: center;
    }

    /* ── Responsive ── */
    @media (max-width: 1280px) {
      .bar-label {
        font-size: 0.85rem;
      }
    }

    /* ── Tablet / narrow two-column ── */
    @media (max-width: 1024px) and (min-width: 769px) {
      .panel-content {
        padding: 1.75rem 2rem;
      }

      .votd-eyebrow {
        font-size: 1.35rem;
        margin-bottom: 0.875rem;
        flex-wrap: nowrap;
        gap: 0.3rem;
      }

      .votd-eyebrow-date {
        font-size: 1.1rem;
      }

      .votd-share {
        font-size: 0.65rem;
      }

      .votd-verse {
        font-size: clamp(1.75rem, calc(3.8vw * var(--verse-scale, 1)), calc(3.2rem * var(--verse-scale, 1)));
      }

      .votd-reference {
        font-size: 0.875rem;
        padding-top: 0.875rem;
      }

      .panel-bar {
        height: 100px;
      }

      .bar-thumb {
        width: 56px;
      }

      .bar-left-text {
        gap: 0.4rem;
      }

      .bar-label {
        font-size: 0.8rem;
        letter-spacing: 0.025em;
      }

      .bar-right {
        padding: 0 1.25rem;
        gap: 0.5rem;
      }

      .bible-icon {
        width: 18px;
        height: 18px;
      }
    }

    /* ── Mobile header (768px) — collapse nav but keep panels side-by-side ── */
    @media (max-width: 768px) {
      body {
        padding-top: 60px;
      }

      header > .max-w-container-xl {
        display: flex !important;
        grid-template-columns: unset !important;
        justify-content: space-between !important;
        gap: 0.5rem !important;
        padding-left: 1rem !important;
        padding-right: 1rem !important;
      }

      .max-w-container-xl {
        padding-left: 1rem !important;
        padding-right: 1rem !important;
      }

      header [class~="lg:flex"] { display: none !important; }
      header [class~="flex-1"][class~="hidden"] { display: none !important; }
      header a[href="/app"] { display: none !important; }
      header [class~="md:block"][class~="hidden"] { display: none !important; }

      header [class~="md:hidden"] {
        display: inline-flex !important;
        align-items: center;
      }

      .page-hero {
        height: calc(100dvh - 60px);
      }

      .panel-content {
        padding: 1.75rem 1.5rem 1rem;
      }

      .votd-eyebrow {
        font-size: 1.2rem;
        margin-bottom: 0.875rem;
      }

      .votd-eyebrow-date {
        font-size: 1rem;
      }

      .votd-verse {
        font-size: clamp(2rem, calc(8.5vw * var(--verse-scale, 1)), calc(3rem * var(--verse-scale, 1)));
      }

      .votd-reference {
        font-size: 0.8rem;
        padding-top: 0.875rem;
      }

      .panel-bar {
        height: 88px;
      }

      .bar-thumb {
        width: 52px;
      }

      .bar-left-text {
        gap: 0.4rem;
      }

      .bar-label {
        font-size: 0.8rem;
        letter-spacing: 0.02em;
      }

      .bar-right {
        padding: 0 1rem;
        gap: 0.5rem;
      }

      .bible-icon {
        width: 18px;
        height: 18px;
      }

      .deeper-date { padding: 2rem 1.5rem 0; }
      .deeper-divider { margin: 0.75rem 1.5rem; }
      .deeper-plan-title { font-size: clamp(2.5rem, 10vw, 6rem); padding: 3.5rem 1.5rem 0; }
      .deeper-plan-ref { padding: 1rem 1.5rem 0; }
      .deeper-subtitle { padding: 1rem 1.5rem 0; }
      .deeper-body { padding: 0 1.5rem; }
      .deeper-pullquote { padding: 2rem 1.5rem; }
      .rec-plans { padding: 2rem 1.5rem 3rem; }
      .rec-plans-grid { grid-template-columns: repeat(2, 1fr); gap: 1.5rem; }
    }

    /* ── Stack vertical (1024px) — panels go top/bottom ── */
    @media (max-width: 1024px) {
      .page-hero {
        flex-direction: column;
        height: auto;
        min-height: calc(100dvh - 60px);
      }

      .panel-right {
        order: -1;
        flex: 0 0 85vw;
        height: 85vw;
        min-width: 100%;
      }

      .share-card {
        top: 20px;
        right: 20px;
        width: 75px;
        padding: 7px 7px 10px;
      }

      .share-card-img {
        width: 61px;
        height: 108px;
      }

      .panel-left {
        flex: 1;
        min-height: 0;
      }

      .panel-content {
        padding: 1.75rem 1.5rem 1rem;
        justify-content: center;
        overflow: visible;
      }

      .bar-label {
        font-size: 0.7rem;
        letter-spacing: 0.02em;
      }
    }

    @media (max-width: 480px) {
      .panel-right {
        flex: 0 0 72vw;
        height: 72vw;
      }

      .panel-content {
        padding: 1.25rem 1.25rem 0.75rem;
      }

      .votd-eyebrow {
        font-size: 1rem;
      }

      .votd-eyebrow-date {
        font-size: 0.875rem;
      }

      .votd-verse {
        font-size: clamp(1.75rem, calc(9vw * var(--verse-scale, 1)), calc(2.5rem * var(--verse-scale, 1)));
      }
    }

    /* ── Date picker dropdown ── */
    .date-picker-overlay {
      display: none;
      position: fixed;
      inset: 0;
      z-index: 9998;
    }

    .date-picker-dropdown {
      display: none;
      position: fixed;
      top: 60px;
      right: 2rem;
      z-index: 9999;
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.18);
      padding: 1.25rem;
      min-width: 260px;
      font-family: 'aktiv-grotesk', sans-serif;
    }

    .date-picker-dropdown.open,
    .date-picker-overlay.open {
      display: block;
    }

    .date-picker-dropdown h3 {
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #777a7b;
      margin-bottom: 0.75rem;
    }

    .date-picker-dropdown input[type="date"] {
      width: 100%;
      padding: 0.6rem 0.75rem;
      border: 1.5px solid #ddd;
      border-radius: 8px;
      font-size: 0.95rem;
      font-family: 'aktiv-grotesk', sans-serif;
      color: #121212;
      outline: none;
      transition: border-color 0.15s;
      box-sizing: border-box;
    }
    .date-picker-dropdown input[type="date"]:focus {
      border-color: var(--accent);
    }

    .date-picker-dropdown .date-go-btn {
      display: block;
      width: 100%;
      margin-top: 0.75rem;
      padding: 0.65rem;
      background: var(--bar-dark);
      color: #fff;
      border: none;
      border-radius: 8px;
      font-family: 'aktiv-grotesk', sans-serif;
      font-size: 0.85rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      cursor: pointer;
      transition: filter 0.15s;
    }
    .date-picker-dropdown .date-go-btn:hover {
      filter: brightness(1.5);
    }

    .date-picker-dropdown .date-today-link {
      display: block;
      text-align: center;
      margin-top: 0.5rem;
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--link-color);
      text-decoration: none;
      cursor: pointer;
    }
    .date-picker-dropdown .date-today-link:hover {
      text-decoration: underline;
    }

    /* ── Verse search ── */
    .verse-search-divider {
      height: 1px;
      background: #e5e5e5;
      margin: 1rem 0;
    }

    .verse-search-label {
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #777a7b;
      margin-bottom: 0.5rem;
    }

    .verse-search-input {
      width: 100%;
      padding: 0.6rem 0.75rem;
      border: 1.5px solid #ddd;
      border-radius: 8px;
      font-size: 0.95rem;
      font-family: 'aktiv-grotesk', sans-serif;
      color: #121212;
      outline: none;
      transition: border-color 0.15s;
      box-sizing: border-box;
    }
    .verse-search-input:focus {
      border-color: var(--accent);
    }
    .verse-search-input::placeholder {
      color: #aaa;
    }

    .verse-search-results {
      max-height: 220px;
      overflow-y: auto;
      margin-top: 0.5rem;
    }
    .verse-search-results:empty {
      display: none;
    }

    .verse-search-result {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.5rem 0.5rem;
      border-radius: 6px;
      cursor: pointer;
      text-decoration: none;
      transition: background 0.1s;
    }
    .verse-search-result:hover {
      background: #f3f0ec;
    }

    .verse-search-ref {
      font-family: 'EditorCondensed', sans-serif;
      font-weight: 500;
      font-size: 1rem;
      color: #121212;
      line-height: 1.2;
    }

    .verse-search-date {
      font-family: 'aktiv-grotesk', sans-serif;
      font-size: 0.7rem;
      font-weight: 600;
      color: #999;
      letter-spacing: 0.02em;
      white-space: nowrap;
      margin-left: 0.75rem;
    }

    .verse-search-empty {
      font-size: 0.8rem;
      color: #999;
      padding: 0.5rem 0;
    }
  </style>
</head>
<body>

  ${layout.headerHTML}

  <!-- Date picker dropdown -->
  <div class="date-picker-overlay" id="dateOverlay"></div>
  <div class="date-picker-dropdown" id="datePicker">
    <h3>Find a Verse</h3>
    <input class="verse-search-input" type="text" id="verseSearchInput"
           placeholder="e.g. Romans, Psalm 23, John 3:16" autocomplete="off" />
    <div class="verse-search-results" id="verseSearchResults"></div>

    <div class="verse-search-divider"></div>

    <h3>Change Verse Date</h3>
    <input type="date" id="dateInput" value="${requestedDate || new Date().toISOString().slice(0, 10)}" />
    <button class="date-go-btn" id="dateGoBtn">Go to Date</button>
    <a class="date-today-link" href="/">Back to Today</a>
  </div>

  <script>
    (function() {
      var hamburger = document.querySelector('button[aria-label="profile menu"]');
      var picker = document.getElementById('datePicker');
      var overlay = document.getElementById('dateOverlay');
      var input = document.getElementById('dateInput');
      var goBtn = document.getElementById('dateGoBtn');

      if (hamburger) {
        hamburger.addEventListener('click', function(e) {
          e.preventDefault();
          e.stopPropagation();
          picker.classList.toggle('open');
          overlay.classList.toggle('open');
        });
      }

      overlay.addEventListener('click', function() {
        picker.classList.remove('open');
        overlay.classList.remove('open');
      });

      goBtn.addEventListener('click', function() {
        var d = input.value;
        if (d) window.location.href = '/?date=' + d;
      });

      input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
          var d = input.value;
          if (d) window.location.href = '/?date=' + d;
        }
      });

      // Verse search
      var searchInput = document.getElementById('verseSearchInput');
      var searchResults = document.getElementById('verseSearchResults');
      var searchTimer = null;

      searchInput.addEventListener('input', function() {
        clearTimeout(searchTimer);
        var q = searchInput.value.trim();
        if (!q) { searchResults.innerHTML = ''; return; }
        searchTimer = setTimeout(function() {
          fetch('/api/search?q=' + encodeURIComponent(q))
            .then(function(r) { return r.json(); })
            .then(function(data) {
              if (!data.results || data.results.length === 0) {
                searchResults.innerHTML = '<div class="verse-search-empty">No verses found in the VOTD calendar</div>';
                return;
              }
              searchResults.innerHTML = data.results.map(function(r) {
                return '<a class="verse-search-result" href="/?date=' + r.date + '">'
                  + '<span class="verse-search-ref">' + r.references.join(', ') + '</span>'
                  + '<span class="verse-search-date">' + r.dateFormatted + '</span>'
                  + '</a>';
              }).join('');
            })
            .catch(function() {
              searchResults.innerHTML = '';
            });
        }, 200);
      });
    })();

    document.addEventListener('click', function(e) {
      var link = e.target.closest('a[href="#go-deeper"]');
      if (link) {
        e.preventDefault();
        var target = document.getElementById('go-deeper');
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    });

  </script>

  <div class="page-hero">

    <!-- ── Left panel ── -->
    <div class="panel-left">

      <div class="panel-content">
        <div class="votd-group">
          <div class="votd-eyebrow">
            Verse of the Day &nbsp;•&nbsp;
            <span class="votd-eyebrow-date">${shortDate}</span>
          </div>

          <p class="votd-verse" style="--verse-scale: ${
            verseText.length < 50 ? 1.45
            : verseText.length < 80 ? 1.25
            : verseText.length < 110 ? 1.05
            : verseText.length < 140 ? 0.88
            : verseText.length < 180 ? 0.75
            : verseText.length < 230 ? 0.65
            : verseText.length < 300 ? 0.55
            : verseText.length < 400 ? 0.46
            : 0.38
          }; text-wrap: ${verseText.length < 180 ? 'balance' : 'pretty'}">${verseText}</p>

          <p class="votd-reference">
            <a href="${sourceUrl}" target="_blank" rel="noopener">${reference} (NIV)</a>
            &nbsp;→
            <a class="votd-share" href="${sourceUrl}" target="_blank" rel="noopener">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path fill-rule="evenodd" clip-rule="evenodd" d="M11 3.172 9.414 4.757 8 3.343 12 .343l4 3-1.414 1.414L13 3.172V15h-2V3.172ZM4 9h4v2H5v11h14V11h-3V9h4a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1Z" fill="currentColor"/>
              </svg>
              Share
            </a>
          </p>
        </div>
      </div>

      <!-- Action bar: dark left + orange right, inside left panel only -->
      <div class="panel-bar">
        <a class="bar-left" href="#go-deeper">
          <img class="bar-thumb" src="/public/icons/book-cover.jpg" alt="Go Deeper" />
          <div class="bar-left-text">
            <span class="bar-label">Go Deeper</span>
            <span class="bar-arrow">↓</span>
          </div>
        </a>
        <a class="bar-right" href="https://www.bible.com/bible" target="_blank" rel="noopener">
          <svg class="bible-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M2 4.5C2 3.12 3.12 2 4.5 2H9.5C10.33 2 11.08 2.33 11.62 2.87L12 3.25L12.38 2.87C12.92 2.33 13.67 2 14.5 2H19.5C20.88 2 22 3.12 22 4.5V17.5C22 18.88 20.88 20 19.5 20H14.5C13.67 20 12.92 20.33 12.38 20.87L12 21.25L11.62 20.87C11.08 20.33 10.33 20 9.5 20H4.5C3.12 20 2 18.88 2 17.5V4.5ZM11 5.5C11 4.67 10.33 4 9.5 4H4.5C4.22 4 4 4.22 4 4.5V17.5C4 17.78 4.22 18 4.5 18H9.5C10.33 18 11.08 18.33 11.62 18.87L11 18.87V5.5ZM13 18.87L12.38 18.87C12.92 18.33 13.67 18 14.5 18H19.5C19.78 18 20 17.78 20 17.5V4.5C20 4.22 19.78 4 19.5 4H14.5C13.67 4 13 4.67 13 5.5V18.87Z" fill="white"/>
          </svg>
          <span class="bar-label">Read the Bible Now</span>
        </a>
      </div>

    </div>

    <!-- ── Right panel: full height photo ── -->
    <div class="panel-right">
      ${imageUrl ? `<img class="panel-right-img" src="${imageUrl}" alt="Verse of the Day image" />` : ''}
      <div class="panel-right-overlay"></div>

      ${(shareImageUrl || imageUrl) ? `
      <div class="share-card">
        <img class="share-card-img" src="${shareImageUrl || imageUrl}" alt="Share verse" />
        <a class="share-card-action" href="${sourceUrl}" target="_blank" rel="noopener">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path fill-rule="evenodd" clip-rule="evenodd" d="M11 3.172 9.414 4.757 8 3.343 12 .343l4 3-1.414 1.414L13 3.172V15h-2V3.172ZM4 9h4v2H5v11h14V11h-3V9h4a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1Z" fill="currentColor"/>
          </svg>
          <span>Share</span>
        </a>
      </div>` : ''}
    </div>

  </div>

  <!-- Go Deeper section — editorial layout -->
  <section id="go-deeper" class="page-deeper">

    <h2 class="deeper-plan-title">Everyone is a Moon</h2>
    <p class="deeper-subtitle">Excerpt from <em>The Last Supper on the Moon</em> by Levi Lusko</p>

    <div class="deeper-image">
      <img src="/public/images/moon.png" alt="Close-up of the moon's cratered surface" />
    </div>

    <div class="deeper-body">
      <p>Did you know you have only ever seen one side of the moon? Though it orbits around the earth, the same side faces us the whole time. It technically does rotate on its twenty-seven-day journey around our planet, but because it is tidally locked to earth, it manages to keep its rear away from us at all times. Scientists call this synchronous rotation. Like a servant before a king, the moon never turns its back on us.</p>
      <p>What is called \u201cthe far side of the moon\u201d or \u201cthe dark side of the moon\u201d is always hidden. Humans laid eyes on it for the first time during Apollo 8. This side of the moon is pocked by craters far more extreme than those on the side we see in the sky every night. One reason for this is obvious: as long as it has hung in the sky, the side pointing away from earth gets the brunt of any asteroids coming our way, like a bodyguard taking a bullet for the one under their protection. The earth returns the favor, acting as a shield for much of the space debris coming from our direction that would slam into the moon.</p>
      <p>The moon is one-fourth the size of the earth but is big for a moon. Its mysterious backside has mountain ranges taller than the Himalayas. There are craters. Lots of craters. There are craters within craters within craters. Some are only an inch, and some go down a mile. There are craters so big the Grand Canyon could fit inside. One known crater is eighty-five miles wide and almost thirty thousand feet deep.</p>
      <p>I find it extremely symbolic that the moon keeps the most damaged (and interesting) side out of sight like so many of us.</p>
    </div>

    <div class="deeper-video">
      <video autoplay muted loop playsinline controls>
        <source src="/public/images/videoplayback.mp4" type="video/mp4">
      </video>
    </div>

    <p class="deeper-pullquote">Mark Twain once said, \u201cEveryone is a moon and has a dark side which he never shows to anybody.\u201d</p>

    <div class="deeper-body">
      <p>Extreme situations can lead to deeper happiness and more profound joy. What makes you weird is also what makes you wonderful. Your quirks and curiosities are packed full of potential. Your pain can make you powerful. Extreme gratitude will be the result of learning to embrace\u2014and trusting God to unleash\u2014the hidden potential of the dark side of your moon.</p>
      <p>Aren\u2019t you exhausted from sucking in and spinning around in every different situation and social media post to keep the dark side of your moon safely hidden and out of sight? I\u2019m not talking about putting your best foot forward; I\u2019m talking about that hidden, horrible secret you have carried for so long: that (you\u2019re pretty sure) there is something wrong with you. If people saw the real you, you think, they wouldn\u2019t want anything to do with you. So rather than being rejected, you just pretend.</p>
      <p>But you don\u2019t have to do that. Your character\u2019s craters, chasms, and canyons give texture and color and complexity that sparkle in your heavenly Father\u2019s eyes.</p>
    </div>

    <div class="deeper-image">
      <img src="/public/images/moon-craters.jpg" alt="The far side of the moon" />
    </div>

    <p class="deeper-pullquote">\u201cBlessed are the poor in spirit, for theirs is the kingdom of heaven. Blessed are those who mourn, for they shall be comforted. Blessed are the meek, for they shall inherit the earth. Blessed are those who hunger and thirst for righteousness, for they shall be&nbsp;filled.\u201d<br><span style="font-weight: 400; font-size: 0.7em; letter-spacing: 0;">(Matt. 5:3\u20138 NKJV)</span></p>

    <div class="deeper-body">
      <p>As you look full in His wonderful face, I believe you will stop feeling the need to keep the comet-strewn darkness of your shadow side hidden from sight. You\u2019ll step into the light. Then, and only then, will you discover that God is not afraid of what is behind you. He plans to address what is sinful, mend what is broken, and fill what is empty. He has a plan to use all of you\u2014not just the curated parts you currently feel comfortable letting the world see. He is all around you and already knows about the dark side of your moon.</p>
    </div>

    <div class="deeper-image">
      <img src="/public/images/landscape-wide.jpg" alt="Dramatic landscape" />
    </div>

    <p class="deeper-pullquote">The moon is one-fourth the size of the earth but is big for a moon. Its mysterious backside has mountain ranges taller than the Himalayas. There are craters.</p>

    <div class="deeper-body deeper-body-light" style="padding-bottom: 4rem;">
      <p>I find it extremely symbolic that the moon keeps the most damaged (and interesting) side out of sight like so many of us.</p>
      <p>Mark Twain once said, \u201cEveryone is a moon and has a dark side which he never shows to anybody.\u201d</p>
      <p>The irony, of course, is that even though the dark side is where damage has happened, it is also where the highest heights are located. Highlands rise higher above the surface there than on the near side. And craters plunge low. Craters, after all, are just mountains in reverse.</p>
      <p>The pockmarks and wounds you carry around inside and show to no one are not only where the most damage has happened; they are where your greatest potential strengths lie. As they say, the cracks are what let the light in.</p>
    </div>

    <div class="plan-cta">
      <p class="plan-cta-label">Excerpt from Day 1 of</p>
      <h3 class="plan-cta-title">The Last Supper on the Moon</h3>
      <img class="plan-cta-img" src="/public/images/plan-hero.png" alt="The Last Supper on the Moon — 5-Day Reading Plan" />
      <a class="rec-plan-btn" href="https://www.bible.com/reading-plans" target="_blank" rel="noopener">Start Plan</a>
    </div>

    <div class="deeper-image">
      <img src="/public/images/landscape-dark.jpg" alt="Mountain landscape" />
    </div>

    <div class="rec-plans">
      <h3 class="rec-plans-heading">Recommended Plans</h3>
      <div class="rec-plans-grid">
        <div class="rec-plan-card">
          <img class="rec-plan-img" src="/public/images/plan-1.jpg" alt="Living Changed Purpose" />
          <span class="rec-plan-title">Living Changed Purpose</span>
          <p class="rec-plan-desc">Discover how to live with renewed purpose and align your daily life with God\u2019s calling.</p>
          <a class="rec-plan-btn" href="https://www.bible.com/reading-plans" target="_blank" rel="noopener">Start</a>
        </div>
        <div class="rec-plan-card">
          <img class="rec-plan-img" src="/public/images/plan-2.jpg" alt="Freedom" />
          <span class="rec-plan-title">Freedom</span>
          <p class="rec-plan-desc">A 5-day devotional exploring the freedom found through faith and God\u2019s unending grace.</p>
          <a class="rec-plan-btn" href="https://www.bible.com/reading-plans" target="_blank" rel="noopener">Start</a>
        </div>
        <div class="rec-plan-card">
          <img class="rec-plan-img" src="/public/images/plan-3.jpg" alt="World in Crisis" />
          <span class="rec-plan-title">World in Crisis</span>
          <p class="rec-plan-desc">Find encouragement and hope in Scripture during seasons of uncertainty and hardship.</p>
          <a class="rec-plan-btn" href="https://www.bible.com/reading-plans" target="_blank" rel="noopener">Start</a>
        </div>
        <div class="rec-plan-card">
          <img class="rec-plan-img" src="/public/images/plan-4.jpg" alt="The Pursuit" />
          <span class="rec-plan-title">The Pursuit</span>
          <p class="rec-plan-desc">Chase after the heart of God with this plan on pursuing deeper intimacy with your Creator.</p>
          <a class="rec-plan-btn" href="https://www.bible.com/reading-plans" target="_blank" rel="noopener">Start</a>
        </div>
      </div>
    </div>

  </section>

  ${layout.footerHTML}

</body>
</html>`);
  } catch (err) {
    console.error(err);
    res.status(500).send('<pre>Error: ' + err.message + '</pre>');
  }
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

export default app;
