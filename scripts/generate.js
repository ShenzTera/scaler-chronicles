/**
 * The Scaler Chronicles — Daily Edition Generator
 * Fetches headlines from NewsAPI, finds cover images via Unsplash,
 * then writes public/index.html with today's fully-populated front page.
 *
 * Required env vars (set as GitHub Actions secrets):
 *   NEWS_API_KEY   — https://newsapi.org  (free tier: 100 req/day)
 *   UNSPLASH_KEY   — https://unsplash.com/oauth/applications (free: 50 req/hr)
 *
 * Sections fetched:
 *   Lead story  — top US/global headline
 *   Top Stories — business, technology, science  (3 cols)
 *   World       — world headlines  (2 cols)
 *   Opinion     — static placeholder (no API; you write these)
 *   Sport/Health — sports + health  (3 cols)
 *   Archive     — last 6 days auto-populated from earlier runs stored in public/archive/
 */

import fs   from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const PUBLIC    = path.join(ROOT, 'public');
const ARCHIVE   = path.join(PUBLIC, 'archive');

/* ── helpers ── */
const NEWS_KEY    = process.env.NEWS_API_KEY;
const UNSPLASH_KEY= process.env.UNSPLASH_KEY;

if (!NEWS_KEY)    throw new Error('NEWS_API_KEY env var not set');

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

/** Returns the first article from NewsAPI for the given query/category */
async function fetchArticle(params) {
  const base = 'https://newsapi.org/v2/top-headlines';
  const q    = new URLSearchParams({ ...params, apiKey: NEWS_KEY, pageSize: 5 });
  const data = await fetchJSON(`${base}?${q}`);
  const articles = (data.articles || []).filter(
    a => a.title && a.title !== '[Removed]' && a.description
  );
  return articles[0] || null;
}

async function fetchEverything(query, language = 'en') {
  const base = 'https://newsapi.org/v2/everything';
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const q = new URLSearchParams({
    q: query,
    language,
    sortBy: 'publishedAt',
    from: yesterday,
    pageSize: 5,
    apiKey: NEWS_KEY,
  });
  const data = await fetchJSON(`${base}?${q}`);
  const articles = (data.articles || []).filter(
    a => a.title && a.title !== '[Removed]' && a.description
  );
  return articles[0] || null;
}

/** Returns a proxy-safe image URL for a keyword via Unsplash or falls back to placeholder */
async function getImageUrl(keyword) {
  if (!UNSPLASH_KEY) return '';
  try {
    const q = new URLSearchParams({
      query: keyword,
      orientation: 'landscape',
      per_page: 1,
      client_id: UNSPLASH_KEY,
    });
    const data = await fetchJSON(`https://api.unsplash.com/search/photos?${q}`);
    const img = data?.results?.[0];
    if (!img) return '';
    // Use Unsplash's "regular" size (~1080px wide) with auto-format & compress
    return img.urls?.regular || '';
  } catch {
    return '';
  }
}

/** Strips HTML, shortens to ~250 chars for the card teaser */
function teaser(text = '', len = 250) {
  return text.replace(/<[^>]+>/g, '').slice(0, len) + (text.length > len ? '…' : '');
}

