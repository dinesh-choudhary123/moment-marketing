import fs from 'fs';
import path from 'path';
import type { Moment } from '@/types';
import { classifyTrend } from './classifier';
import { reserveCall, commitActual, releaseReservation } from '@/server/db/apify-spend';

// ─── YouTube Data API v3 — videos.list chart=mostPopular ─────────────────────
// Quota cost: 1 unit per call (cheap). Two API keys rotate automatically.
// Cache freshness: 6h — no API call if cache is recent. Quota resets midnight PT.
// Fallback: disk cache → Apify (if token set).

const APIFY_BASE = 'https://api.apify.com/v2';
const CACHE_FILE = path.join(process.cwd(), '.youtube-cache.json');
const CACHE_FRESH_MS = 6 * 60 * 60 * 1000; // 6 hours

// All API keys — tried in order, switch on quota exceeded
function getApiKeys(): string[] {
  return [
    process.env.YOUTUBE_API_KEY,
    process.env.YOUTUBE_API_KEY_2,
    process.env.YOUTUBE_API_KEY_3,
  ].filter((k): k is string => Boolean(k));
}

interface CacheData { moments: Moment[]; savedAt: string }

function loadCache(): CacheData | null {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')) as CacheData;
      return parsed;
    }
  } catch { /* ignore */ }
  return null;
}

function isCacheFresh(): boolean {
  const cache = loadCache();
  if (!cache) return false;
  return Date.now() - new Date(cache.savedAt).getTime() < CACHE_FRESH_MS;
}

function getCachedMoments(): Moment[] {
  const cache = loadCache();
  if (!cache) return [];
  console.log(`[YouTube] Serving ${cache.moments.length} cached trends (saved ${cache.savedAt})`);
  return cache.moments;
}

function saveCache(moments: Moment[]): void {
  try {
    const data: CacheData = { moments, savedAt: new Date().toISOString() };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data), 'utf-8');
    console.log(`[YouTube] Cache saved: ${moments.length} trends`);
  } catch { /* ignore */ }
}

