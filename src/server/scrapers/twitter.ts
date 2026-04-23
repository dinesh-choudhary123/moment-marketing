import type { Moment } from '@/types';
import { classifyTrend } from './classifier';

// Scrapes Twitter India trends from trends24.in — free, no API key, no Apify cost.
// Falls back to X API if the site is down.

// ─── trends24.in scraper (primary) ────────────────────────────────────────────

interface TrendEntry {
  name: string;
  rank: number;
  twitterSearchUrl: string;
}

async function fetchFromTrends24(): Promise<TrendEntry[]> {
  try {
    const res = await fetch('https://trends24.in/india/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MomentMarketing/1.0)',
        'Accept': 'text/html',
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      console.warn(`[Twitter] trends24.in returned ${res.status}`);
      return [];
    }
    const html = await res.text();

    // Each trend card contains a trend-card__list block.
    // We parse all trend-link anchors across the 3 most-recent hour blocks.
    // trend-link>TREND_NAME extracts the display name.
    const trendMatches = [...html.matchAll(/href="(https:\/\/twitter\.com\/search\?q=[^"]+)"[^>]*class=trend-link>([^<]+)/g)];

    const seen = new Set<string>();
    const trends: TrendEntry[] = [];

    for (const [, url, rawName] of trendMatches) {
      const name = rawName.trim();
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      trends.push({
        name,
        rank: trends.length + 1,
        twitterSearchUrl: url.replace(/&amp;/g, '&'),
      });
      if (trends.length >= 50) break;
    }

    console.log(`[Twitter] trends24.in → ${trends.length} India trends`);
    return trends;
  } catch (e) {
    console.warn('[Twitter] trends24.in fetch failed:', e);
    return [];
  }
}

// Also scrape a few more country-specific + global pages for diversity
async function fetchFromTrends24Extra(): Promise<TrendEntry[]> {
  const pages = [
    'https://trends24.in/india/1-hour-ago/',
    'https://trends24.in/india/2-hours-ago/',
  ];
  const results: TrendEntry[] = [];
  for (const url of pages) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MomentMarketing/1.0)' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) continue;
      const html = await res.text();
      const matches = [...html.matchAll(/href="(https:\/\/twitter\.com\/search\?q=[^"]+)"[^>]*class=trend-link>([^<]+)/g)];
      for (const [, u, rawName] of matches) {
        const name = rawName.trim();
        if (name) results.push({ name, rank: results.length + 50, twitterSearchUrl: u.replace(/&amp;/g, '&') });
      }
    } catch { /* skip */ }
  }
  return results;
}

// ─── X API fallback (exhausts quickly on free tier) ───────────────────────────

interface Tweet {
  text?: string;
  public_metrics?: { like_count?: number; retweet_count?: number; reply_count?: number; quote_count?: number };
  entities?: { hashtags?: Array<{ tag?: string }> };
  attachments?: { media_keys?: string[] };
  created_at?: string;
}
interface TweetSearchResponse {
  data?: Tweet[];
  includes?: { media?: Array<{ media_key?: string; preview_image_url?: string; url?: string }> };
}

const VIRAL_LIKES_THRESHOLD = 200;
const FRESHNESS_WINDOW_MS = 48 * 60 * 60 * 1000;
function isFresh(iso: string | undefined): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return !isNaN(t) && Date.now() - t <= FRESHNESS_WINDOW_MS;
}

const FALLBACK_QUERIES = [
  'IPL 2026 -is:retweet lang:en min_faves:100',
  'Bollywood trending -is:retweet lang:en min_faves:200',
  'India viral -is:retweet lang:en min_faves:300',
];