/** Format a JS Date as "Wednesday, June 4, 2026" */
function fmtDate(d = new Date()) {
  return d.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

/** Zero-pad */
function pad(n) { return String(n).padStart(2, '0'); }

/** Returns "jun04" style key from a Date */
function dayKey(d = new Date()) {
  const mon = d.toLocaleDateString('en-US', { month: 'short' }).toLowerCase();
  return `${mon}${pad(d.getDate())}`;
}

/* ═══════════════════════════════════════════════════════════
   MAIN
═══════════════════════════════════════════════════════════ */
async function main() {
  await fs.mkdir(ARCHIVE, { recursive: true });

  const today     = new Date();
  const todayFmt  = fmtDate(today);
  const todayKey  = dayKey(today);

  console.log(`Generating edition for ${todayFmt} (${todayKey}) …`);

  /* ── fetch all sections in parallel ── */
  const [lead, biz, tech, sci, worldA, worldB, sport, health] = await Promise.all([
    fetchArticle({ category: 'general', language: 'en' }),
    fetchArticle({ category: 'business', language: 'en' }),
    fetchArticle({ category: 'technology', language: 'en' }),
    fetchArticle({ category: 'science', language: 'en' }),
    fetchArticle({ category: 'general', language: 'en', country: 'gb' }),
    fetchEverything('international diplomacy OR climate OR geopolitics'),
    fetchEverything('sport OR athletics OR football OR tennis'),
    fetchEverything('health OR medicine OR research OR wellness'),
  ]);

  /* ── fetch images in parallel ── */
  const [
    leadImg, bizImg, techImg, sciImg, worldAImg, sportImg, healthImg
  ] = await Promise.all([
    lead   ? getImageUrl(lead.title.split(' ').slice(0,3).join(' '))   : Promise.resolve(''),
    biz    ? getImageUrl('business finance economy')                    : Promise.resolve(''),
    tech   ? getImageUrl('technology innovation')                      : Promise.resolve(''),
    sci    ? getImageUrl('science research laboratory')                : Promise.resolve(''),
    worldA ? getImageUrl('world news international')                   : Promise.resolve(''),
    sport  ? getImageUrl('sport athletics competition')                : Promise.resolve(''),
    health ? getImageUrl('health medicine wellness')                   : Promise.resolve(''),
  ]);

  /* ── build article objects ── */
  function makeArticle(raw, imgUrl, fallbackTag) {
    if (!raw) return { tag: fallbackTag, headline: 'Story loading…', deck: '', byline: '', imgSrc: imgUrl, body: '' };
    return {
      tag:      fallbackTag,
      headline: raw.title || '',
      deck:     raw.description || '',
      byline:   `By ${raw.author || raw.source?.name || 'Staff Reporter'}`,
      source:   raw.source?.name || '',
      url:      raw.url || '',
      imgSrc:   raw.urlToImage || imgUrl || '',
      body:     teaser(raw.content || raw.description || ''),
    };
  }

  const A = {
    lead:   makeArticle(lead,   leadImg,   'Breaking News'),
    biz:    makeArticle(biz,    bizImg,    'Business'),
    tech:   makeArticle(tech,   techImg,   'Technology'),
    sci:    makeArticle(sci,    sciImg,    'Science'),
    worldA: makeArticle(worldA, worldAImg, 'World'),
    worldB: makeArticle(worldB, '',        'Politics'),
    sport:  makeArticle(sport,  sportImg,  'Sport'),
    health: makeArticle(health, healthImg, 'Health'),
  };

  /* ── save today's data for archiving ── */
  await fs.writeFile(
    path.join(ARCHIVE, `${todayKey}.json`),
    JSON.stringify({ date: todayFmt, key: todayKey, articles: A }, null, 2)
  );

  /* ── load last 6 archive days ── */
  let archiveDays = [];
  for (let i = 1; i <= 6; i++) {
    const d   = new Date(today);
    d.setDate(d.getDate() - i);
    const key = dayKey(d);
    try {
      const raw  = await fs.readFile(path.join(ARCHIVE, `${key}.json`), 'utf8');
      const data = JSON.parse(raw);
      archiveDays.push({ key, label: fmtDate(d), ...data });
    } catch { /* archive day missing — skip */ }
  }

  /* ── helper: render an article card ── */
  function cardHTML(a, id, size = 'lg') {
    const img = a.imgSrc
      ? `<img src="${esc(a.imgSrc)}" alt="${esc(a.headline)}" loading="lazy">`
      : `<span class="img-ph">[ Image ]</span>`;
    return `
    <article class="article" onclick="openArticle('${id}')">
      <div class="article-tag">${esc(a.tag)}</div>
      <div class="article-img">${img}</div>
      <div class="article-caption">Source: ${esc(a.source)}</div>
      <h2 class="article-headline ${size}">${esc(a.headline)}</h2>
      <div class="article-byline">${esc(a.byline)}</div>
      <p class="article-body">${esc(a.body)}</p>
    </article>`;
  }

  function esc(s = '') {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  /* ── archive day buttons ── */
  const archiveBtns = [
    `<button class="day-btn today" data-key="${todayKey}" onclick="loadEdition(this)">
       <span class="day-name">${today.toLocaleDateString('en-US',{weekday:'short'}).toUpperCase()}</span>
       <span class="day-date">${today.toLocaleDateString('en-US',{month:'short',day:'numeric'})}</span>
     </button>`,
    ...archiveDays.map(d => {
      const dt = new Date(d.date);
      return `<button class="day-btn" data-key="${d.key}" onclick="loadEdition(this)">
        <span class="day-name">${dt.toLocaleDateString('en-US',{weekday:'short'}).toUpperCase()}</span>
        <span class="day-date">${dt.toLocaleDateString('en-US',{month:'short',day:'numeric'})}</span>
      </button>`;
    })
  ].join('\n');

  /* ── archive edition JS data ── */
  const archiveDataJS = archiveDays.map(d => {
    const a = d.articles || {};
    return `
  "${d.key}": {
    date: ${JSON.stringify(d.date)},
    lead: ${JSON.stringify(a.lead || {})},
    cols: [${JSON.stringify(a.biz||{})}, ${JSON.stringify(a.tech||{})}, ${JSON.stringify(a.sci||{})}]
  }`;
  }).join(',\n');

  /* ── full ARTICLES JS object ── */
  const articlesJS = Object.entries(A).map(([id, a]) =>
    `  "${id}": ${JSON.stringify(a)}`
  ).join(',\n');

  /* ══════════════════════════════════════════════════════
     HTML TEMPLATE
  ══════════════════════════════════════════════════════ */
  const html = /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>The Scaler Chronicles — ${todayFmt}</title>
  <meta name="description" content="The Scaler Chronicles: curated world news in classic broadsheet style."/>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400;1,700&family=IM+Fell+English:ital@0;1&family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet"/>
  <style>
    :root {
      --paper:      #f5efe0;
      --paper-dark: #e8dfc8;
      --ink:        #1a1209;
      --ink-mid:    #3a2e1e;
      --ink-faint:  #7a6a52;
      --rule:       #2a1f0e;
      --red:        #8b1a1a;
      --glass-bg:   rgba(245,239,224,0.55);
      --f-head:     'Playfair Display', Georgia, serif;
      --f-body:     'Libre Baskerville', Georgia, serif;
      --f-disp:     'IM Fell English', Georgia, serif;
    }
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{background:#2c2418 repeating-linear-gradient(90deg,rgba(0,0,0,.04) 0 1px,transparent 1px 40px) repeating-linear-gradient(0deg,rgba(0,0,0,.04) 0 1px,transparent 1px 40px);font-family:var(--f-body);color:var(--ink);min-height:100vh;padding:32px 16px 60px}

    .view{display:none}.view.active{display:block;animation:fadeUp .38s cubic-bezier(.22,1,.36,1)}
    @keyframes fadeUp{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}

    /* NEWSPAPER */
    .newspaper{max-width:960px;margin:0 auto;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)' opacity='.04'/%3E%3C/svg%3E"),linear-gradient(180deg,#f7f0e0 0%,#ede0c0 100%);background-color:var(--paper);box-shadow:0 2px 4px rgba(0,0,0,.3),0 8px 20px rgba(0,0,0,.4),0 20px 60px rgba(0,0,0,.3),inset 0 0 80px rgba(200,180,140,.15);border:1px solid #c8b898;padding:0 0 40px}

    /* MASTHEAD */
    .masthead{border-bottom:4px double var(--rule);padding:18px 24px 12px;text-align:center;background:linear-gradient(180deg,#f0e6cc,var(--paper))}
    .masthead::before{content:'';display:block;border-top:1px solid var(--rule);border-bottom:1px solid var(--rule);height:6px;margin-bottom:12px}
    .newspaper-name{font-family:var(--f-head);font-size:clamp(2.8rem,7vw,5.2rem);font-weight:900;line-height:1;color:var(--ink);text-shadow:2px 2px 0 rgba(0,0,0,.12)}
    .mast-icon{font-size:1.6rem;margin:0 12px;opacity:.7}
    .tagline{font-family:var(--f-disp);font-style:italic;font-size:.78rem;color:var(--ink-mid);letter-spacing:.12em;margin-top:4px;text-transform:uppercase}
    .meta-bar{display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--rule);border-bottom:1px solid var(--rule);margin-top:10px;padding:4px 0;font-size:.7rem;color:var(--ink-mid);letter-spacing:.08em;text-transform:uppercase}

    /* LABELS */
    .section-label{display:flex;align-items:center;gap:10px;margin:20px 24px 0;font-family:var(--f-head);font-size:.72rem;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:var(--paper)}
    .section-label span{background:var(--ink);padding:3px 10px}
    .section-label::after{content:'';flex:1;height:1px;background:var(--ink);opacity:.35}
    .h-rule{border:none;border-top:1px solid var(--rule);margin:0 24px;opacity:.4}
    .h-rule-bold{border:none;border-top:3px double var(--rule);margin:0 24px;opacity:.6}

    /* GRIDS */
    .columns{display:grid;padding:16px 24px}
    .col-3{grid-template-columns:repeat(3,1fr)}
    .col-2{grid-template-columns:repeat(2,1fr)}
    .col-1-2{grid-template-columns:2fr 1fr 1fr}

    /* ARTICLE CARDS */
    .article{padding:16px;cursor:pointer;transition:background .2s;position:relative;border-right:1px solid rgba(42,31,14,.2)}
    .article:last-child{border-right:none}
    .article:hover{background:var(--glass-bg);backdrop-filter:blur(6px)}
    .article::after{content:'READ MORE →';position:absolute;bottom:10px;right:14px;font-size:.58rem;letter-spacing:.12em;color:var(--red);opacity:0;transition:opacity .2s;font-weight:700;font-family:var(--f-body)}
    .article:hover::after{opacity:1}
    .article-featured{padding:20px 24px;border-bottom:3px double var(--rule);cursor:pointer;transition:background .2s;position:relative}
    .article-featured:hover{background:var(--glass-bg)}
    .article-featured::after{content:'READ FULL STORY →';position:absolute;bottom:12px;right:24px;font-size:.6rem;letter-spacing:.14em;color:var(--red);opacity:0;transition:opacity .2s;font-weight:700;font-family:var(--f-body)}
    .article-featured:hover::after{opacity:1}
    .article-tag{font-size:.58rem;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:var(--red);margin-bottom:5px}
    .article-headline{font-family:var(--f-head);font-size:1.18rem;font-weight:700;line-height:1.2;color:var(--ink);margin-bottom:6px}
    .article-headline.xl{font-size:2rem;line-height:1.1}
    .article-headline.lg{font-size:1.5rem}
    .article-deck{font-family:var(--f-disp);font-style:italic;font-size:.85rem;color:var(--ink-mid);margin-bottom:8px;line-height:1.4}
    .article-byline{font-size:.62rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-faint);margin-bottom:8px;border-bottom:1px solid rgba(42,31,14,.2);padding-bottom:6px}
    .article-body{font-size:.78rem;line-height:1.7;color:var(--ink-mid)}
    .article-img{width:100%;aspect-ratio:4/3;background:var(--paper-dark);border:1px solid rgba(42,31,14,.2);margin-bottom:8px;display:flex;align-items:center;justify-content:center;overflow:hidden}
    .article-img img{width:100%;height:100%;object-fit:cover;filter:sepia(30%) contrast(1.05);display:block}
    .img-ph{font-size:.65rem;letter-spacing:.15em;text-transform:uppercase;color:var(--ink-faint);font-family:var(--f-body)}
    .article-caption{font-size:.6rem;font-style:italic;color:var(--ink-faint);border-top:1px solid rgba(42,31,14,.2);padding-top:4px;margin-bottom:8px}
    .read-more-link{display:inline-block;margin-top:8px;font-size:.62rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--red);text-decoration:none}
    .read-more-link:hover{text-decoration:underline}

    /* AD */
    .ad-block{border:2px solid var(--rule);padding:14px;margin:14px 24px;text-align:center;background:linear-gradient(135deg,#ede0c0,#f5efe0)}
    .ad-block::before{content:'— ADVERTISEMENT —';display:block;font-size:.55rem;letter-spacing:.22em;color:var(--ink-faint);margin-bottom:8px}
    .ad-label{font-family:var(--f-head);font-size:1.1rem;font-weight:900;color:var(--ink)}
    .ad-text{font-size:.7rem;color:var(--ink-mid);margin-top:4px;font-style:italic}

    .newspaper-footer{border-top:3px double var(--rule);margin:24px 24px 0;padding-top:10px;display:flex;justify-content:space-between;font-size:.62rem;color:var(--ink-faint);letter-spacing:.05em}

    /* ARCHIVE BAR */
    .archive-bar{max-width:960px;margin:28px auto 0;background:rgba(20,14,6,.75);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.1);border-radius:3px;padding:20px 28px 22px;box-shadow:0 8px 32px rgba(0,0,0,.5)}
    .archive-bar-title{font-family:var(--f-head);font-size:.68rem;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:rgba(245,239,224,.5);margin-bottom:14px;display:flex;align-items:center;gap:10px}
    .archive-bar-title::before,.archive-bar-title::after{content:'';flex:1;height:1px;background:rgba(245,239,224,.18)}
    .archive-days{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}
    .day-btn{background:rgba(245,239,224,.07);border:1px solid rgba(245,239,224,.18);color:rgba(245,239,224,.75);font-family:var(--f-body);font-size:.68rem;letter-spacing:.06em;cursor:pointer;padding:8px 16px;border-radius:2px;transition:all .2s;display:flex;flex-direction:column;align-items:center;gap:2px;min-width:82px}
    .day-btn .day-name{font-weight:700;font-size:.75rem;text-transform:uppercase;letter-spacing:.12em}
    .day-btn .day-date{font-size:.6rem;color:rgba(245,239,224,.42)}
    .day-btn:hover{background:rgba(245,239,224,.17);border-color:rgba(245,239,224,.45);color:var(--paper);transform:translateY(-2px);box-shadow:0 4px 16px rgba(0,0,0,.4)}
    .day-btn.today{background:var(--red);border-color:var(--red);color:var(--paper)}
    .day-btn.today .day-date{color:rgba(245,239,224,.7)}

    /* BACK BAR */
    .back-bar{max-width:960px;margin:0 auto 12px;display:flex;align-items:center;gap:14px}
    .back-btn{background:rgba(245,239,224,.12);border:1px solid rgba(245,239,224,.25);color:rgba(245,239,224,.85);font-family:var(--f-body);font-size:.7rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;padding:7px 16px;border-radius:2px;transition:all .18s}
    .back-btn:hover{background:rgba(245,239,224,.22);color:var(--paper)}
    .back-bar-label{font-family:var(--f-disp);font-style:italic;font-size:.8rem;color:rgba(245,239,224,.45)}

    /* FULL ARTICLE PAGE */
    .article-page{max-width:800px;margin:0 auto;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)' opacity='.04'/%3E%3C/svg%3E"),linear-gradient(180deg,#f7f0e0,#ede0c0);background-color:var(--paper);box-shadow:0 4px 30px rgba(0,0,0,.5),0 0 0 1px rgba(200,180,140,.5);border-radius:2px;overflow:hidden}
    .ap-accent{height:5px;background:linear-gradient(90deg,var(--red),#c0392b,var(--red))}
    .ap-inner{padding:44px 52px 60px}
    .ap-nav{display:flex;align-items:center;justify-content:space-between;margin-bottom:28px;border-bottom:1px solid rgba(42,31,14,.18);padding-bottom:14px}
    .ap-nav .ap-back{font-size:.62rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--red);cursor:pointer;background:none;border:none;font-family:var(--f-body);transition:opacity .15s}
    .ap-nav .ap-back:hover{opacity:.65}
    .ap-nav .ap-paper{font-family:var(--f-head);font-size:.85rem;font-weight:900;color:var(--ink-faint)}
    .ap-tag{font-size:.62rem;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:var(--red);margin-bottom:10px}
    .ap-headline{font-family:var(--f-head);font-size:clamp(1.9rem,4vw,3rem);font-weight:900;line-height:1.08;color:var(--ink);margin-bottom:12px}
    .ap-deck{font-family:var(--f-disp);font-style:italic;font-size:1.08rem;color:var(--ink-mid);border-top:1px solid var(--rule);border-bottom:1px solid var(--rule);padding:10px 0;margin-bottom:16px}
    .ap-byline{font-size:.65rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-faint);margin-bottom:24px}
    .ap-image{width:100%;max-height:360px;object-fit:cover;filter:sepia(25%) contrast(1.05);margin-bottom:8px;border:1px solid rgba(42,31,14,.2);display:block}
    .ap-img-wrap{margin-bottom:22px}
    .ap-img-ph{width:100%;aspect-ratio:16/9;background:var(--paper-dark);border:1px solid rgba(42,31,14,.18);display:flex;align-items:center;justify-content:center}
    .ap-img-ph span{font-size:.65rem;letter-spacing:.15em;text-transform:uppercase;color:var(--ink-faint)}
    .ap-caption{font-size:.63rem;font-style:italic;color:var(--ink-faint);padding-top:5px;border-bottom:1px solid rgba(42,31,14,.12);padding-bottom:8px}
    .ap-body{font-size:.88rem;line-height:1.9;color:var(--ink-mid);column-count:2;column-gap:32px;column-rule:1px solid rgba(42,31,14,.18)}
    .ap-body p{margin-bottom:14px}
    .ap-body p:first-child::first-letter{font-family:var(--f-head);font-size:3.8rem;font-weight:900;float:left;line-height:.82;margin:6px 6px 0 0;color:var(--ink)}
    .ap-source-link{display:inline-block;margin-top:18px;font-size:.7rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--red);text-decoration:none;border:1px solid var(--red);padding:6px 14px}
    .ap-source-link:hover{background:var(--red);color:var(--paper)}
    .ap-bottom-nav{max-width:800px;margin:16px auto 0;display:flex;gap:12px;align-items:center}

    @media(max-width:640px){
      .col-3,.col-2,.col-1-2{grid-template-columns:1fr}
      .article{border-right:none;border-bottom:1px solid rgba(42,31,14,.2)}
      .ap-inner{padding:24px 18px 40px}
      .ap-body{column-count:1}
      .day-btn{min-width:68px;padding:7px 10px}
      .newspaper-footer{flex-direction:column;gap:4px}
    }
  </style>
</head>
<body>

<!-- ═══ VIEW: FRONT PAGE ═══ -->
<div class="view active" id="view-front">
<div class="newspaper">

  <header class="masthead">
    <div class="newspaper-name">
      <span class="mast-icon">⚜</span> The Scaler Chronicles <span class="mast-icon">⚜</span>
    </div>
    <div class="tagline">"Bringing A Modern Touch To Traditional Newspaper — Est. 2026"</div>
    <div class="meta-bar">
      <span>${todayFmt}</span>
      <span style="font-style:italic">Vol. I · Daily Edition</span>
      <span>$0</span>
    </div>
  </header>

  <!-- LEAD STORY -->
  <article class="article-featured" onclick="openArticle('lead')">
    <div class="article-tag">${esc(A.lead.tag)}</div>
    <h1 class="article-headline xl" style="max-width:680px">${esc(A.lead.headline)}</h1>
    <p class="article-deck">${esc(A.lead.deck)}</p>
    <div class="article-byline">${esc(A.lead.byline)}</div>
    <p class="article-body">${esc(A.lead.body)}</p>
  </article>

  <div class="section-label"><span>Top Stories</span></div>
  <div class="columns col-3">
    ${cardHTML(A.biz,   'biz',   'lg')}
    ${cardHTML(A.tech,  'tech',  'lg')}
    ${cardHTML(A.sci,   'sci',   'lg')}
  </div>

  <hr class="h-rule-bold">
  <div class="section-label"><span>World &amp; Politics</span></div>
  <div class="columns col-1-2">
    <article class="article" onclick="openArticle('worldA')" style="border-right:1px solid rgba(42,31,14,.25)">
      <div class="article-tag">${esc(A.worldA.tag)}</div>
      <div class="article-img" style="aspect-ratio:16/9">
        ${A.worldA.imgSrc ? `<img src="${esc(A.worldA.imgSrc)}" alt="${esc(A.worldA.headline)}" loading="lazy">` : `<span class="img-ph">[ World Image ]</span>`}
      </div>
      <div class="article-caption">Source: ${esc(A.worldA.source)}</div>
      <h2 class="article-headline xl">${esc(A.worldA.headline)}</h2>
      <p class="article-deck">${esc(A.worldA.deck)}</p>
      <div class="article-byline">${esc(A.worldA.byline)}</div>
      <p class="article-body" style="column-count:2;column-gap:14px;column-rule:1px solid rgba(42,31,14,.18)">${esc(A.worldA.body)}</p>
    </article>
    <div style="display:flex;flex-direction:column">
      <article class="article" onclick="openArticle('worldB')" style="flex:1;border-bottom:1px solid rgba(42,31,14,.2)">
        <div class="article-tag">${esc(A.worldB.tag)}</div>
        <h2 class="article-headline">${esc(A.worldB.headline)}</h2>
        <div class="article-byline">${esc(A.worldB.byline)}</div>
        <p class="article-body">${esc(A.worldB.body)}</p>
      </article>
    </div>
  </div>

  <hr class="h-rule">
  <div class="ad-block">
    <div class="ad-label">✦ Your Advertisement Here ✦</div>
    <div class="ad-text">Insert sponsor message — or delete this block</div>
  </div>
  <hr class="h-rule">

  <div class="section-label"><span>Sport &amp; Health</span></div>
  <div class="columns col-2">
    ${cardHTML(A.sport,  'sport',  'lg')}
    ${cardHTML(A.health, 'health', 'lg')}
  </div>

  <footer class="newspaper-footer">
    <span>© 2026 The Scaler Chronicles.</span>
    <span>${todayFmt} · Auto-generated daily edition</span>
    <span>Powered by NewsAPI &amp; Unsplash</span>
  </footer>
</div>
</div><!-- /view-front -->

<!-- ═══ VIEW: ARCHIVE ═══ -->
<div class="view" id="view-archive">
  <div class="back-bar">
    <button class="back-btn" onclick="showView('front')">← Today's Edition</button>
    <span class="back-bar-label" id="archive-label">Archive</span>
  </div>
  <div id="archive-content"></div>
</div>

<!-- ═══ VIEW: FULL ARTICLE ═══ -->
<div class="view" id="view-article">
  <div class="back-bar">
    <button class="back-btn" onclick="goBack()">← Back</button>
  </div>
  <div class="article-page">
    <div class="ap-accent"></div>
    <div class="ap-inner">
      <nav class="ap-nav">
        <button class="ap-back" onclick="goBack()">← Back</button>
        <span class="ap-paper">The Scaler Chronicles</span>
      </nav>
      <div id="ap-tag" class="ap-tag"></div>
      <h1 id="ap-headline" class="ap-headline"></h1>
      <p id="ap-deck" class="ap-deck"></p>
      <div id="ap-byline" class="ap-byline"></div>
      <div id="ap-img-wrap" class="ap-img-wrap"></div>
      <div id="ap-body" class="ap-body"></div>
      <div id="ap-source-wrap"></div>
    </div>
  </div>
  <div class="ap-bottom-nav">
    <button class="back-btn" onclick="goBack()">← Back to Paper</button>
  </div>
</div>

<!-- ═══ ARCHIVE BAR ═══ -->
<div class="archive-bar">
  <div class="archive-bar-title">Past Editions</div>
  <div class="archive-days" id="archive-days">
    ${archiveBtns}
  </div>
</div>

<script>
/* ── Article data (injected at build time) ── */
const ARTICLES = {
${articlesJS}
};

/* ── Archive day data ── */
const ARCHIVE_DATA = {
${archiveDataJS}
};

let previousView = 'front';

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const t = document.getElementById('view-' + name);
  if (t) t.classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function loadEdition(btn) {
  const key = btn.dataset.key;
  if (key === '${todayKey}') { showView('front'); return; }
  const ed = ARCHIVE_DATA[key];
  if (!ed) { alert('Edition not found: ' + key); return; }
  const lead = ed.lead || {};
  let colsHTML = '';
  if (ed.cols && ed.cols.length) {
    const cards = ed.cols.map((a, i) => {
      if (!a || !a.headline) return '';
      const archiveId = key + '-col' + i;
      ARTICLES[archiveId] = a;
      const img = a.imgSrc
        ? \`<img src="\${a.imgSrc}" alt="" loading="lazy">\`
        : '<span class="img-ph">[ Image ]</span>';
      return \`<article class="article" onclick="openArticle('\${archiveId}')">
        <div class="article-tag">\${a.tag||''}</div>
        <div class="article-img">\${img}</div>
        <h2 class="article-headline lg">\${a.headline||''}</h2>
        <div class="article-byline">\${a.byline||''}</div>
        <p class="article-body">\${(a.body||'').substring(0,200)}…</p>
      </article>\`;
    }).join('');
    colsHTML = \`<hr class="h-rule-bold"><div class="section-label"><span>More Stories</span></div><div class="columns col-3">\${cards}</div>\`;
  }
  const archiveLeadId = key + '-lead';
  ARTICLES[archiveLeadId] = lead;
  const leadImg = lead.imgSrc
    ? \`<div class="article-img" style="aspect-ratio:16/9"><img src="\${lead.imgSrc}" alt="" loading="lazy"></div>\`
    : '';
  document.getElementById('archive-content').innerHTML = \`
    <div class="newspaper">
      <header class="masthead">
        <div class="newspaper-name"><span class="mast-icon">⚜</span> The Scaler Chronicles <span class="mast-icon">⚜</span></div>
        <div class="tagline">"Bringing A Modern Touch To Traditional Newspaper — Est. 2026"</div>
        <div class="meta-bar"><span>\${ed.date}</span><span style="font-style:italic">Archive Edition</span><span>$0</span></div>
      </header>
      <article class="article-featured" onclick="openArticle('\${archiveLeadId}')">
        <div class="article-tag">\${lead.tag||''}</div>
        \${leadImg}
        <h1 class="article-headline xl" style="max-width:620px">\${lead.headline||''}</h1>
        <p class="article-deck">\${lead.deck||''}</p>
        <div class="article-byline">\${lead.byline||''}</div>
        <p class="article-body">\${(lead.body||'').substring(0,280)}…</p>
      </article>
      \${colsHTML}
      <footer class="newspaper-footer">
        <span>© 2026 The Scaler Chronicles.</span>
        <span>\${ed.date} · Archive</span>
        <span>The Scaler Chronicles</span>
      </footer>
    </div>\`;
  document.getElementById('archive-label').textContent = ed.date + ' — Archive';
  previousView = 'archive';
  showView('archive');
}

function openArticle(id) {
  const a = ARTICLES[id];
  if (!a) { alert('Article not found: ' + id); return; }
  document.getElementById('ap-tag').textContent      = a.tag || '';
  document.getElementById('ap-headline').textContent = a.headline || '';
  document.getElementById('ap-deck').textContent     = a.deck || '';
  document.getElementById('ap-byline').textContent   = a.byline || '';

  let imgHTML = a.imgSrc
    ? \`<img class="ap-image" src="\${a.imgSrc}" alt="\${a.headline||''}" loading="lazy">\`
    : '<div class="ap-img-ph"><span>[ No image available ]</span></div>';
  if (a.caption) imgHTML += \`<div class="ap-caption">\${a.caption}</div>\`;
  document.getElementById('ap-img-wrap').innerHTML = imgHTML;

  document.getElementById('ap-body').innerHTML =
    '<p>' + (a.body || 'Full article text not available in preview mode.') + '</p>';

  const sourceWrap = document.getElementById('ap-source-wrap');
  if (a.url) {
    sourceWrap.innerHTML =
      \`<a class="ap-source-link" href="\${a.url}" target="_blank" rel="noopener">
         Read Full Story at \${a.source || 'Source'} →
       </a>\`;
  } else {
    sourceWrap.innerHTML = '';
  }

  const cur = document.querySelector('.view.active');
  previousView = cur ? cur.id.replace('view-', '') : 'front';
  showView('article');
}

function goBack() { showView(previousView); }

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (document.getElementById('view-article').classList.contains('active')) goBack();
  }
});
</script>
</body>
</html>`;

  const outPath = path.join(PUBLIC, 'index.html');
  await fs.writeFile(outPath, html, 'utf8');
  console.log(`✅ Written: ${outPath}`);

  /* Tidy old archive files — keep only last 30 days */
  const files = await fs.readdir(ARCHIVE);
  const jsonFiles = files.filter(f => f.endsWith('.json')).sort();
  if (jsonFiles.length > 30) {
    const toDelete = jsonFiles.slice(0, jsonFiles.length - 30);
    await Promise.all(toDelete.map(f => fs.unlink(path.join(ARCHIVE, f))));
    console.log(`🗑  Removed ${toDelete.length} old archive file(s)`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