interface YouTubeVideoItem {
  id?: string; // videoId — present on videos.list items
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

// Proxy any image URL through /api/image-proxy with yt=1 grey-placeholder detection.
function proxyYtUrl(rawUrl: string): string {
  return `/api/image-proxy?url=${encodeURIComponent(rawUrl)}&yt=1`;
}

// Build a proxied YouTube thumbnail from a videoId (fallback when no API thumbnail).
function ytThumb(videoId: string): string {
  return proxyYtUrl(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`);
}

// Best available thumbnail from the API snippet, proxied.
// Prefers the actual uploaded thumbnail (maxres > high > standard) over auto-generated hqdefault.
function bestProxiedThumb(item: YouTubeVideoItem): string | undefined {
  const apiUrl =
    item.snippet?.thumbnails?.maxres?.url ??
    item.snippet?.thumbnails?.high?.url ??
    item.snippet?.thumbnails?.standard?.url;
  if (apiUrl) return proxyYtUrl(apiUrl);
  if (item.id) return ytThumb(item.id);
  return undefined;
}

// Returns true if the title is predominantly Latin/English script.
// Filters out Devanagari, Tamil, Telugu, Arabic, etc. (> 20% non-Latin chars).
function isEnglishTitle(title: string): boolean {
  if (!title) return false;
  const nonLatin = (title.match(/[ऀ-ॿঀ-৿਀-੿઀-૿଀-୿஀-௿ఀ-౿ಀ-೿ഀ-ൿ؀-ۿ一-鿿぀-ゟ゠-ヿ]/g) ?? []).length;
  return nonLatin / title.length < 0.15;
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

// ─── Keyless YouTube web-client API fallback ─────────────────────────────────
// YouTube's own web player embeds this public key in every page load.
// It calls the same browse endpoint used by yt-dlp and youtube-dl to fetch trending.
// Does NOT count against any user-project quota.

const YT_WEB_CLIENT_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

interface YTRenderer {
  videoId?: string;
  title?: { runs?: Array<{ text?: string }> };
  thumbnail?: { thumbnails?: Array<{ url?: string; width?: number; height?: number }> };
  viewCountText?: { simpleText?: string };
  shortViewCountText?: { simpleText?: string };
  publishedTimeText?: { simpleText?: string };
  lengthText?: { simpleText?: string };
  ownerText?: { runs?: Array<{ text?: string }> };
}

interface YTBrowseResponse {
  contents?: {
    twoColumnBrowseResultsRenderer?: {
      tabs?: Array<{
        tabRenderer?: {
          content?: {
            sectionListRenderer?: {
              contents?: Array<{
                itemSectionRenderer?: {
                  contents?: Array<{
                    shelfRenderer?: {
                      content?: {
                        expandedShelfContentsRenderer?: {
                          items?: Array<{ videoRenderer?: YTRenderer }>;
                        };
                        horizontalListRenderer?: {
                          items?: Array<{ gridVideoRenderer?: YTRenderer }>;
                        };
                      };
                    };
                  }>;
                };
              }>;
            };
          };
        };
      }>;
    };
  };
}

function extractVideoRenderers(data: YTBrowseResponse): YTRenderer[] {
  const renderers: YTRenderer[] = [];
  const tabs = data?.contents?.twoColumnBrowseResultsRenderer?.tabs ?? [];
  for (const tab of tabs) {
    const sections = tab?.tabRenderer?.content?.sectionListRenderer?.contents ?? [];
    for (const section of sections) {
      const items = section?.itemSectionRenderer?.contents ?? [];
      for (const item of items) {
        const shelf = item?.shelfRenderer?.content;
        if (shelf?.expandedShelfContentsRenderer?.items) {
          for (const v of shelf.expandedShelfContentsRenderer.items) {
            if (v.videoRenderer) renderers.push(v.videoRenderer);
          }
        }
        if (shelf?.horizontalListRenderer?.items) {
          for (const v of shelf.horizontalListRenderer.items) {
            if (v.gridVideoRenderer) renderers.push(v.gridVideoRenderer);
          }
        }
      }
    }
  }
  return renderers;
}

async function fetchYouTubeTrendsViaWebClient(regionCode: string): Promise<YouTubeVideoItem[]> {
  try {
    const res = await fetch(
      `https://www.youtube.com/youtubei/v1/browse?key=${YT_WEB_CLIENT_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: {
            client: {
              clientName: 'WEB',
              clientVersion: '2.20250101.00.00',
              hl: 'en',
              gl: regionCode,
            },
          },
          browseId: 'FEtrending',
        }),
        signal: AbortSignal.timeout(20_000),
      },
    );

    if (!res.ok) {
      console.warn(`[YouTube] Web client API ${regionCode} returned ${res.status}`);
      return [];
    }

    const data = await res.json() as YTBrowseResponse;
    const renderers = extractVideoRenderers(data);
    console.log(`[YouTube] Web client API ${regionCode} → ${renderers.length} videos`);

    return renderers
      .filter(r => r.videoId && r.title?.runs?.[0]?.text)
      .map(r => {
        const thumbs = r.thumbnail?.thumbnails ?? [];
        // Pick highest-resolution thumbnail available
        const bestThumb = thumbs.reduce((best, t) =>
          (t.width ?? 0) > (best.width ?? 0) ? t : best, thumbs[0] ?? {});
        return {
          id: r.videoId,
          snippet: {
            title: r.title?.runs?.[0]?.text ?? '',
            channelTitle: r.ownerText?.runs?.[0]?.text ?? 'YouTube',
            thumbnails: { high: { url: bestThumb.url } },
          },
          statistics: {
            viewCount: (r.viewCountText?.simpleText ?? '0').replace(/[^0-9]/g, ''),
          },
        } satisfies YouTubeVideoItem;
      });
  } catch (e) {
    console.warn('[YouTube] Web client API failed:', e);
    return [];
  }
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

// ─── Marketing keyword search ─────────────────────────────────────────────────
// Searches YouTube for moment-marketing related videos alongside trending.
// Each search costs 100 quota units (vs 1 for trending), so we use one key only.

const MARKETING_SEARCH_QUERY = 'moment marketing OR creative advertising OR outdoor advertising OR kitkat ad OR marketing campaign';

async function fetchYouTubeByKeywords(): Promise<YouTubeVideoItem[]> {
  const keys = getApiKeys();
  if (keys.length === 0) return [];

  for (const key of keys) {
    try {
      const url = [
        'https://www.googleapis.com/youtube/v3/search',
        '?part=snippet',
        `&q=${encodeURIComponent(MARKETING_SEARCH_QUERY)}`,
        '&type=video',
        '&regionCode=IN',
        '&order=relevance',
        '&maxResults=25',
        `&key=${key}`,
      ].join('');

      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });

      if (res.status === 403) {
        const body = await res.json() as YouTubeResponse;
        const reason = body.error?.errors?.[0]?.reason;
        if (reason === 'quotaExceeded') {
          console.warn(`[YouTube] Keyword search: key ...${key.slice(-6)} quota exceeded — trying next`);
          continue;
        }
      }

      if (!res.ok) { console.warn(`[YouTube] Keyword search error ${res.status}`); continue; }

      const data = await res.json() as { items?: Array<{ id?: { videoId?: string }; snippet?: YouTubeVideoItem['snippet'] }> };
      const items = (data.items ?? [])
        .filter(i => i.id?.videoId && i.snippet?.title && isEnglishTitle(i.snippet.title ?? ''))
        .map(i => ({
          id: i.id!.videoId,
          snippet: i.snippet,  // keep original thumbnails; bestProxiedThumb() will proxy them
        } satisfies YouTubeVideoItem));

      console.log(`[YouTube] Keyword search → ${items.length} marketing videos`);
      return items;
    } catch (e) {
      console.warn(`[YouTube] Keyword search failed:`, (e as Error).message);
    }
  }
  return [];
}

