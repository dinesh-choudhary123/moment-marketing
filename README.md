# Moment Marketing — Trend Intelligence Dashboard

A real-time trend aggregation platform built for marketing teams. It scrapes trending content from **YouTube, Twitter/X, Instagram, Reddit, Facebook, and Google Trends** and surfaces the most relevant moments for moment-marketing campaigns — especially for Indian advertising and brand strategy.

---

## What It Does

- Fetches live trending content from 6 platforms every few hours
- Filters for marketing-relevant trends (moment marketing, creative advertising, brand campaigns, IPL, Bollywood, etc.)
- Classifies each trend by category (Sports, Entertainment, Fashion, Tech, etc.) and computes a relevance score
- Presents everything as browsable "Moment Cards" — each with an image, description, trending score, and calendar integration
- All images from external CDNs (Instagram, Reddit, YouTube) are proxied server-side to avoid hotlink blocks

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS 4 |
| API layer | tRPC v11 + React Query v5 |
| Runtime | Node.js 20+ |
| External data | YouTube Data API v3, Apify actors, public RSS/HTML |

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
| `APIFY_TOKEN` | Yes (for Instagram/Twitter) | Apify platform token. Without it, Instagram falls back to Google Trends and Twitter uses trends24.in |

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
3. Budget: ~$0.50–$1.00 per full scrape cycle across all platforms
4. Actors used: `apify/instagram-hashtag-scraper`, `quacker/twitter-scraper`

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

| Platform | File | Method | Fallback |
|---|---|---|---|
| YouTube | `youtube.ts` | YouTube Data API v3 (IN + US trending + keyword search) | Keyless web-client API → Apify → disk cache |
| Twitter/X | `twitter.ts` | Apify `quacker/twitter-scraper` | trends24.in HTML scrape (free) |
| Instagram | `instagram.ts` | Apify `apify/instagram-hashtag-scraper` | Instagram mobile API → Google Trends RSS |
| Reddit | `reddit.ts` | Reddit public JSON API (no auth) | — |
| Facebook | `facebook.ts` | Apify page scraping | — |
| Google Trends | `google.ts` | Google Trends RSS feed (free) | — |

**Startup behaviour:** Twitter, Reddit, Instagram, Facebook, and Google Trends all scrape automatically on server start (with a 3-hour cooldown to prevent re-scraping on hot reload). YouTube is **not** scraped on startup to preserve API quota — click the YouTube button to trigger it.

**Caching:**
- YouTube results are cached to `.youtube-cache.json` for 6 hours
- All other platform results are held in-memory (cleared on restart)
- Apify spend is tracked in `.apify-spend.json` with a configurable daily budget cap ($3.00 default)

**Marketing hashtag targeting:** All scrapers filter for these 8 hashtags/topics in addition to general trending:
`momentmarketing`, `moment`, `marketingmentor`, `kitkat`, `advertising`, `outdooradvertising`, `marketing`, `creativeads`

---

## Deployment

### Prerequisites for all environments

1. Node.js 20 or higher
2. All environment variables from `.env.example` set in the platform's secrets/env panel
3. Production build:
   ```bash
   npm run build
   ```

---

### Deploy to Base44

Base44 runs Next.js apps natively as Node.js processes.

**Steps:**

1. Connect your GitHub repo (`dinesh-choudhary123/moment-marketing`) to Base44
2. In the Base44 project settings, add these environment variables:
   ```
   YOUTUBE_API_KEY=...
   YOUTUBE_API_KEY_2=...
   YOUTUBE_API_KEY_3=...
   APIFY_TOKEN=...
   ```
3. Set the **build command**:
   ```bash
   npm install && npm run build
   ```
4. Set the **start command**:
   ```bash
   npm run start
   ```
5. Set **Node version**: `20`
6. Deploy — Base44 will run the build and start the server on port 3000

> **Note:** The app writes two files at runtime (`.youtube-cache.json` and `.apify-spend.json`). If the deployment uses ephemeral containers these will reset on each restart — scraping will simply re-run automatically, which is fine.

---

### Deploy to Threezinc

Threezinc supports Docker-based deployments. Use the Dockerfile below.

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

**Step 2 — Build and push the image:**

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
```

**Step 4 — Deploy:**

Configure the deployment via the Threezinc dashboard with the image tag and env vars from Step 3, or use the CLI:

```bash
threezinc deploy \
  --image registry.threezinc.com/<your-org>/moment-marketing:latest \
  --port 3000
```

> **Port:** The app listens on **3000** by default. Configure your load balancer/reverse proxy accordingly.

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
│       ├── routers/            # tRPC routers
│       ├── scrapers/           # Per-platform scraper modules
│       │   ├── youtube.ts
│       │   ├── twitter.ts
│       │   ├── instagram.ts
│       │   ├── reddit.ts
│       │   ├── facebook.ts
│       │   ├── google.ts
│       │   ├── classifier.ts   # Category + score classifier
│       │   └── image-utils.ts  # Image fallback fetcher
│       └── db/
│           ├── store.ts        # In-memory moments store
│           └── apify-spend.ts  # Apify daily budget tracker
├── .env.example                # Template for required environment variables
└── next.config.ts
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| YouTube shows 0 results | API quota exhausted (resets midnight PT) | Wait for reset or add more API keys in `.env.local` |
| Instagram showing Google Trends data | `APIFY_TOKEN` not set | Add Apify token to env vars |
| Images not loading | CDN hotlink block | All images route through `/api/image-proxy` — check scraper output |
| Grey YouTube thumbnails | Video has no custom thumbnail | Proxy auto-detects grey placeholders (<5KB) and serves fallback image |
| Non-English trends appearing | Regional language YouTube content | `isEnglishTitle()` filter in `youtube.ts` — threshold is 15% non-Latin chars |
| All trends empty after restart | In-memory store cleared, startup cooldown active | Click any platform button to manually trigger a fresh scrape |
| Build fails on `npm run build` | Missing env vars at build time | YouTube/Apify keys are only needed at runtime, not build time — build should succeed without them |
