import type { Moment } from '@/types';
import { classifyTrend } from './classifier';
import { reserveCall, commitActual, releaseReservation } from '@/server/db/apify-spend';
import { fetchTopicImage } from './image-utils';

// ─── Twitter/X scraper ────────────────────────────────────────────────────────
// Primary:  Apify quacker/twitter-scraper — scrapes trending topics for India
// Fallback: trends24.in HTML scrape — free, real-time Twitter India trends

const APIFY_BASE = 'https://api.apify.com/v2';

// ─── Apify quacker/twitter-scraper ────────────────────────────────────────────

interface ApifyTweet {
  id?: string;
  full_text?: string;
  text?: string;
  created_at?: string;
  retweet_count?: number;
  favorite_count?: number;
  like_count?: number;
  user?: { screen_name?: string; name?: string };
  author?: { userName?: string; name?: string };
  // New field names used by some actor versions
  tweetText?: string;
  retweetCount?: number;
  likeCount?: number;
}

async function fetchViaApify(token: string): Promise<Moment[]> {
  const reservation = await reserveCall('quacker/twitter-scraper', 100, 20);
  if (!reservation) {
    console.warn('[Twitter] Apify budget exhausted — using trends24.in fallback');
    return [];
  }

  console.log('[Twitter] Apify quacker/twitter-scraper (trending India, 100 tweets)...');

  let tweets: ApifyTweet[] = [];
  try {
    const res = await fetch(
      `${APIFY_BASE}/acts/quacker~twitter-scraper/run-sync-get-dataset-items?timeout=120&format=json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          searchTerms: ['trending India'],
          tweetsDesiredCount: reservation.safeLimit,
          addUserInfo: false,
          proxyConfig: { useApifyProxy: true },
        }),
        signal: AbortSignal.timeout(130_000),
      },
    );

    if (!res.ok) {
      console.error(`[Twitter] Apify error ${res.status}:`, (await res.text()).slice(0, 300));
      await releaseReservation(reservation);
      return [];
    }

    tweets = (await res.json()) as ApifyTweet[];
  } catch (e) {
    console.error('[Twitter] Apify fetch failed:', e);
    await releaseReservation(reservation);
    return [];
  }

  await commitActual(reservation, tweets.length);

  if (tweets.length === 0) {
    console.warn('[Twitter] Apify returned 0 tweets');
    return [];
  }

  console.log(`[Twitter] Apify → ${tweets.length} tweets`);

  // Dedupe by tweet text
  const seen = new Set<string>();
  const unique = tweets.filter(t => {
    const text = (t.full_text ?? t.tweetText ?? t.text ?? '').replace(/https?:\/\/\S+/g, '').trim();
    if (!text || text.length < 10) return false;
    const key = text.toLowerCase().slice(0, 60);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Resolve images in parallel (batch 10)
  const imageUrls: Array<string | undefined> = [];
  for (let i = 0; i < unique.length; i += 10) {
    const batch = unique.slice(i, i + 10);
    const batchImages = await Promise.all(
      batch.map(t => {
        const text = (t.full_text ?? t.tweetText ?? t.text ?? '').replace(/https?:\/\/\S+/g, '').replace(/#\S+/g, '').trim();
        return fetchTopicImage(text.slice(0, 60) || 'twitter trending india');
      }),
    );
    imageUrls.push(...batchImages);
  }

  return unique
    .map((tweet, idx) => {
      const text = (tweet.full_text ?? tweet.tweetText ?? tweet.text ?? '')
        .replace(/https?:\/\/\S+/g, '')
        .trim();
      const likes = tweet.favorite_count ?? tweet.likeCount ?? tweet.like_count ?? 0;
      const rts = tweet.retweet_count ?? tweet.retweetCount ?? 0;
      const engagement = likes + rts * 3;
      const score = Math.min(100, 50 + Math.floor(Math.log10(engagement + 1) * 10));
      const username =
        tweet.user?.screen_name ?? tweet.author?.userName ?? 'twitter';

      // Use the tweet text itself as description — it IS the trend context
      const snippet = text.length > 120 ? `${text.slice(0, 120)}…` : text;
      const descriptionText = snippet || `@${username} • Trending in India`;

      return classifyTrend({
        name: text.slice(0, 100) || 'Twitter Trending',
        description: `${descriptionText} — @${username}`,
        imageUrl: imageUrls[idx],
        trendingScore: score,
        platform: 'Twitter',
        originDate: tweet.created_at,
      });
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);
}

// ─── trends24.in fallback ─────────────────────────────────────────────────────

interface TrendEntry {
  name: string;
  rank: number;
  twitterSearchUrl: string;
}

function parseTrends24Html(html: string, rankOffset = 0): TrendEntry[] {
  const seen = new Set<string>();
  const trends: TrendEntry[] = [];

  // Pattern A: href before class  (original format)
  const patA = /href="(https?:\/\/(?:twitter|x)\.com\/search\?q=[^"]+)"[^>]*class="?trend-link"?>([^<]+)/gi;
  // Pattern B: class before href  (new format)
  const patB = /class="?trend-link"?[^>]*href="(https?:\/\/(?:twitter|x)\.com\/search\?q=[^"]+)"[^>]*>([^<]+)/gi;
  // Pattern C: data-trend attribute fallback
  const patC = /data-trend="([^"]+)"/gi;

  for (const pat of [patA, patB]) {
    for (const [, url, rawName] of html.matchAll(pat)) {
      const name = rawName.trim();
      const key = name.toLowerCase();
      if (!name || name.length < 2 || seen.has(key)) continue;
      seen.add(key);
      trends.push({
        name,
        rank: rankOffset + trends.length + 1,
        twitterSearchUrl: url.replace(/&amp;/g, '&'),
      });
    }
  }

  if (trends.length === 0) {
    for (const [, rawName] of html.matchAll(patC)) {
      const name = rawName.trim();
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      trends.push({
        name,
        rank: rankOffset + trends.length + 1,
        twitterSearchUrl: `https://twitter.com/search?q=${encodeURIComponent(name)}`,
      });
    }
  }

  return trends;
}