async function fetchViaXApi(token: string): Promise<Moment[]> {
  const results: Moment[] = [];
  const seen = new Set<string>();

  for (const query of FALLBACK_QUERIES) {
    try {
      const params = new URLSearchParams({
        query, max_results: '100', sort_order: 'relevancy',
        'tweet.fields': 'public_metrics,entities,attachments,created_at',
      });
      const res = await fetch(`https://api.twitter.com/2/tweets/search/recent?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        if (res.status === 402 || res.status === 403 || res.status === 429) break;
        continue;
      }
      const data = await res.json() as TweetSearchResponse;
      const tweets = (data.data ?? []).filter(t => isFresh(t.created_at) && (t.public_metrics?.like_count ?? 0) >= VIRAL_LIKES_THRESHOLD);
      for (const tweet of tweets.slice(0, 10)) {
        const likes = tweet.public_metrics?.like_count ?? 0;
        const rts = tweet.public_metrics?.retweet_count ?? 0;
        const engagement = likes + rts * 3;
        const score = Math.min(100, 50 + Math.floor(Math.log10(engagement + 1) * 10));
        const hashtags = tweet.entities?.hashtags?.map(h => `#${h.tag}`) ?? [];
        const name = hashtags.slice(0, 3).join(' ') || (tweet.text ?? '').replace(/https?:\/\/\S+/g, '').trim().slice(0, 80);
        const key = name.toLowerCase().trim();
        if (!name || seen.has(key)) continue;
        seen.add(key);
        const moment = classifyTrend({ name, description: `${tweet.text?.replace(/https?:\/\/\S+/g, '').trim()} • ${likes.toLocaleString()} likes`, trendingScore: score, platform: 'Twitter', originDate: tweet.created_at });
        if (moment) results.push(moment);
      }
    } catch { continue; }
  }
  return results;
}

// ─── Wikipedia image lookup ────────────────────────────────────────────────────

async function fetchWikipediaImage(trendName: string): Promise<string | undefined> {
  try {
    // Clean: remove #, split CamelCase, strip Twitter operators
    const query = trendName
      .replace(/^#/, '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_-]/g, ' ')
      .trim();
    if (!query || query.length < 3) return undefined;

    const url = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrlimit=1&prop=pageimages&format=json&pithumbsize=800&redirects=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6_000) });
    if (!res.ok) return undefined;
    const data = await res.json() as { query?: { pages?: Record<string, { thumbnail?: { source?: string } }> } };
    const pages = data.query?.pages ?? {};
    const page = Object.values(pages)[0];
    return page?.thumbnail?.source ?? undefined;
  } catch {
    return undefined;
  }
}

// ─── Main export ───────────────────────────────────────────────────────────────

export async function fetchTwitterTrends(): Promise<Moment[]> {
  // Primary: trends24.in — real Twitter India trending topics, no quota/cost
  const [currentTrends, extraTrends] = await Promise.all([
    fetchFromTrends24(),
    fetchFromTrends24Extra(),
  ]);

  // Merge + dedupe
  const allTrends: TrendEntry[] = [];
  const seen = new Set<string>();
  for (const t of [...currentTrends, ...extraTrends]) {
    const key = t.name.toLowerCase();
    if (!seen.has(key)) { seen.add(key); allTrends.push(t); }
  }

  if (allTrends.length > 0) {
    const now = new Date().toISOString();
    const top = allTrends.slice(0, 60);

    // Fetch Wikipedia images in parallel (batches of 10 to avoid rate limits)
    const wikiImages: Array<string | undefined> = [];
    for (let i = 0; i < top.length; i += 10) {
      const batch = top.slice(i, i + 10);
      const results = await Promise.all(batch.map(t => fetchWikipediaImage(t.name)));
      wikiImages.push(...results);
    }

    const moments = top.map((trend, idx) => {
      const trendingScore = Math.max(60, 100 - (trend.rank - 1) * 0.8);
      const description = `Trending on Twitter India • Rank #${trend.rank}`;

      const cleanKeyword = trend.name.replace(/^#/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').trim();
      // Wikipedia real photo first; fall back to Unsplash source with clean keyword
      const imageUrl = wikiImages[idx] ?? `https://source.unsplash.com/featured/800x450/?${encodeURIComponent(cleanKeyword)}`;

      return classifyTrend({
        name: trend.name,
        description,
        imageUrl,
        trendingScore,
        platform: 'Twitter',
        originDate: now,
      });
    }).filter((m): m is NonNullable<typeof m> => m !== null);

    console.log(`[Twitter] trends24.in → ${moments.length} moments from ${allTrends.length} trends`);
    return moments;
  }

  // Fallback: X API (limited free tier)
  console.warn('[Twitter] trends24.in returned 0 — trying X API fallback');
  const xToken = process.env.TWITTER_BEARER_TOKEN;
  if (!xToken) return [];
  return fetchViaXApi(xToken);
}
