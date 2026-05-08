# Moment Marketing — Trend Intelligence Dashboard

A real-time trend aggregation platform built for marketing teams. It scrapes trending content from **YouTube, Twitter/X, Instagram, Reddit, Facebook, and Google Trends** and surfaces the most relevant moments for moment-marketing campaigns — especially for Indian advertising and brand strategy.

---

## What It Does

- Fetches live trending content from 6 platforms every few hours
- Filters for marketing-relevant trends (moment marketing, creative advertising, brand campaigns, IPL, Bollywood, etc.)
- Classifies each trend by category (Sports, Entertainment, Fashion, Tech, etc.) and computes a relevance score
- Presents everything as browsable "Moment Cards" — each with an image, description, trending score, and calendar integration
- Twitter trend cards show styled gradient placeholders when no relevant news image is available — intentional design, not a broken image
- All images from external CDNs (Instagram, Reddit, YouTube) are proxied server-side to avoid hotlink blocks

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router + Turbopack) |
| Language | TypeScript |
| Styling | Tailwind CSS 4 |
| API layer | tRPC v11 + React Query v5 |
| Runtime | Node.js 20+ |
| External data | YouTube Data API v3, Apify actors, ScrapeGraphAI, public RSS/HTML |

---

## Environment Variables

Copy `.env.example` to `.env.local` and fill in the values:

```bash
cp .env.example .env.local
```

