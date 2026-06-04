/**
 * The Scaler Chronicles — Daily Edition Generator v2
 *
 * Fixes in this version:
 *  - Much longer article body text (pulls full content + description together)
 *  - More articles per section (3 per category instead of 1)
 *  - Better image handling: NewsAPI image → Unsplash fallback → topic placeholder
 *  - New sections: Entertainment, Environment
 *  - Richer full-article view with properly split paragraphs
 *
 * Required env vars:
 *   NEWS_API_KEY   — https://newsapi.org
 *   UNSPLASH_KEY   — https://unsplash.com/oauth/applications (optional but recommended)
 */

import fs   from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const PUBLIC    = path.join(ROOT, 'public');
const ARCHIVE   = path.join(PUBLIC, 'archive');

const NEWS_KEY     = process.env.NEWS_API_KEY;
const UNSPLASH_KEY = process.env.UNSPLASH_KEY;

if (!NEWS_KEY) throw new Error('NEWS_API_KEY env var not set');

/* ─── fetch helpers ─────────────────────────────────────────── */

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

/** Fetch up to `count` articles from top-headlines */
async function fetchHeadlines(params, count = 3) {
  const q = new URLSearchParams({ ...params, apiKey: NEWS_KEY, pageSize: count + 10 });
  const data = await fetchJSON(`https://newsapi.org/v2/top-headlines?${q}`);
  const seen = new Set();
  return (data.articles || [])
    .filter(a => {
      if (!a.title || a.title === '[Removed]' || !a.description || !a.url) return false;
      const key = a.title.slice(0, 60).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, count);
}

/** Fetch up to `count` articles from everything endpoint */
async function fetchEverything(query, count = 3) {
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const q = new URLSearchParams({
    q: query, language: 'en', sortBy: 'publishedAt',
    from: yesterday, pageSize: count + 10, apiKey: NEWS_KEY,
  });
  const data = await fetchJSON(`https://newsapi.org/v2/everything?${q}`);
  const seen = new Set();
  return (data.articles || [])
    .filter(a => {
      if (!a.title || a.title === '[Removed]' || !a.description || !a.url) return false;
      const key = a.title.slice(0, 60).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, count);
}
/** Unsplash image for a keyword — returns URL string or '' */
async function unsplashImg(keyword) {
  if (!UNSPLASH_KEY) return '';
  try {
    const q = new URLSearchParams({
      query: keyword, orientation: 'landscape', per_page: 1, client_id: UNSPLASH_KEY,
    });
    const data = await fetchJSON(`https://api.unsplash.com/search/photos?${q}`);
    return data?.results?.[0]?.urls?.regular || '';
  } catch { return ''; }
}

/**
 * Best image for an article:
 * 1. Article's own urlToImage (most relevant)
 * 2. Unsplash search on the headline keywords
 * 3. Unsplash search on the topic fallback term
 */
async function bestImage(article, topicFallback) {
  if (article?.urlToImage) return article.urlToImage;
  if (!UNSPLASH_KEY) return '';
  const keywords = (article?.title || '').split(' ').slice(0, 4).join(' ');
  const img = await unsplashImg(keywords);
  if (img) return img;
  return unsplashImg(topicFallback);
}

/* ─── text helpers ──────────────────────────────────────────── */

function stripHtml(s = '') {
  return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Build a rich body for the full-article view.
 * NewsAPI `content` field is truncated at 200 chars with "[+N chars]".
 * We stitch content + description together and expand into paragraphs.
 */
function buildBody(raw) {
  if (!raw) return '';
  // Remove the "[+N chars]" truncation marker
  const content = stripHtml(raw.content || '').replace(/\[\+\d+ chars\]$/, '').trim();
  const desc    = stripHtml(raw.description || '');
  // Combine, deduplicate overlapping text
  let full = content;
  if (desc && !content.includes(desc.slice(0, 40))) {
    full = desc + '\n\n' + content;
  }
  // Split into paragraphs on double-newline or ". " boundaries (~100 word chunks)
  const sentences = full.split(/(?<=\.)\s+/);
  const paras = [];
  let para = '';
  for (const s of sentences) {
    para += (para ? ' ' : '') + s;
    if (para.split(' ').length >= 40) { paras.push(para); para = ''; }
  }
  if (para) paras.push(para);
  return paras.length ? paras : [full];
}

/** Short teaser ~180 chars for card previews */
function teaser(raw) {
  const t = stripHtml(raw?.description || raw?.content || '').replace(/\[\+\d+ chars\]/, '');
  return t.length > 180 ? t.slice(0, 180) + '…' : t;
}

function fmtDate(d = new Date()) {
  return d.toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
}
function pad(n) { return String(n).padStart(2, '0'); }
function dayKey(d = new Date()) {
  return d.toLocaleDateString('en-US', { month:'short' }).toLowerCase() + pad(d.getDate());
}
function esc(s = '') {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/* ─── article object builder ────────────────────────────────── */

function makeArticle(raw, imgSrc, tag) {
  if (!raw) return { tag, headline:'Story unavailable', deck:'', byline:'', imgSrc:'', body:[], teaser:'', url:'', source:'' };
  return {
    tag,
    headline: raw.title || '',
    deck:     stripHtml(raw.description || ''),
    byline:   `By ${(raw.author || raw.source?.name || 'Staff Reporter').split(',')[0].trim()}`,
    source:   raw.source?.name || '',
    url:      raw.url || '',
    imgSrc:   imgSrc || '',
    teaser:   teaser(raw),
    body:     buildBody(raw),
  };
}

/* ─── HTML card renderers ────────────────────────────────────── */

function imgBlock(a, ratio = '4/3') {
  if (a.imgSrc) {
    return `<div class="article-img" style="aspect-ratio:${ratio}">
      <img src="${esc(a.imgSrc)}" alt="${esc(a.headline)}" loading="lazy" onerror="this.parentElement.innerHTML='<span class=img-ph>[ Image unavailable ]</span>'">
    </div>
    <div class="article-caption">Source: ${esc(a.source)}</div>`;
  }
  return `<div class="article-img" style="aspect-ratio:${ratio}"><span class="img-ph">[ ${esc(a.tag)} ]</span></div>
  <div class="article-caption">Source: ${esc(a.source)}</div>`;
}

function cardHTML(a, id, size = 'md') {
  return `
  <article class="article" onclick="openArticle('${id}')">
    <div class="article-tag">${esc(a.tag)}</div>
    ${imgBlock(a)}
    <h2 class="article-headline ${size}">${esc(a.headline)}</h2>
    <div class="article-byline">${esc(a.byline)}</div>
    <p class="article-body">${esc(a.teaser)}</p>
  </article>`;
}

function sectionLabel(title) {
  return `<div class="section-label"><span>${title}</span></div>`;
}

/* ═══════════════════════════════════════════════════════════════
   MAIN
═══════════════════════════════════════════════════════════════ */
async function main() {
  await fs.mkdir(ARCHIVE, { recursive: true });

  const today    = new Date();
  const todayFmt = fmtDate(today);
  const todayKey = dayKey(today);

  console.log(`📰 Generating edition: ${todayFmt} (${todayKey})`);

  /* ── 1. Fetch all article batches in parallel ── */
  const [
    generalBatch, bizBatch, techBatch, sciBatch,
    worldBatch, politicsBatch, sportBatch, healthBatch,
    entertainBatch, envBatch,
  ] = await Promise.all([
    fetchHeadlines({ category: 'general',       language: 'en' }, 3),
    fetchHeadlines({ category: 'business',      language: 'en' }, 3),
    fetchHeadlines({ category: 'technology',    language: 'en' }, 3),
    fetchHeadlines({ category: 'science',       language: 'en' }, 3),
    fetchEverything('world news OR global OR international', 3),
    fetchHeadlines({ category: 'general', language: 'en', country: 'us' }, 3),
    fetchHeadlines({ category: 'sports',  language: 'en' }, 3),
    fetchHeadlines({ category: 'health',  language: 'en' }, 3),
    fetchHeadlines({ category: 'entertainment', language: 'en' }, 3),
    fetchEverything('climate change OR environment OR renewable energy OR carbon emissions', 3),
  ]);

  /* ── 2. Fetch images for EVERY article in every batch ── */
  const lead = generalBatch[0];

  // Helper: get images for all articles in a batch using a topic fallback
  async function batchImages(articles, topicFallback) {
    return Promise.all(articles.map(a => bestImage(a, topicFallback)));
  }

  const [
    generalImgs, bizImgs, techImgs, sciImgs,
    worldImgs, politicsImgs, sportImgs, healthImgs,
    entertainImgs, envImgs,
  ] = await Promise.all([
    batchImages(generalBatch,   'world news breaking'),
    batchImages(bizBatch,       'business finance economy'),
    batchImages(techBatch,      'technology innovation computers'),
    batchImages(sciBatch,       'science research laboratory'),
    batchImages(worldBatch,     'world international news'),
    batchImages(politicsBatch,  'politics government parliament'),
    batchImages(sportBatch,     'sport athletics competition'),
    batchImages(healthBatch,    'health medicine wellness'),
    batchImages(entertainBatch, 'entertainment film music'),
    batchImages(envBatch,       'nature environment climate'),
  ]);

  /* ── 3. Build article objects ── */
  const A = {
    lead:      makeArticle(lead,              generalImgs[0],   'Breaking News'),
    lead2:     makeArticle(generalBatch[1],   generalImgs[1],   'Top Story'),
    lead3:     makeArticle(generalBatch[2],   generalImgs[2],   'Top Story'),

    biz1:      makeArticle(bizBatch[0],       bizImgs[0],       'Business'),
    biz2:      makeArticle(bizBatch[1],       bizImgs[1],       'Business'),
    biz3:      makeArticle(bizBatch[2],       bizImgs[2],       'Business'),

    tech1:     makeArticle(techBatch[0],      techImgs[0],      'Technology'),
    tech2:     makeArticle(techBatch[1],      techImgs[1],      'Technology'),
    tech3:     makeArticle(techBatch[2],      techImgs[2],      'Technology'),

    sci1:      makeArticle(sciBatch[0],       sciImgs[0],       'Science'),
    sci2:      makeArticle(sciBatch[1],       sciImgs[1],       'Science'),
    sci3:      makeArticle(sciBatch[2],       sciImgs[2],       'Science'),

    world1:    makeArticle(worldBatch[0],     worldImgs[0],     'World'),
    world2:    makeArticle(worldBatch[1],     worldImgs[1],     'World'),
    world3:    makeArticle(worldBatch[2],     worldImgs[2],     'World'),

    pol1:      makeArticle(politicsBatch[0],  politicsImgs[0],  'Politics'),
    pol2:      makeArticle(politicsBatch[1],  politicsImgs[1],  'Politics'),
    pol3:      makeArticle(politicsBatch[2],  politicsImgs[2],  'Politics'),

    sport1:    makeArticle(sportBatch[0],     sportImgs[0],     'Sport'),
    sport2:    makeArticle(sportBatch[1],     sportImgs[1],     'Sport'),
    sport3:    makeArticle(sportBatch[2],     sportImgs[2],     'Sport'),

    health1:   makeArticle(healthBatch[0],    healthImgs[0],    'Health'),
    health2:   makeArticle(healthBatch[1],    healthImgs[1],    'Health'),
    health3:   makeArticle(healthBatch[2],    healthImgs[2],    'Health'),

    ent1:      makeArticle(entertainBatch[0], entertainImgs[0], 'Entertainment'),
    ent2:      makeArticle(entertainBatch[1], entertainImgs[1], 'Entertainment'),
    ent3:      makeArticle(entertainBatch[2], entertainImgs[2], 'Entertainment'),

    env1:      makeArticle(envBatch[0],       envImgs[0],       'Environment'),
    env2:      makeArticle(envBatch[1],       envImgs[1],       'Environment'),
    env3:      makeArticle(envBatch[2],       envImgs[2],       'Environment'),
  };

  /* ── 4. Save archive JSON ── */
  await fs.writeFile(
    path.join(ARCHIVE, `${todayKey}.json`),
    JSON.stringify({ date: todayFmt, key: todayKey, articles: A }, null, 2)
  );

  /* ── 5. Load past 6 days for archive bar ── */
  const archiveDays = [];
  for (let i = 1; i <= 6; i++) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const key = dayKey(d);
    try {
      const raw  = await fs.readFile(path.join(ARCHIVE, `${key}.json`), 'utf8');
      archiveDays.push({ key, ...JSON.parse(raw) });
    } catch { /* day not yet generated */ }
  }

  /* ── 6. Build archive bar buttons ── */
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

  /* ── 7. JS data blobs ── */
  const articlesJS    = Object.entries(A).map(([id,a]) => `  "${id}": ${JSON.stringify(a)}`).join(',\n');
  const archiveDataJS = archiveDays.map(d =>
    `  "${d.key}": ${JSON.stringify({ date: d.date, articles: d.articles || {} })}`
  ).join(',\n');

  /* ══════════════════════════════════════════════════════════════
     HTML OUTPUT
  ══════════════════════════════════════════════════════════════ */
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
      --paper:#f5efe0; --paper-dark:#e8dfc8; --ink:#1a1209; --ink-mid:#3a2e1e;
      --ink-faint:#7a6a52; --rule:#2a1f0e; --red:#8b1a1a;
      --f-head:'Playfair Display',Georgia,serif;
      --f-body:'Libre Baskerville',Georgia,serif;
      --f-disp:'IM Fell English',Georgia,serif;
    }
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{
  background-color: #1a110a;
  background-image:
    radial-gradient(circle, #8b6914 1px, transparent 1px),
    radial-gradient(circle, #5c3d0a 1px, transparent 1px);
  background-size: 28px 28px, 14px 14px;
  background-position: 0 0, 7px 7px;
  font-family:var(--f-body);
  color:var(--ink);
  min-height:100vh;
  padding:32px 16px 60px;
}
    .view{display:none}.view.active{display:block;animation:fadeUp .38s cubic-bezier(.22,1,.36,1)}
    @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}

    /* NEWSPAPER SHELL */
    .newspaper{max-width:980px;margin:0 auto;background-color:var(--paper);
      background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)' opacity='.04'/%3E%3C/svg%3E"),linear-gradient(180deg,#f7f0e0,#ede0c0);
      box-shadow:0 2px 4px rgba(0,0,0,.3),0 8px 20px rgba(0,0,0,.4),0 20px 60px rgba(0,0,0,.3);
      border:1px solid #c8b898;padding-bottom:40px}

    /* MASTHEAD */
    .masthead{border-bottom:4px double var(--rule);padding:18px 24px 12px;text-align:center;background:linear-gradient(180deg,#f0e6cc,var(--paper))}
    .masthead::before{content:'';display:block;border-top:1px solid var(--rule);border-bottom:1px solid var(--rule);height:6px;margin-bottom:12px}
    .newspaper-name{font-family:var(--f-head);font-size:clamp(2.6rem,7vw,5rem);font-weight:900;line-height:1;color:var(--ink)}
    .mast-icon{font-size:1.5rem;margin:0 10px;opacity:.7}
    .tagline{font-family:var(--f-disp);font-style:italic;font-size:.78rem;color:var(--ink-mid);letter-spacing:.12em;margin-top:4px;text-transform:uppercase}
    .meta-bar{display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--rule);border-bottom:1px solid var(--rule);margin-top:10px;padding:4px 0;font-size:.7rem;color:var(--ink-mid);letter-spacing:.08em;text-transform:uppercase}

    /* LAYOUT */
    .columns{display:grid;padding:14px 24px}
    .col-3{grid-template-columns:repeat(3,1fr)}
    .col-2{grid-template-columns:repeat(2,1fr)}
    .col-1-2{grid-template-columns:2fr 1fr}
    .col-2-1{grid-template-columns:1fr 2fr}

    /* SECTION LABELS */
    .section-label{display:flex;align-items:center;gap:10px;margin:18px 24px 0;font-family:var(--f-head);font-size:.72rem;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:var(--paper)}
    .section-label span{background:var(--ink);padding:3px 10px}
    .section-label::after{content:'';flex:1;height:1px;background:var(--ink);opacity:.3}
    .h-rule{border:none;border-top:1px solid var(--rule);margin:0 24px;opacity:.35}
    .h-rule-bold{border:none;border-top:3px double var(--rule);margin:6px 24px;opacity:.55}

    /* ARTICLE CARDS */
    .article{padding:14px;cursor:pointer;transition:background .18s;position:relative;border-right:1px solid rgba(42,31,14,.18)}
    .article:last-child{border-right:none}
    .article:hover{background:rgba(245,239,224,.6)}
    .article-featured{padding:18px 24px;border-bottom:3px double var(--rule);cursor:pointer;transition:background .18s}
    .article-featured:hover{background:rgba(245,239,224,.5)}
    .article-tag{font-size:.58rem;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:var(--red);margin-bottom:5px}
    .article-headline{font-family:var(--f-head);font-weight:700;line-height:1.18;color:var(--ink);margin-bottom:6px}
    .article-headline.xl{font-size:clamp(1.7rem,3vw,2.4rem);line-height:1.08}
    .article-headline.lg{font-size:1.3rem}
    .article-headline.md{font-size:1.05rem}
    .article-headline.sm{font-size:.9rem}
    .article-deck{font-family:var(--f-disp);font-style:italic;font-size:.85rem;color:var(--ink-mid);margin-bottom:8px;line-height:1.45}
    .article-byline{font-size:.6rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-faint);margin-bottom:7px;border-bottom:1px solid rgba(42,31,14,.18);padding-bottom:5px}
    .article-body{font-size:.76rem;line-height:1.72;color:var(--ink-mid)}
    .article-img{width:100%;background:var(--paper-dark);border:1px solid rgba(42,31,14,.15);margin-bottom:7px;display:flex;align-items:center;justify-content:center;overflow:hidden}
    .article-img img{width:100%;height:100%;object-fit:cover;filter:sepia(25%) contrast(1.05);display:block;transition:filter .3s}
    .article:hover .article-img img{filter:sepia(10%) contrast(1.08)}
    .img-ph{font-size:.6rem;letter-spacing:.15em;text-transform:uppercase;color:var(--ink-faint);font-family:var(--f-body);padding:20px}
    .article-caption{font-size:.58rem;font-style:italic;color:var(--ink-faint);margin-bottom:7px}

    /* AD */
    .ad-block{border:2px solid var(--rule);padding:14px;margin:14px 24px;text-align:center;background:linear-gradient(135deg,#ede0c0,#f5efe0)}
    .ad-block::before{content:'— ADVERTISEMENT —';display:block;font-size:.52rem;letter-spacing:.22em;color:var(--ink-faint);margin-bottom:6px}
    .ad-label{font-family:var(--f-head);font-size:1rem;font-weight:900;color:var(--ink)}
    .ad-text{font-size:.68rem;color:var(--ink-mid);margin-top:3px;font-style:italic}

    /* READ-MORE HINT */
    .read-hint{display:block;font-size:.58rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--red);margin-top:6px}

    /* TICKER */
    .ticker-wrap{background:var(--ink);overflow:hidden;white-space:nowrap;padding:5px 0;border-top:1px solid #4a3a28;border-bottom:1px solid #4a3a28}
    .ticker-label{display:inline-block;background:var(--red);color:var(--paper);font-size:.62rem;font-weight:700;letter-spacing:.12em;padding:2px 10px;margin-right:14px;text-transform:uppercase}
    .ticker-track{display:inline-block;animation:tickerScroll 40s linear infinite;font-size:.65rem;color:rgba(245,239,224,.75);letter-spacing:.04em;font-family:var(--f-body)}
    .ticker-track{display:inline-block;animation:tickerScroll 55s linear infinite;font-size:.65rem;color:rgba(245,239,224,.75);letter-spacing:.04em;font-family:var(--f-body);will-change:transform}
@keyframes tickerScroll{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}

    /* FOOTER */
    .newspaper-footer{border-top:3px double var(--rule);margin:24px 24px 0;padding-top:10px;display:flex;justify-content:space-between;font-size:.62rem;color:var(--ink-faint);letter-spacing:.04em;flex-wrap:wrap;gap:6px}

    /* ARCHIVE BAR */
    .archive-bar{max-width:980px;margin:28px auto 0;background:rgba(20,14,6,.8);backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.08);border-radius:3px;padding:20px 28px 22px;box-shadow:0 8px 32px rgba(0,0,0,.5)}
    .archive-bar-title{font-family:var(--f-head);font-size:.68rem;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:rgba(245,239,224,.45);margin-bottom:14px;display:flex;align-items:center;gap:10px}
    .archive-bar-title::before,.archive-bar-title::after{content:'';flex:1;height:1px;background:rgba(245,239,224,.15)}
    .archive-days{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}
    .day-btn{background:rgba(245,239,224,.07);border:1px solid rgba(245,239,224,.16);color:rgba(245,239,224,.7);font-family:var(--f-body);font-size:.68rem;cursor:pointer;padding:8px 16px;border-radius:2px;transition:all .18s;display:flex;flex-direction:column;align-items:center;gap:2px;min-width:82px}
    .day-btn .day-name{font-weight:700;font-size:.72rem;text-transform:uppercase;letter-spacing:.1em}
    .day-btn .day-date{font-size:.58rem;color:rgba(245,239,224,.4)}
    .day-btn:hover{background:rgba(245,239,224,.16);border-color:rgba(245,239,224,.4);color:var(--paper);transform:translateY(-2px)}
    .day-btn.today{background:var(--red);border-color:var(--red);color:var(--paper)}

    /* BACK BAR */
    .back-bar{max-width:980px;margin:0 auto 12px;display:flex;align-items:center;gap:14px}
    .back-btn{background:rgba(245,239,224,.12);border:1px solid rgba(245,239,224,.22);color:rgba(245,239,224,.82);font-family:var(--f-body);font-size:.7rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;padding:7px 16px;border-radius:2px;transition:all .15s}
    .back-btn:hover{background:rgba(245,239,224,.22);color:var(--paper)}
    .back-bar-label{font-family:var(--f-disp);font-style:italic;font-size:.8rem;color:rgba(245,239,224,.4)}

    /* FULL ARTICLE VIEW */
    .article-page{max-width:800px;margin:0 auto;background-color:var(--paper);background-image:linear-gradient(180deg,#f7f0e0,#ede0c0);box-shadow:0 4px 30px rgba(0,0,0,.5),0 0 0 1px rgba(200,180,140,.45);border-radius:2px;overflow:hidden}
    .ap-accent{height:5px;background:linear-gradient(90deg,var(--red),#c0392b,var(--red))}
    .ap-inner{padding:44px 52px 60px}
    .ap-nav{display:flex;align-items:center;justify-content:space-between;margin-bottom:26px;border-bottom:1px solid rgba(42,31,14,.16);padding-bottom:12px}
    .ap-back{font-size:.62rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--red);cursor:pointer;background:none;border:none;font-family:var(--f-body)}
    .ap-back:hover{opacity:.65}
    .ap-paper{font-family:var(--f-head);font-size:.85rem;font-weight:900;color:var(--ink-faint)}
    .ap-tag{font-size:.6rem;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:var(--red);margin-bottom:10px}
    .ap-headline{font-family:var(--f-head);font-size:clamp(1.9rem,4vw,3rem);font-weight:900;line-height:1.08;color:var(--ink);margin-bottom:12px}
    .ap-deck{font-family:var(--f-disp);font-style:italic;font-size:1.05rem;color:var(--ink-mid);border-top:1px solid var(--rule);border-bottom:1px solid var(--rule);padding:9px 0;margin-bottom:14px}
    .ap-byline{font-size:.63rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-faint);margin-bottom:22px}
    .ap-image{width:100%;max-height:380px;object-fit:cover;filter:sepia(22%) contrast(1.05);margin-bottom:7px;border:1px solid rgba(42,31,14,.18);display:block}
    .ap-img-wrap{margin-bottom:22px}
    .ap-img-ph{width:100%;aspect-ratio:16/9;background:var(--paper-dark);border:1px solid rgba(42,31,14,.15);display:flex;align-items:center;justify-content:center}
    .ap-caption{font-size:.62rem;font-style:italic;color:var(--ink-faint);padding-top:4px;border-bottom:1px solid rgba(42,31,14,.1);padding-bottom:8px}
    .ap-body{font-size:.88rem;line-height:1.92;color:var(--ink-mid);column-count:2;column-gap:32px;column-rule:1px solid rgba(42,31,14,.15)}
    .ap-body p{margin-bottom:14px}
    .ap-body p:first-child::first-letter{font-family:var(--f-head);font-size:3.8rem;font-weight:900;float:left;line-height:.82;margin:6px 6px 0 0;color:var(--ink)}
    .ap-notice{font-size:.72rem;font-style:italic;color:var(--ink-faint);margin-top:16px;padding-top:12px;border-top:1px solid rgba(42,31,14,.15)}
    .ap-source-link{display:inline-block;margin-top:18px;font-size:.7rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--red);text-decoration:none;border:1px solid var(--red);padding:6px 14px}
    .ap-source-link:hover{background:var(--red);color:var(--paper)}
    .ap-bottom-nav{max-width:800px;margin:14px auto 0;display:flex;gap:12px}

    @media(max-width:660px){
      .col-3,.col-2,.col-1-2,.col-2-1{grid-template-columns:1fr}
      .article{border-right:none;border-bottom:1px solid rgba(42,31,14,.18)}
      .ap-inner{padding:22px 16px 36px}
      .ap-body{column-count:1}
      .day-btn{min-width:64px;padding:6px 8px}
      .newspaper-footer{flex-direction:column;gap:4px}
    }
  </style>
</head>
<body>

<!-- ══════ VIEW: FRONT PAGE ══════ -->
<div class="view active" id="view-front">
<div class="newspaper">

  <header class="masthead">
    <div class="newspaper-name"><span class="mast-icon">⚜</span> The Scaler Chronicles <span class="mast-icon">⚜</span></div>
    <div class="tagline">"Bringing A Modern Touch To Traditional Newspaper — Est. 2026"</div>
    <div class="meta-bar">
      <span>${todayFmt}</span>
      <span style="font-style:italic">Vol. I · Daily Edition</span>
      <span>$0.00</span>
    </div>
  </header>

  <!-- TICKER -->
  <div class="ticker-wrap">
    <span class="ticker-label">Breaking</span>
    <span class="ticker-track">
      ${[A.lead, A.biz1, A.tech1, A.world1, A.sport1, A.health1, A.ent1, A.env1,
         A.lead, A.biz1, A.tech1, A.world1, A.sport1, A.health1, A.ent1, A.env1]
        .map(a => `◆ ${esc(a.headline)}`).join('&nbsp;&nbsp;&nbsp;&nbsp;')}
    </span>
  </div>

  <!-- LEAD STORY -->
  <article class="article-featured" onclick="openArticle('lead')">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start">
      <div>
        <div class="article-tag">${esc(A.lead.tag)}</div>
        <h1 class="article-headline xl">${esc(A.lead.headline)}</h1>
        <p class="article-deck">${esc(A.lead.deck)}</p>
        <div class="article-byline">${esc(A.lead.byline)}</div>
        <p class="article-body">${esc(A.lead.teaser)}</p>
        <span class="read-hint">Continue reading →</span>
      </div>
      <div>
        ${A.lead.imgSrc
          ? `<img src="${esc(A.lead.imgSrc)}" alt="${esc(A.lead.headline)}" style="width:100%;aspect-ratio:4/3;object-fit:cover;filter:sepia(25%) contrast(1.05);border:1px solid rgba(42,31,14,.2)" loading="eager" onerror="this.style.display='none'">`
          : `<div style="width:100%;aspect-ratio:4/3;background:var(--paper-dark);border:1px solid rgba(42,31,14,.15);display:flex;align-items:center;justify-content:center"><span class="img-ph">[ Breaking News ]</span></div>`
        }
        <div class="article-caption">Source: ${esc(A.lead.source)}</div>
      </div>
    </div>
    <!-- Secondary leads -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0;border-top:1px solid rgba(42,31,14,.2);margin-top:14px;padding-top:10px">
      <article class="article" style="border-right:1px solid rgba(42,31,14,.2)" onclick="openArticle('lead2');event.stopPropagation()">
        <div class="article-tag">${esc(A.lead2.tag)}</div>
        <h2 class="article-headline sm">${esc(A.lead2.headline)}</h2>
        <p class="article-body">${esc(A.lead2.teaser)}</p>
      </article>
      <article class="article" onclick="openArticle('lead3');event.stopPropagation()">
        <div class="article-tag">${esc(A.lead3.tag)}</div>
        <h2 class="article-headline sm">${esc(A.lead3.headline)}</h2>
        <p class="article-body">${esc(A.lead3.teaser)}</p>
      </article>
    </div>
  </article>

  <!-- BUSINESS -->
  ${sectionLabel('Business &amp; Finance')}
  <div class="columns col-3">
    ${cardHTML(A.biz1,'biz1','lg')}
    ${cardHTML(A.biz2,'biz2','md')}
    ${cardHTML(A.biz3,'biz3','md')}
  </div>

  <hr class="h-rule-bold">

  <!-- TECHNOLOGY -->
  ${sectionLabel('Technology')}
  <div class="columns col-3">
    ${cardHTML(A.tech1,'tech1','lg')}
    ${cardHTML(A.tech2,'tech2','md')}
    ${cardHTML(A.tech3,'tech3','md')}
  </div>

  <hr class="h-rule">
  <div class="ad-block">
    <div class="ad-label">✦ Your Advertisement Here ✦</div>
    <div class="ad-text">Contact us to place your message in The Scaler Chronicles</div>
  </div>
  <hr class="h-rule">

  <!-- SCIENCE -->
  ${sectionLabel('Science')}
  <div class="columns col-3">
    ${cardHTML(A.sci1,'sci1','lg')}
    ${cardHTML(A.sci2,'sci2','md')}
    ${cardHTML(A.sci3,'sci3','md')}
  </div>

  <hr class="h-rule-bold">

  <!-- WORLD & POLITICS -->
  ${sectionLabel('World &amp; Politics')}
  <div class="columns col-3">
    ${cardHTML(A.world1,'world1','lg')}
    ${cardHTML(A.world2,'world2','md')}
    ${cardHTML(A.world3,'world3','md')}
  </div>
  <div class="columns col-3" style="padding-top:0">
    ${cardHTML(A.pol1,'pol1','md')}
    ${cardHTML(A.pol2,'pol2','md')}
    ${cardHTML(A.pol3,'pol3','md')}
  </div>

  <hr class="h-rule">
  <div class="ad-block">
    <div class="ad-label">✦ Advertise With Us ✦</div>
    <div class="ad-text">Reach thousands of engaged readers daily</div>
  </div>
  <hr class="h-rule">

  <!-- SPORT -->
  ${sectionLabel('Sport')}
  <div class="columns col-3">
    ${cardHTML(A.sport1,'sport1','lg')}
    ${cardHTML(A.sport2,'sport2','md')}
    ${cardHTML(A.sport3,'sport3','md')}
  </div>

  <hr class="h-rule-bold">

  <!-- HEALTH -->
  ${sectionLabel('Health &amp; Medicine')}
  <div class="columns col-3">
    ${cardHTML(A.health1,'health1','lg')}
    ${cardHTML(A.health2,'health2','md')}
    ${cardHTML(A.health3,'health3','md')}
  </div>

  <hr class="h-rule">

  <!-- ENTERTAINMENT -->
  ${sectionLabel('Entertainment')}
  <div class="columns col-3">
    ${cardHTML(A.ent1,'ent1','lg')}
    ${cardHTML(A.ent2,'ent2','md')}
    ${cardHTML(A.ent3,'ent3','md')}
  </div>

  <hr class="h-rule-bold">

  <!-- ENVIRONMENT -->
  ${sectionLabel('Environment &amp; Climate')}
  <div class="columns col-3">
    ${cardHTML(A.env1,'env1','lg')}
    ${cardHTML(A.env2,'env2','md')}
    ${cardHTML(A.env3,'env3','md')}
  </div>

  <footer class="newspaper-footer">
    <span>© 2026 The Scaler Chronicles.</span>
    <span>${todayFmt} · Daily edition</span>
    <span>Made By Shenz Nazeer</span>
  </footer>
</div>
</div><!-- /view-front -->

<!-- ══════ VIEW: ARCHIVE ══════ -->
<div class="view" id="view-archive">
  <div class="back-bar">
    <button class="back-btn" onclick="showView('front')">← Today's Edition</button>
    <span class="back-bar-label" id="archive-label">Archive</span>
  </div>
  <div id="archive-content"></div>
</div>

<!-- ══════ VIEW: FULL ARTICLE ══════ -->
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
      <p class="ap-notice">NewsAPI previews are limited excerpts. Click below to read the full story at the original source.</p>
      <div id="ap-source-wrap"></div>
    </div>
  </div>
  <div class="ap-bottom-nav">
    <button class="back-btn" onclick="goBack()">← Back to Paper</button>
  </div>
</div>

<!-- ══════ ARCHIVE BAR ══════ -->
<div class="archive-bar">
  <div class="archive-bar-title">Past Editions</div>
  <div class="archive-days">${archiveBtns}</div>
</div>

<script>
const ARTICLES = {
${articlesJS}
};
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

function openArticle(id) {
  const a = ARTICLES[id];
  if (!a || !a.headline) return;
  document.getElementById('ap-tag').textContent      = a.tag || '';
  document.getElementById('ap-headline').textContent = a.headline || '';
  document.getElementById('ap-deck').textContent     = a.deck || '';
  document.getElementById('ap-byline').textContent   = a.byline || '';

  // Image
  let imgHTML = '';
  if (a.imgSrc) {
    imgHTML = \`<img class="ap-image" src="\${a.imgSrc}" alt="\${a.headline||''}" loading="lazy" onerror="this.style.display='none'">\`;
  } else {
    imgHTML = '<div class="ap-img-ph"><span class="img-ph">[ No image available ]</span></div>';
  }
  if (a.source) imgHTML += \`<div class="ap-caption">Source: \${a.source}</div>\`;
  document.getElementById('ap-img-wrap').innerHTML = imgHTML;

  // Body — array of paragraphs or string
  const paras = Array.isArray(a.body) ? a.body : [a.body || a.teaser || ''];
  document.getElementById('ap-body').innerHTML =
    paras.filter(Boolean).map(p => \`<p>\${p}</p>\`).join('') ||
    '<p>Full article text not available — please read the full story at the source.</p>';

  // Source link
  document.getElementById('ap-source-wrap').innerHTML = a.url
    ? \`<a class="ap-source-link" href="\${a.url}" target="_blank" rel="noopener">Read Full Story at \${a.source || 'Source'} →</a>\`
    : '';

  const cur = document.querySelector('.view.active');
  previousView = cur ? cur.id.replace('view-','') : 'front';
  showView('article');
}

function loadEdition(btn) {
  const key = btn.dataset.key;
  if (key === '${todayKey}') { showView('front'); return; }
  const ed = ARCHIVE_DATA[key];
  if (!ed) { alert('Edition not yet available: ' + key); return; }
  const A2 = ed.articles || {};

  // Register all archive articles so openArticle works
  Object.entries(A2).forEach(([id, a]) => { ARTICLES[key + '-' + id] = a; });

  function ac(id) { return A2[id] || {}; }
  function aCard(id, size) {
    const a = ac(id); if (!a.headline) return '';
    const img = a.imgSrc
      ? \`<div class="article-img"><img src="\${a.imgSrc}" alt="" loading="lazy" onerror="this.parentElement.style.display='none'"></div>\`
      : '';
    return \`<article class="article" onclick="openArticle('\${key}-\${id}')">
      <div class="article-tag">\${a.tag||''}</div>\${img}
      <h2 class="article-headline \${size||'md'}">\${a.headline||''}</h2>
      <div class="article-byline">\${a.byline||''}</div>
      <p class="article-body">\${a.teaser||''}</p>
    </article>\`;
  }

  document.getElementById('archive-content').innerHTML = \`
  <div class="newspaper">
    <header class="masthead">
      <div class="newspaper-name"><span class="mast-icon">⚜</span> The Scaler Chronicles <span class="mast-icon">⚜</span></div>
      <div class="tagline">"Bringing A Modern Touch To Traditional Newspaper — Est. 2026"</div>
      <div class="meta-bar"><span>\${ed.date}</span><span style="font-style:italic">Archive Edition</span><span>$0.00</span></div>
    </header>
    <article class="article-featured" onclick="openArticle('\${key}-lead')">
      <div class="article-tag">\${ac('lead').tag||''}</div>
      \${ac('lead').imgSrc ? \`<img src="\${ac('lead').imgSrc}" alt="" style="width:100%;max-height:300px;object-fit:cover;filter:sepia(25%);margin-bottom:10px" loading="lazy" onerror="this.style.display='none'">\` : ''}
      <h1 class="article-headline xl">\${ac('lead').headline||''}</h1>
      <p class="article-deck">\${ac('lead').deck||''}</p>
      <div class="article-byline">\${ac('lead').byline||''}</div>
      <p class="article-body">\${ac('lead').teaser||''}</p>
    </article>
    <div class="section-label"><span>Business</span></div>
    <div class="columns col-3">\${aCard('biz1','lg')}\${aCard('biz2','md')}\${aCard('biz3','md')}</div>
    <hr class="h-rule-bold">
    <div class="section-label"><span>Technology</span></div>
    <div class="columns col-3">\${aCard('tech1','lg')}\${aCard('tech2','md')}\${aCard('tech3','md')}</div>
    <hr class="h-rule-bold">
    <div class="section-label"><span>World &amp; Politics</span></div>
    <div class="columns col-3">\${aCard('world1','lg')}\${aCard('world2','md')}\${aCard('world3','md')}</div>
    <hr class="h-rule-bold">
    <div class="section-label"><span>Sport</span></div>
    <div class="columns col-3">\${aCard('sport1','lg')}\${aCard('sport2','md')}\${aCard('sport3','md')}</div>
    <footer class="newspaper-footer">
      <span>© 2026 The Scaler Chronicles.</span>
      <span>\${ed.date} · Archive Edition</span>
      <span>The Scaler Chronicles</span>
    </footer>
  </div>\`;

  document.getElementById('archive-label').textContent = ed.date + ' — Archive';
  previousView = 'archive';
  showView('archive');
}

function goBack() { showView(previousView); }
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('view-article').classList.contains('active')) goBack();
});
</script>
</body>
</html>`;

  await fs.writeFile(path.join(PUBLIC, 'index.html'), html, 'utf8');
  console.log(`✅ Written: public/index.html`);

  // Tidy archive — keep last 30 days
  const files = (await fs.readdir(ARCHIVE)).filter(f => f.endsWith('.json')).sort();
  if (files.length > 30) {
    const old = files.slice(0, files.length - 30);
    await Promise.all(old.map(f => fs.unlink(path.join(ARCHIVE, f))));
    console.log(`🗑  Removed ${old.length} old archive file(s)`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
