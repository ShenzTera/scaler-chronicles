# The Scaler Chronicles — Automated Daily Edition

A self-updating broadsheet newspaper that scrapes top headlines every morning, fetches matching images, and deploys a fresh `index.html` to Cloudflare Pages automatically.

---

## How it works

```
06:00 UTC daily
    │
    ▼
GitHub Actions runs scripts/generate.js
    │
    ├── NewsAPI  → fetches ~8 top headlines across categories
    ├── Unsplash → fetches one matching image per story
    │
    ├── Writes public/index.html  (today's front page)
    ├── Writes public/archive/<date>.json  (for the archive bar)
    │
    ├── git commit + push  (saves archive for tomorrow)
    │
    └── wrangler pages deploy public/
              │
              ▼
        Cloudflare Pages  →  yoursite.pages.dev
```

---

## One-time setup

### 1. Get API keys (both free tiers are sufficient)

| Service | Free tier | Sign up |
|---|---|---|
| **NewsAPI** | 100 requests/day | https://newsapi.org/register |
| **Unsplash** | 50 requests/hour | https://unsplash.com/oauth/applications |

> **Unsplash note:** after registering your app you'll get a "Access Key" — that's your `UNSPLASH_KEY`. Images won't appear until your Unsplash app is submitted for production (takes a day), but the script works fine in demo mode; it'll just fall back to the article's own thumbnail.

### 2. Create a Cloudflare Pages project

1. Go to https://dash.cloudflare.com → **Pages** → **Create a project**
2. Choose **"Direct Upload"** (not Git integration — GitHub Actions handles deploys)
3. Name your project `scaler-chronicles` (or whatever you like — update `wrangler.toml` to match)
4. Upload any placeholder file to create the project — the Action will overwrite it on first run

**Get your Account ID:** Cloudflare dashboard → right-hand sidebar under "Account ID"

**Create an API Token:**
1. Cloudflare dashboard → My Profile → API Tokens → Create Token
2. Use the **"Edit Cloudflare Workers"** template
3. Scope it to your account and the Pages project
4. Copy the token

### 3. Add secrets to your GitHub repo

Go to your repo → **Settings → Secrets and variables → Actions → New repository secret**

| Secret name | Value |
|---|---|
| `NEWS_API_KEY` | Your NewsAPI key |
| `UNSPLASH_KEY` | Your Unsplash access key |
| `CLOUDFLARE_API_TOKEN` | The API token you just created |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |

### 4. Push this repo to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/scaler-chronicles.git
git push -u origin main
```

The push will trigger the workflow immediately (due to `on: push: branches: [main]`). Check the **Actions** tab to watch it run.

### 5. Verify the deploy

After the Action completes (usually ~30 seconds), visit:
`https://scaler-chronicles.pages.dev`

---

## Local development

```bash
npm install

# generate a fresh index.html using your local env vars
NEWS_API_KEY=your_key UNSPLASH_KEY=your_key npm run generate

# serve it locally
npx serve public
# → open http://localhost:3000
```

---

## Customisation

### Change publish time
Edit `.github/workflows/daily.yml`, find the `cron` line:
```yaml
- cron: '0 6 * * *'   # 06:00 UTC
```
Use https://crontab.guru to find your preferred local time in UTC.

### Change what sections are fetched
Edit `scripts/generate.js` — the `Promise.all` near the top calls `fetchArticle` and `fetchEverything`. Change the `category` or `query` strings to whatever topics you want.

Available NewsAPI categories: `business`, `entertainment`, `general`, `health`, `science`, `sports`, `technology`

### Change the newspaper name / tagline
Find the masthead block in `generate.js` — search for `newspaper-name` — and update the text.

### Add your own opinion pieces
The Opinion section is left as a static placeholder (the API doesn't provide opinions). Edit the HTML template in `generate.js` around the `Opinion &amp; Analysis` section label to hardcode your own editorial content.

### Add a custom domain
In Cloudflare Pages → your project → Custom domains → Add domain.

---

## File structure

```
scaler-chronicles/
├── .github/
│   └── workflows/
│       └── daily.yml          ← GitHub Actions: runs daily, deploys to CF Pages
├── scripts/
│   └── generate.js            ← Node script: fetches news → writes public/index.html
├── public/
│   ├── index.html             ← Generated each day (don't edit manually)
│   └── archive/
│       ├── jun03.json         ← Auto-saved each day for the archive bar
│       ├── jun02.json
│       └── …
├── package.json
├── wrangler.toml              ← Cloudflare Pages config
└── README.md
```

---

## Troubleshooting

**"NEWS_API_KEY env var not set"** — Check that the secret is named exactly `NEWS_API_KEY` in GitHub.

**Images not showing** — Unsplash apps start in "demo mode" (10 requests/hour). Submit your app for production at https://unsplash.com/oauth/applications. In the meantime, the script falls back to the article's own thumbnail image from NewsAPI.

**"Rate limit exceeded"** — NewsAPI free tier allows 100 requests/day. The script makes 8 requests per run, so you have ~12 daily runs available.

**Deploy fails with 401** — Regenerate your Cloudflare API token and update the `CLOUDFLARE_API_TOKEN` secret.

**Archive bar shows no past editions** — The archive is built up over time. After the first few daily runs, past days will appear automatically.
