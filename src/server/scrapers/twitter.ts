import type { Moment } from '@/types';
import { classifyTrend } from './classifier';
import { fetchTopicImage } from './image-utils';

// ─── Twitter/X scraper ────────────────────────────────────────────────────────
// Primary  : trends24.in/india/ — real-time "Trending in India" topics, no API needed
// Fallback : getdaytrends.com/india — backup India trends source
// The Apify tweet scraper is NOT used here — it fetches random tweets, not trending topics.

// ─── trends24.in parser ───────────────────────────────────────────────────────

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
        'Accept-Language': 'en-IN,en;q=0.9',
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      console.warn(`[Twitter] trends24.in returned ${res.status}`);
      return [];
    }
    const html = await res.text();
    const trends = parseTrends24Html(html).slice(0, 50);
    console.log(`[Twitter] trends24.in → ${trends.length} India trends`);
    return trends;
  } catch (e) {
    console.warn('[Twitter] trends24.in fetch failed:', e);
    return [];
  }
}

async function fetchFromTrends24Extra(): Promise<TrendEntry[]> {
  // Pull recent past-hour and 2-hour windows to get more India trends
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
      const parsed = parseTrends24Html(html, results.length + 50);
      results.push(...parsed);
    } catch { /* skip */ }
  }
  return results;
}

// ─── getdaytrends.com fallback ────────────────────────────────────────────────

async function fetchFromGetDayTrends(): Promise<TrendEntry[]> {
  try {
    const res = await fetch('https://getdaytrends.com/india/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'text/html',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    const html = await res.text();

    const seen = new Set<string>();
    const trends: TrendEntry[] = [];
    // getdaytrends uses <span class="main"> or similar for trend names
    const pat = /class="main[^"]*"\s*>\s*([^<]{2,60})\s*</gi;
    for (const [, name] of html.matchAll(pat)) {
      const clean = name.trim();
      const key = clean.toLowerCase();
      if (!clean || seen.has(key)) continue;
      seen.add(key);
      trends.push({
        name: clean,
        rank: trends.length + 1,
        twitterSearchUrl: `https://twitter.com/search?q=${encodeURIComponent(clean)}&src=trend_click&vertical=trends`,
      });
      if (trends.length >= 30) break;
    }
    console.log(`[Twitter] getdaytrends.com → ${trends.length} India trends`);
    return trends;
  } catch (e) {
    console.warn('[Twitter] getdaytrends.com failed:', e);
    return [];
  }
}

// ─── Main scraper ─────────────────────────────────────────────────────────────

export async function fetchTwitterTrends(): Promise<Moment[]> {
  console.log('[Twitter] Fetching India trending topics from trends24.in...');

  // Fetch current + recent trends in parallel
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

  // If trends24.in fails entirely, try getdaytrends
  if (allTrends.length === 0) {
    console.warn('[Twitter] trends24.in returned 0 — trying getdaytrends.com...');
    const fallbackTrends = await fetchFromGetDayTrends();
    allTrends.push(...fallbackTrends);
  }

  if (allTrends.length === 0) {
    console.warn('[Twitter] All India trend sources returned 0');
    return [];
  }

  const top = allTrends.slice(0, 60);
  const now = new Date().toISOString();

  console.log(`[Twitter] Resolving Bing News images for ${top.length} India trends...`);

  // Only fetch real Bing News images — no Unsplash fallbacks.
  // If Bing has no thumbnail for a trend, the card will show its styled gradient placeholder.
  // This is intentional: a clean gradient always looks better than an irrelevant stock photo.
  const imageUrls: Array<string | undefined> = [];
  for (let i = 0; i < top.length; i += 8) {
    const batch = top.slice(i, i + 8);
    const batchImages = await Promise.all(
      batch.map(t => {
        const query = t.name.startsWith('#')
          ? `${t.name.slice(1)} India news today`
          : `${t.name} India news today`;
        return fetchTopicImage(query);
      }),
    );
    imageUrls.push(...batchImages);
  }

  const moments = top
    .map((trend, idx) => {
      const trendingScore = Math.max(60, 100 - (trend.rank - 1) * 0.65);
      const emoji = trend.rank <= 3 ? '🔥 ' : trend.rank <= 10 ? '📈 ' : '';
      const hasRealImage = !!imageUrls[idx];
      return classifyTrend({
        name: trend.name,
        description: `${emoji}${trend.name}${trend.rank <= 10 ? ` — #${trend.rank} Trending in India right now` : ' — Trending in India'}`,
        // Only pass a real news image; if none found, skip fallback → card shows gradient
        imageUrl: hasRealImage ? imageUrls[idx] : undefined,
        skipFallbackImage: !hasRealImage,
        trendingScore,
        platform: 'Twitter',
        originDate: now,
        sourceAccounts: [
          { name: `Trending in India`, url: trend.twitterSearchUrl },
        ],
      });
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);

  console.log(`[Twitter] → ${moments.length} India trending moments`);
  return moments;
}