// Try all available API keys for a region; returns first non-quota-exceeded result
async function fetchRegionWithKeyRotation(
  regionCode: string,
): Promise<{ items: YouTubeVideoItem[]; allKeysExhausted: boolean }> {
  const keys = getApiKeys();
  if (keys.length === 0) return { items: [], allKeysExhausted: true };

  for (const key of keys) {
    const result = await fetchYouTubeTrendsByRegion(key, regionCode);
    if (!result.quotaExceeded) return { items: result.items, allKeysExhausted: false };
    console.warn(`[YouTube] Key ...${key.slice(-6)} quota exceeded for ${regionCode} — trying next key`);
  }
  console.error(`[YouTube] All ${keys.length} API key(s) exhausted for ${regionCode}`);
  return { items: [], allKeysExhausted: true };
}

export async function fetchYouTubeTrends(): Promise<Moment[]> {
  const keys = getApiKeys();
  if (keys.length === 0) {
    console.warn('[YouTube] No API keys set — loading from cache');
    return getCachedMoments();
  }

  // Serve from cache if it's still fresh (< 6h) — no API call needed
  if (isCacheFresh()) {
    return getCachedMoments();
  }

  // Fetch India + US trending AND marketing keyword search in parallel
  const [indiaResult, usResult, keywordItems] = await Promise.all([
    fetchRegionWithKeyRotation('IN'),
    fetchRegionWithKeyRotation('US'),
    fetchYouTubeByKeywords(),
  ]);

  // If all keys are exhausted, try keyless web-client API → Apify → stale cache
  if (indiaResult.allKeysExhausted || usResult.allKeysExhausted) {
    console.warn('[YouTube] All API keys quota exceeded — trying keyless web-client API...');

    const [webIndia, webUs] = await Promise.all([
      fetchYouTubeTrendsViaWebClient('IN'),
      fetchYouTubeTrendsViaWebClient('US'),
    ]);

    if (webIndia.length > 0 || webUs.length > 0) {
      // Reuse the same merge + classify logic below by injecting into result sets
      indiaResult.items = webIndia;
      indiaResult.allKeysExhausted = false;
      usResult.items = webUs;
      usResult.allKeysExhausted = false;
      console.log(`[YouTube] Web client API → IN:${webIndia.length} US:${webUs.length} videos`);
    } else {
      const apifyToken = process.env.APIFY_TOKEN;
      if (apifyToken) {
        const apifyMoments = await fetchYouTubeTrendsViaApify(apifyToken);
        if (apifyMoments.length > 0) { saveCache(apifyMoments); return apifyMoments; }
      }
      const cached = getCachedMoments();
      if (cached.length > 0) return cached;
      console.warn('[YouTube] All fallbacks exhausted — returning empty');
      return [];
    }
  }

  // Merge + dedupe by title: trending first, then keyword search results
  const seen = new Set<string>();
  const allItems: (YouTubeVideoItem & { geo: string })[] = [];

  for (const [result, geo] of [
    [indiaResult, 'IN'],
    [usResult, 'US'],
  ] as [{ items: YouTubeVideoItem[]; allKeysExhausted: boolean }, string][]) {
    for (const item of result.items) {
      const titleKey = (item.snippet?.title ?? '').toLowerCase().trim();
      if (!titleKey || seen.has(titleKey)) continue;
      seen.add(titleKey);
      allItems.push({ ...item, geo });
    }
  }

  // Append keyword search results (marketing videos not in trending)
  for (const item of keywordItems) {
    const titleKey = (item.snippet?.title ?? '').toLowerCase().trim();
    if (!titleKey || seen.has(titleKey)) continue;
    seen.add(titleKey);
    allItems.push({ ...item, geo: 'SEARCH' });
  }

  console.log(
    `[YouTube] ${allItems.length} total videos` +
    ` (IN trending: ${indiaResult.items.length}, US trending: ${usResult.items.length}, marketing search: ${keywordItems.length})`,
  );

  const moments = allItems
    .filter(item => isEnglishTitle(item.snippet?.title ?? ''))
    .map(item => {
      const views = parseInt(item.statistics?.viewCount ?? '0');
      const likes = parseInt(item.statistics?.likeCount ?? '0');
      const score = Math.min(100, 50 + Math.floor(Math.log10(Math.max(views, 1)) * 6));

      // Use actual API thumbnail URL (creator-uploaded) through proxy; fall back to hqdefault.
      const thumb = bestProxiedThumb(item);

      const geoLabel = item.geo === 'IN' ? 'India' : item.geo === 'SEARCH' ? 'Marketing' : 'Global';

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

  saveCache(moments);
  return moments;
}