async function fetchFromTrends24(): Promise<TrendEntry[]> {
  try {
    const res = await fetch('https://trends24.in/india/', {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      console.warn(`[Twitter] trends24.in returned ${res.status}`);
      return [];
    }
    const html = await res.text();
    const trends = parseTrends24Html(html).slice(0, 60);
    console.log(`[Twitter] trends24.in → ${trends.length} India trends`);
    return trends;
  } catch (e) {
    console.warn('[Twitter] trends24.in fetch failed:', e);
    return [];
  }
}

async function fetchFromTrends24Extra(): Promise<TrendEntry[]> {
  const pages = [
    'https://trends24.in/india/1-hour-ago/',
    'https://trends24.in/india/2-hours-ago/',
    'https://trends24.in/india/3-hours-ago/',
  ];
  const results: TrendEntry[] = [];
  for (const url of pages) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Accept: 'text/html',
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) continue;
      const html = await res.text();
      const parsed = parseTrends24Html(html, results.length + 60);
      results.push(...parsed);
    } catch { /* skip */ }
  }
  return results;
}

async function fetchViaFallback(): Promise<Moment[]> {
  console.log('[Twitter] Using trends24.in fallback...');

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

  if (allTrends.length === 0) {
    console.warn('[Twitter] trends24.in returned 0 trends');
    return [];
  }

  const top = allTrends.slice(0, 60);
  const now = new Date().toISOString();

  // Resolve images in parallel (batch 10)
  const imageUrls: Array<string | undefined> = [];
  for (let i = 0; i < top.length; i += 10) {
    const batch = top.slice(i, i + 10);
    const batchImages = await Promise.all(batch.map(t => fetchTopicImage(t.name)));
    imageUrls.push(...batchImages);
  }

  const moments = top
    .map((trend, idx) => {
      const trendingScore = Math.max(60, 100 - (trend.rank - 1) * 0.8);
      return classifyTrend({
        name: trend.name,
        description: `${trend.rank <= 5 ? '🔥 ' : ''}${trend.name}${trend.rank <= 10 ? ` — #${trend.rank} trending in India right now` : ' — trending in India'}`,
        imageUrl: imageUrls[idx],
        trendingScore,
        platform: 'Twitter',
        originDate: now,
      });
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);

  console.log(`[Twitter] trends24.in → ${moments.length} moments from ${allTrends.length} trends`);
  return moments;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function fetchTwitterTrends(): Promise<Moment[]> {
  const token = process.env.APIFY_TOKEN;

  if (token) {
    try {
      const apifyResults = await fetchViaApify(token);
      if (apifyResults.length > 0) return apifyResults;
      console.warn('[Twitter] Apify returned 0 — using trends24.in fallback');
    } catch (e) {
      console.error('[Twitter] Apify error:', e);
    }
  }

  return fetchViaFallback();
}
