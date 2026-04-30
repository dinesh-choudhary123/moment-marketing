import type { Moment } from '@/types';
import { classifyTrend } from './classifier';
import { reserveCall, commitActual, releaseReservation } from '@/server/db/apify-spend';

// ─── YouTube Data API v3 — videos.list chart=mostPopular ─────────────────────
// Image: snippet.thumbnails.high.url — direct YouTube CDN, always accessible.
// On quota exceeded (403 quotaExceeded): falls back to apify/youtube-scraper.

const APIFY_BASE = 'https://api.apify.com/v2';

// Catch trending videos from the past 72h (some trend for 2–3 days)
const FRESHNESS_WINDOW_MS = 72 * 60 * 60 * 1000;
// Lower threshold — gets far more real trending content early
const VIRAL_VIEWS_THRESHOLD = 10_000;

interface YouTubeVideoItem {
  snippet?: {
    title?: string;
    description?: string;
    channelTitle?: string;
    publishedAt?: string;
    thumbnails?: {
      high?: { url?: string };
      maxres?: { url?: string };
      standard?: { url?: string };
    };
  };
  statistics?: {
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
  };
}

interface YouTubeErrorDetail {
  reason?: string;
  message?: string;
}

interface YouTubeResponse {
  items?: YouTubeVideoItem[];
  error?: {
    message?: string;
    errors?: YouTubeErrorDetail[];
  };
}

// ─── Apify fallback ───────────────────────────────────────────────────────────

interface ApifyYouTubeItem {
  title?: string;
  viewCount?: number | string;
  likeCount?: number | string;
  channelName?: string;
  thumbnailUrl?: string;
  uploadDate?: string;
  publishedAt?: string;
}