| Variable | Required | Description |
|---|---|---|
| `YOUTUBE_API_KEY` | Yes | YouTube Data API v3 key (primary) |
| `YOUTUBE_API_KEY_2` | Recommended | Second key — auto-rotates when primary hits daily quota |
| `YOUTUBE_API_KEY_3` | Recommended | Third key — adds quota headroom for keyword searches |
| `APIFY_TOKEN` | Yes (for Instagram/Google) | Apify platform token. Without it, Instagram falls back to Google Trends and mobile API |
| `SGAI_API_KEY` | Yes (for Facebook) | ScrapeGraphAI API key for Facebook hashtag scraping. Get it at [scrapegraphai.com/dashboard](https://scrapegraphai.com/dashboard) |

### Getting API Keys

**YouTube Data API v3**
1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a project → Enable `YouTube Data API v3`
3. Credentials → Create API Key
4. Each key gets **10,000 quota units/day** (resets midnight Pacific Time)
   - `videos.list` (trending) = 1 unit per call
   - `search.list` (keyword search) = 100 units per call

**Apify Token**
1. Sign up at [apify.com](https://apify.com)
2. Console → Settings → Integrations → API Token
3. Budget: ~$0.50–$1.50 per full scrape cycle across all platforms
4. Daily cap is set to **$6.00** in `src/server/db/apify-spend.ts`
5. Actors used: `apify/instagram-scraper`, `emastra/google-trends-scraper`

**ScrapeGraphAI API Key**
1. Sign up at [scrapegraphai.com](https://scrapegraphai.com)
2. Dashboard → API Keys → Copy key
3. Used exclusively for Facebook hashtag page scraping
4. Free plan includes 500 credits to start

---

## Local Development

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.example .env.local
# Edit .env.local with your keys

# 3. Start dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

The app starts with **mock data** pre-loaded. Click any platform button (YouTube, Twitter, Instagram, etc.) to trigger a live scrape for that platform.

---

## How the Scrapers Work

Each platform has a dedicated scraper in `src/server/scrapers/`:

| Platform | File | Primary Method | Fallback |
|---|---|---|---|
| YouTube | `youtube.ts` | YouTube Data API v3 (IN + US trending + keyword search) | Keyless web-client API → Apify → disk cache |
| Twitter/X | `twitter.ts` | **trends24.in** — real-time "Trending in India" list | getdaytrends.com |
| Instagram | `instagram.ts` | Apify `apify/instagram-scraper` (hashtag explore) | Instagram mobile API → Google Trends RSS → seed hashtags |
| Reddit | `reddit.ts` | Reddit public JSON API (no auth) | — |
| Facebook | `facebook.ts` | **ScrapeGraphAI** `extract()` on hashtag pages + brand pages | Marketing RSS (afaqs!, Adweek, etc.) → seed hashtags |
| Google Trends | `google.ts` | Apify `emastra/google-trends-scraper` (geo=IN) | **8 category RSS feeds** in parallel (Top, Entertainment, Sports, Business, Tech, Health — India + Global) |

### Twitter/X — India Trending Topics

Twitter now uses **trends24.in** as the primary source — this gives the exact "Trending in India" list you see in the X sidebar (`#TVKFails`, `उत्तर प्रदेश सरकार`, etc.). Apify tweet search is no longer used for Twitter as it returned random tweets rather than actual trending topics.

For images: only real Bing News thumbnails are used. If no news photo exists for a trend, the card shows a **styled dark gradient** with the trend name — intentional design that looks clean rather than showing an irrelevant stock photo.

### Facebook — ScrapeGraphAI

Facebook scraping uses the `scrapegraph-js` SDK's `extract()` function with a Zod-validated JSON schema. It scrapes:
1. All 8 marketing hashtag pages (`/hashtag/momentmarketing`, `/hashtag/marketing`, etc.)
2. 6 curated public brand pages (Amul India, Zomato, Adweek, afaqs!, Fevicol, Creative Gaga) if hashtag pages return fewer than 5 posts

Falls back to RSS from marketing publications (afaqs!, Adweek, Marketing Week, Campaign India) if ScrapeGraphAI returns 0.

### Instagram — node:https Fix

The Instagram Apify calls use **`node:https.request()`** instead of the global `fetch`. This is intentional: Node.js's built-in `fetch` (powered by undici) has a hard **10-second TCP connect timeout** (`UND_ERR_CONNECT_TIMEOUT`) that fires before Apify's server can respond on slower network conditions. `node:https` uses native libuv sockets with a configurable 60-second timeout, making the connection reliable.

### Google Trends — Multi-Category RSS

Google Trends RSS supports category filtering. The scraper now fetches **8 feeds in parallel** instead of 1:

| Feed | Category Code |
|---|---|
| India Top | (none) |
| India Entertainment | `e` |
| India Sports | `s` |
| India Business | `b` |
| India Sci/Tech | `t` |
| India Health | `h` |
| Global Top | (none) |
| Global Entertainment | `e` |

Each feed returns ~15–20 items. After deduplication, this yields **80–120 unique trends** vs ~20 before.

---

### Scraping Hashtags

All scrapers target these 8 marketing hashtags across all platforms:

```
momentmarketing  moment  marketingmentor  kitkat
advertising  outdooradvertising  marketing  creativeads
```

---

### Startup Behaviour

- Twitter, Reddit, Instagram, Facebook, and Google Trends scrape automatically on server start (with a **3-hour cooldown** to prevent re-scraping on hot reload)
- YouTube is **not** scraped on startup to preserve API quota — click the YouTube button to trigger it
- Each platform can also be manually refreshed via its button in the UI (30-minute per-platform cooldown)

### Caching & Budget

- YouTube results are cached to `.youtube-cache.json` for 6 hours
- All other platform results are held in-memory (cleared on server restart)
- Apify spend is tracked in `.apify-spend.json` with a **$6.00/day** cap
- Spend uses a pre-reservation pattern — budget is debited before each run, then reconciled against actual item count after completion

---

## Deployment

### Prerequisites

1. Node.js 20 or higher
2. All environment variables set in the platform's secrets/env panel
3. Production build: `npm run build`

---

### Deploy to Base44

1. Connect your GitHub repo (`dinesh-choudhary123/moment-marketing`) to Base44
2. Add environment variables:
   ```
   YOUTUBE_API_KEY=...
   YOUTUBE_API_KEY_2=...
   YOUTUBE_API_KEY_3=...
   APIFY_TOKEN=...
   SGAI_API_KEY=...
   ```
3. Build command: `npm install && npm run build`
4. Start command: `npm run start`
5. Node version: `20`

> **Note:** The app writes `.youtube-cache.json` and `.apify-spend.json` at runtime. These reset on container restart — scraping re-runs automatically.

---

### Deploy to Threezinc (Docker)

**Step 1 — Create `Dockerfile` in project root:**

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/next.config.ts ./
EXPOSE 3000
CMD ["npm", "run", "start"]
```

**Step 2 — Build and push:**

```bash
docker build -t moment-marketing:latest .
docker tag moment-marketing:latest registry.threezinc.com/<your-org>/moment-marketing:latest
docker push registry.threezinc.com/<your-org>/moment-marketing:latest
```

**Step 3 — Set environment variables in Threezinc secrets:**

```
YOUTUBE_API_KEY=...
YOUTUBE_API_KEY_2=...
YOUTUBE_API_KEY_3=...
APIFY_TOKEN=...
SGAI_API_KEY=...
```

**Step 4 — Deploy:**

```bash
threezinc deploy \
  --image registry.threezinc.com/<your-org>/moment-marketing:latest \
  --port 3000
```

---

## Project Structure

```
/
├── app/
│   ├── api/
│   │   ├── image-proxy/        # Server-side image proxy (bypasses CDN hotlink blocks)
│   │   └── trpc/               # tRPC HTTP handler
│   └── moments/                # Main dashboard page
├── src/
│   └── server/
│       ├── routers/            # tRPC routers (moments, scraper, calendar)
│       ├── scrapers/           # Per-platform scraper modules
│       │   ├── youtube.ts      # YouTube Data API v3 + keyless fallback
│       │   ├── twitter.ts      # trends24.in India trending topics
│       │   ├── instagram.ts    # Apify hashtag scraper (node:https)
│       │   ├── reddit.ts       # Reddit public JSON API
│       │   ├── facebook.ts     # ScrapeGraphAI extract() + RSS fallback
│       │   ├── google.ts       # Google Trends RSS (8 category feeds)
│       │   ├── classifier.ts   # Category + score classifier + brand safety filter
│       │   └── image-utils.ts  # Wikipedia + Bing News image fetcher
│       └── db/
│           ├── store.ts        # In-memory moments store
│           └── apify-spend.ts  # Apify daily budget tracker ($6/day cap)
├── src/components/
│   └── moments/
│       └── MomentCard.tsx      # Trend card with styled gradient placeholder
├── .env.example                # Template for required environment variables
└── next.config.ts
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| YouTube shows 0 results | API quota exhausted (resets midnight PT) | Wait for reset or add more keys in `.env.local` |
| Instagram shows Google Trends data | `APIFY_TOKEN` not set or Apify run timed out | Add token; Instagram uses node:https to avoid connect timeouts |
| Instagram shows 0 results | Instagram mobile API blocked (400) + Apify network error | Apify run should succeed with node:https fix; Google Trends kicks in as fallback |
| Facebook shows 0 results | `SGAI_API_KEY` not set or ScrapeGraphAI credits exhausted | Add SGAI key or check credits at scrapegraphai.com/dashboard |
| Twitter shows stock photos | Old Unsplash fallbacks from previous run | Restart server + refresh Twitter; new runs use styled gradient cards when no news image |
| Twitter shows 0 trends | trends24.in unreachable | App falls back to getdaytrends.com automatically |
| Google Trends shows few items | Apify actor failed; falling back to RSS | RSS fallback now fetches 8 category feeds → 80–120 unique trends |
| Images not loading | CDN hotlink block | All images route through `/api/image-proxy` — check proxy logs |
| Grey YouTube thumbnails | Video has no custom thumbnail | Proxy auto-detects grey placeholders (<5KB) and serves fallback image |
| All trends empty after restart | In-memory store cleared, startup cooldown active | Click any platform button to manually trigger a fresh scrape |
| `UND_ERR_CONNECT_TIMEOUT` in logs | undici 10s TCP connect timeout (old bug) | Fixed — Instagram now uses node:https with 60s timeout |
| Build fails on `npm run build` | Missing env vars at build time | API keys are runtime-only — build succeeds without them |
