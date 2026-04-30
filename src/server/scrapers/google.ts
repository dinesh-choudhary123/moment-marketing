import type { Moment } from '@/types';
import { classifyTrend } from './classifier';
import { reserveCall, commitActual, releaseReservation } from '@/server/db/apify-spend';
import { fetchTopicImage } from './image-utils';

// ─── Google Trends scraper ────────────────────────────────────────────────────
// Primary:  Apify emastra/google-trends-scraper (realtime=true, geo=IN)
// Fallback: Google Trends RSS (free, no auth, updates hourly)

const APIFY_BASE = 'https://api.apify.com/v2';
const TRENDS_RSS_BASE = 'https://trends.google.com/trending/rss';

const GEO_TARGETS = [
  { geo: 'IN', label: 'India' },
  { geo: 'US', label: 'Global' },
];

// ─── RSS helpers (shared between primary + fallback) ─────────────────────────

interface GoogleTrendRSSItem {
  title: string;
  traffic: string;
  description: string;
  imageUrl?: string;
  newsTitle?: string;
  newsSource?: string;
}

function extractTag(xml: string, tag: string): string {
  const patterns = [
    new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i'),
    new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'),
  ];
  for (const pat of patterns) {
    const m = xml.match(pat);
    if (m?.[1]) return m[1].trim();
  }
  return '';
}

function extractAttr(xml: string, tag: string, attr: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`, 'i'));
  return m?.[1] ?? '';
}

function parseTrafficToScore(traffic: string): number {
  const num = parseInt(traffic.replace(/[^0-9]/g, ''), 10);
  if (!num) return 55;
  if (num >= 1_000_000) return 97;
  if (num >= 500_000) return 93;
  if (num >= 200_000) return 88;
  if (num >= 100_000) return 83;
  if (num >= 50_000) return 80;
  if (num >= 10_000) return 78;
  if (num >= 5_000) return 75;
  if (num >= 2_000) return 72;
  if (num >= 500) return 67;
  return 62;
}

async function fetchGoogleTrendsRSS(geo: string): Promise<GoogleTrendRSSItem[]> {
  try {
    const res = await fetch(`${TRENDS_RSS_BASE}?geo=${geo}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MomentMarketing/2.0)',
        Accept: 'application/rss+xml, application/xml, text/xml',
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return [];

    const xml = await res.text();
    const itemBlocks = xml.match(/<item>([\s\S]*?)<\/item>/gi) ?? [];
    const results: GoogleTrendRSSItem[] = [];

    for (const block of itemBlocks) {
      const title = extractTag(block, 'title');
      if (!title) continue;

      const traffic = extractTag(block, 'ht:approx_traffic');
      const imageUrl =
        extractAttr(block, 'ht:picture', 'url') ||
        extractTag(block, 'ht:picture') ||
        extractAttr(block, 'ht:news_item_picture', 'url') ||
        extractTag(block, 'ht:news_item_picture') ||
        undefined;

      const newsTitle = extractTag(block, 'ht:news_item_title');
      const newsSource = extractTag(block, 'ht:news_item_source');
      const newsSnippet = extractTag(block, 'ht:news_item_snippet');

      results.push({
        title,
        traffic,
        description:
          newsSnippet || newsTitle || `Trending on Google with ${traffic || 'high'} searches`,
        imageUrl: imageUrl || undefined,
        newsTitle: newsTitle || undefined,
        newsSource: newsSource || undefined,
      });
    }

    return results;
  } catch (e) {
    console.warn(`[Google] RSS fetch failed for geo=${geo}:`, e);
    return [];
  }
}

// ─── Apify emastra/google-trends-scraper ──────────────────────────────────────

interface ApifyGoogleTrendItem {
  title?: string;
  picture?: string;
  traffic?: string | number;
  articles?: Array<{
    title?: string;
    source?: string;
    picture?: string;
    url?: string;
  }>;
}