async function fetchYouTubeTrendsViaApify(apifyToken: string): Promise<Moment[]> {
  const reservation = await reserveCall('apify/youtube-scraper', 50, 10);
  if (!reservation) {
    console.warn('[YouTube] Apify fallback budget exhausted');
    return [];
  }

  console.log('[YouTube] Quota exceeded → trying Apify youtube-scraper fallback...');

  let items: ApifyYouTubeItem[] = [];
  try {
    const res = await fetch(
      `${APIFY_BASE}/acts/apify~youtube-scraper/run-sync-get-dataset-items?timeout=120&format=json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apifyToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          startUrls: [
            { url: 'https://www.youtube.com/feed/trending?gl=IN' },
          ],
          maxItems: reservation.safeLimit,
        }),
        signal: AbortSignal.timeout(130_000),
      },
    );

    if (!res.ok) {
      console.error(`[YouTube] Apify fallback error ${res.status}`);
      await releaseReservation(reservation);
      return [];
    }

    items = (await res.json()) as ApifyYouTubeItem[];
  } catch (e) {
    console.error('[YouTube] Apify fallback fetch failed:', e);
    await releaseReservation(reservation);
    return [];
  }

  await commitActual(reservation, items.length);
  console.log(`[YouTube] Apify fallback → ${items.length} items`);

  return items
    .map(item => {
      const views = Number(item.viewCount ?? 0);
      const likes = Number(item.likeCount ?? 0);
      const score = Math.min(100, 50 + Math.floor(Math.log10(Math.max(views, 1)) * 6));

      const channelApify = item.channelName ?? 'YouTube';
      // Apify actor returns title but not description — use title as context if no extra data
      const description = `${channelApify} • ${views.toLocaleString()} views${likes > 0 ? ` • ${likes.toLocaleString()} likes` : ''} • Trending`;

      return classifyTrend({
        name: (item.title ?? 'YouTube Trending').slice(0, 100),
        description,
        imageUrl: item.thumbnailUrl,
        trendingScore: score,
        platform: 'YouTube',
        originDate: item.publishedAt ?? item.uploadDate,
      });
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);
}

// ─── Primary: YouTube Data API v3 ─────────────────────────────────────────────

// Returns items, or null if quota exceeded (caller should try Apify fallback)
async function fetchYouTubeTrendsByRegion(
  key: string,
  regionCode: string,
): Promise<{ items: YouTubeVideoItem[]; quotaExceeded: boolean }> {
  try {
    const url = [
      'https://www.googleapis.com/youtube/v3/videos',
      '?part=snippet,statistics',
      '&chart=mostPopular',
      `&regionCode=${regionCode}`,
      '&maxResults=50',
      `&key=${key}`,
    ].join('');

    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });

    if (res.status === 403) {
      const body = await res.json() as YouTubeResponse;
      const reason = body.error?.errors?.[0]?.reason;
      if (reason === 'quotaExceeded') {
        console.warn(`[YouTube] ${regionCode}: quota exceeded`);
        return { items: [], quotaExceeded: true };
      }
      console.error(`[YouTube] ${regionCode} 403:`, body.error?.message);
      return { items: [], quotaExceeded: false };
    }

    if (!res.ok) {
      console.error(`[YouTube] ${regionCode} error ${res.status}:`, (await res.text()).slice(0, 200));
      return { items: [], quotaExceeded: false };
    }

    const data = await res.json() as YouTubeResponse;
    if (data.error) {
      console.error(`[YouTube] ${regionCode} API error:`, data.error.message);
      return { items: [], quotaExceeded: false };
    }

    return { items: data.items ?? [], quotaExceeded: false };
  } catch (e) {
    console.error(`[YouTube] ${regionCode} fetch failed:`, e);
    return { items: [], quotaExceeded: false };
  }
}

export async function fetchYouTubeTrends(): Promise<Moment[]> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.warn('[YouTube] YOUTUBE_API_KEY not set — skipping');
    return [];
  }

  // Fetch India + Global trending in parallel
  const [indiaResult, usResult] = await Promise.all([
    fetchYouTubeTrendsByRegion(apiKey, 'IN'),
    fetchYouTubeTrendsByRegion(apiKey, 'US'),
  ]);

  // If quota exceeded on either call, try Apify fallback
  if (indiaResult.quotaExceeded || usResult.quotaExceeded) {
    const apifyToken = process.env.APIFY_TOKEN;
    if (apifyToken) return fetchYouTubeTrendsViaApify(apifyToken);
    console.warn('[YouTube] Quota exceeded but no APIFY_TOKEN — returning empty');
    return [];
  }

  // Merge + dedupe by title
  const seen = new Set<string>();
  const allItems: (YouTubeVideoItem & { geo: string })[] = [];

  for (const [result, geo] of [
    [indiaResult, 'IN'],
    [usResult, 'US'],
  ] as [{ items: YouTubeVideoItem[] }, string][]) {
    for (const item of result.items) {
      const titleKey = (item.snippet?.title ?? '').toLowerCase().trim();
      if (!titleKey || seen.has(titleKey)) continue;
      seen.add(titleKey);
      allItems.push({ ...item, geo });
    }
  }

  // Filter by freshness + view count
  const viral = allItems.filter(item => {
    const pub = item.snippet?.publishedAt;
    if (!pub) return false;
    const t = new Date(pub).getTime();
    if (isNaN(t) || Date.now() - t > FRESHNESS_WINDOW_MS) return false;
    return parseInt(item.statistics?.viewCount ?? '0') >= VIRAL_VIEWS_THRESHOLD;
  });

  console.log(
    `[YouTube] ${viral.length} videos ≥${VIRAL_VIEWS_THRESHOLD.toLocaleString()} views` +
    ` (IN: ${indiaResult.items.length}, US: ${usResult.items.length} fetched)`,
  );

  return viral
    .map(item => {
      const views = parseInt(item.statistics?.viewCount ?? '0');
      const likes = parseInt(item.statistics?.likeCount ?? '0');
      const score = Math.min(100, 50 + Math.floor(Math.log10(Math.max(views, 1)) * 6));

      // Direct YouTube CDN thumbnail — always accessible, no fetchTopicImage needed
      const thumb =
        item.snippet?.thumbnails?.maxres?.url ??
        item.snippet?.thumbnails?.high?.url ??
        item.snippet?.thumbnails?.standard?.url;

      const geoLabel = item.geo === 'IN' ? 'India' : 'Global';

      const channelTitle = item.snippet?.channelTitle ?? 'YouTube';
      const rawDesc = (item.snippet?.description ?? '').replace(/\n/g, ' ').trim();
      const description = rawDesc.length > 10
        ? `${rawDesc.slice(0, 120)}${rawDesc.length > 120 ? '…' : ''} — ${channelTitle}`
        : `${channelTitle} • ${views.toLocaleString()} views • Trending in ${geoLabel}`;

      return classifyTrend({
        name: (item.snippet?.title ?? 'YouTube Trending').slice(0, 100),
        description,
        imageUrl: thumb,
        trendingScore: score,
        platform: 'YouTube',
        originDate: item.snippet?.publishedAt,
      });
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);
}