async function fetchViaApify(token: string): Promise<Moment[]> {
  const reservation = await reserveCall('emastra/google-trends-scraper', 50, 10);
  if (!reservation) {
    console.warn('[Google] Apify budget exhausted — using RSS fallback');
    return [];
  }

  console.log('[Google] Apify emastra/google-trends-scraper (realtime, geo=IN)...');

  let items: ApifyGoogleTrendItem[] = [];
  try {
    const res = await fetch(
      `${APIFY_BASE}/acts/emastra~google-trends-scraper/run-sync-get-dataset-items?timeout=120&format=json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          geo: 'IN',
          realtime: true,
          maxItems: reservation.safeLimit,
        }),
        signal: AbortSignal.timeout(130_000),
      },
    );

    if (!res.ok) {
      console.error(`[Google] Apify error ${res.status}:`, (await res.text()).slice(0, 300));
      await releaseReservation(reservation);
      return [];
    }

    items = (await res.json()) as ApifyGoogleTrendItem[];
  } catch (e) {
    console.error('[Google] Apify fetch failed:', e);
    await releaseReservation(reservation);
    return [];
  }

  await commitActual(reservation, items.length);

  if (items.length === 0) {
    console.warn('[Google] Apify returned 0 items');
    return [];
  }

  console.log(`[Google] Apify → ${items.length} trending topics`);

  // Resolve images in parallel (batch of 10 to avoid rate limits)
  const imageUrls: Array<string | undefined> = [];
  for (let i = 0; i < items.length; i += 10) {
    const batch = items.slice(i, i + 10);
    const batchImages = await Promise.all(
      batch.map(item => {
        // Prefer the picture the actor already embedded (directly topic-relevant)
        const direct = item.picture ?? item.articles?.[0]?.picture;
        return direct ? Promise.resolve(direct) : fetchTopicImage(item.title ?? 'google trends');
      }),
    );
    imageUrls.push(...batchImages);
  }

  return items
    .map((item, idx) => {
      const score = parseTrafficToScore(String(item.traffic ?? ''));
      const source = item.articles?.[0]?.source;
      const traffic = item.traffic ? ` • ${item.traffic} searches` : '';
      const sourceLabel = source ? ` • ${source}` : '';

      // Use the news headline as description — much more informative than "Trending on Google"
      const headline = item.articles?.[0]?.title ?? '';
      const trafficLabel = item.traffic ? ` • ${item.traffic} searches` : '';
      const description = headline
        ? `${headline.slice(0, 120)}${headline.length > 120 ? '…' : ''}${source ? ` — ${source}` : ''}${trafficLabel}`
        : `Trending on Google India${trafficLabel}${sourceLabel}`;

      return classifyTrend({
        name: (item.title ?? 'Google Trending').slice(0, 100),
        description,
        imageUrl: imageUrls[idx],
        trendingScore: score,
        platform: 'Google',
      });
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);
}

// ─── RSS fallback ─────────────────────────────────────────────────────────────

async function fetchViaRSS(): Promise<Moment[]> {
  console.log('[Google] Using RSS fallback (free)...');

  const [indiaItems, usItems] = await Promise.all([
    fetchGoogleTrendsRSS('IN'),
    fetchGoogleTrendsRSS('US'),
  ]);

  const allItems: (GoogleTrendRSSItem & { geo: string })[] = [
    ...indiaItems.map(i => ({ ...i, geo: 'IN' })),
    ...usItems.map(i => ({ ...i, geo: 'US' })),
  ];

  if (allItems.length === 0) {
    console.warn('[Google] RSS returned no items');
    return [];
  }

  // Dedupe by title
  const seen = new Set<string>();
  const unique = allItems.filter(item => {
    const key = item.title.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(
    `[Google] RSS → ${unique.length} trending searches (IN: ${indiaItems.length}, US: ${usItems.length})`,
  );

  // Resolve images in parallel — use RSS embedded image first, then fetchTopicImage
  const imageUrls: Array<string | undefined> = [];
  for (let i = 0; i < unique.length; i += 10) {
    const batch = unique.slice(i, i + 10);
    const batchImages = await Promise.all(
      batch.map(item =>
        item.imageUrl && item.imageUrl.startsWith('http')
          ? Promise.resolve(item.imageUrl)
          : fetchTopicImage(item.title),
      ),
    );
    imageUrls.push(...batchImages);
  }

  return unique
    .map((item, idx) => {
      const score = parseTrafficToScore(item.traffic);
      const source = item.newsSource ? ` • Source: ${item.newsSource}` : '';
      const traffic = item.traffic ? ` • ${item.traffic} searches` : '';
      const geoLabel = item.geo === 'IN' ? 'India' : 'Global';

      return classifyTrend({
        name: item.title,
        description: `${item.description}${source}${traffic} • Trending in ${geoLabel}`,
        imageUrl: imageUrls[idx],
        trendingScore: score,
        platform: 'Google',
      });
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function fetchGoogleTrends(): Promise<Moment[]> {
  const token = process.env.APIFY_TOKEN;

  if (token) {
    try {
      const apifyResults = await fetchViaApify(token);
      if (apifyResults.length > 0) return apifyResults;
      console.warn('[Google] Apify returned 0 — falling back to RSS');
    } catch (e) {
      console.error('[Google] Apify error:', e);
    }
  }

  return fetchViaRSS();
}
