import fs from 'fs';
import path from 'path';
import type { Moment } from '@/types';
import { classifyTrend } from './classifier';
import { reserveCall, commitActual, releaseReservation } from '@/server/db/apify-spend';
import { fetchTopicImage } from './image-utils';

const APIFY_BASE = 'https://api.apify.com/v2';
const CACHE_FILE = path.join(process.cwd(), '.youtube-cache.json');
const CACHE_FRESH_MS = 6 * 60 * 60 * 1000; // 6 hours

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
      return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')) as CacheData;
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
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ moments, savedAt: new Date().toISOString() }), 'utf-8');
    console.log(`[YouTube] Cache saved: ${moments.length} trends`);
  } catch { /* ignore */ }
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface VideoItem {
  id?: string;
  title: string;
  channelTitle: string;
  description?: string;
  publishedAt?: string;
  thumbnailUrl?: string; // already-resolved URL or undefined (we'll fill via topic image)
  viewCount?: number;
  likeCount?: number;
  source: 'api' | 'webclient' | 'rss' | 'apify';
}

// Returns true if the title is predominantly English/Latin script.
function isEnglishTitle(title: string): boolean {
  if (!title) return false;
  const nonLatin = (title.match(/[ऀ-ॿঀ-৿਀-੿઀-૿଀-୿஀-௿ఀ-౿ಀ-೿ഀ-ൿ؀-ۿ一-鿿぀-ゟ゠-ヿ]/g) ?? []).length;
  return nonLatin / title.length < 0.15;
}

// Route a raw image URL through the proxy with grey-placeholder detection.
function proxyYt(rawUrl: string): string {
  return `/api/image-proxy?url=${encodeURIComponent(rawUrl)}&yt=1`;
}

// ─── YouTube Data API v3 ──────────────────────────────────────────────────────

interface YTApiResponse {
  items?: Array<{
    id?: string;
    snippet?: {
      title?: string;
      description?: string;
      channelTitle?: string;
      publishedAt?: string;
      thumbnails?: {
        maxres?: { url?: string };
        high?: { url?: string };
        standard?: { url?: string };
        medium?: { url?: string };
      };
    };
    statistics?: { viewCount?: string; likeCount?: string };
  }>;
  error?: { message?: string; errors?: Array<{ reason?: string }> };
}

async function fetchTrendingByKey(key: string, regionCode: string): Promise<{ items: VideoItem[]; quotaExceeded: boolean }> {
  try {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&chart=mostPopular&regionCode=${regionCode}&maxResults=50&key=${key}`,
      { signal: AbortSignal.timeout(15_000) },
    );

    if (res.status === 403) {
      const body = await res.json() as YTApiResponse;
      const reason = body.error?.errors?.[0]?.reason;
      if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
        console.warn(`[YouTube] Key …${key.slice(-6)} quota exceeded (${regionCode})`);
        return { items: [], quotaExceeded: true };
      }
      console.error(`[YouTube] Key …${key.slice(-6)} 403 (${regionCode}):`, body.error?.message);
      return { items: [], quotaExceeded: false };
    }

    if (!res.ok) {
      console.error(`[YouTube] API ${res.status} (${regionCode})`);
      return { items: [], quotaExceeded: false };
    }

    const data = await res.json() as YTApiResponse;
    const items: VideoItem[] = (data.items ?? [])
      .filter(i => i.snippet?.title)
      .map(i => {
        const t = i.snippet!;
        const rawThumb =
          t.thumbnails?.maxres?.url ??
          t.thumbnails?.high?.url ??
          t.thumbnails?.standard?.url ??
          t.thumbnails?.medium?.url;
        return {
          id: i.id,
          title: t.title ?? '',
          channelTitle: t.channelTitle ?? 'YouTube',
          description: t.description,
          publishedAt: t.publishedAt,
          thumbnailUrl: rawThumb ? proxyYt(rawThumb) : (i.id ? proxyYt(`https://i.ytimg.com/vi/${i.id}/hqdefault.jpg`) : undefined),
          viewCount: parseInt(i.statistics?.viewCount ?? '0'),
          likeCount: parseInt(i.statistics?.likeCount ?? '0'),
          source: 'api' as const,
        };
      });

    return { items, quotaExceeded: false };
  } catch (e) {
    console.error(`[YouTube] API fetch failed (${regionCode}):`, e);
    return { items: [], quotaExceeded: false };
  }
}

async function fetchTrendingWithRotation(regionCode: string): Promise<{ items: VideoItem[]; allExhausted: boolean }> {
  const keys = getApiKeys();
  if (keys.length === 0) return { items: [], allExhausted: true };

  for (const key of keys) {
    const { items, quotaExceeded } = await fetchTrendingByKey(key, regionCode);
    if (!quotaExceeded) {
      if (items.length > 0) return { items, allExhausted: false };
      // Non-quota error (403 forbidden, bad key, etc.) — try next key
    }
    // quotaExceeded — try next key
  }
  console.error(`[YouTube] All ${keys.length} key(s) exhausted / failed for ${regionCode}`);
  return { items: [], allExhausted: true };
}

// Marketing keyword search — costs 100 quota units per call
const SEARCH_QUERY = 'moment marketing OR creative advertising OR outdoor advertising OR marketing campaign OR kitkat ad';

async function fetchByKeywords(): Promise<VideoItem[]> {
  const keys = getApiKeys();
  for (const key of keys) {
    try {
      const res = await fetch(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(SEARCH_QUERY)}&type=video&regionCode=IN&order=relevance&maxResults=25&key=${key}`,
        { signal: AbortSignal.timeout(15_000) },
      );
      if (res.status === 403) {
        const body = await res.json() as YTApiResponse;
        const reason = body.error?.errors?.[0]?.reason;
        if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
          console.warn(`[YouTube] Keyword search: key …${key.slice(-6)} quota exceeded`);
          continue;
        }
      }
      if (!res.ok) continue;

      const data = await res.json() as { items?: Array<{ id?: { videoId?: string }; snippet?: { title?: string; description?: string; channelTitle?: string; publishedAt?: string; thumbnails?: { maxres?: { url?: string }; high?: { url?: string }; medium?: { url?: string } } } }> };
      const items: VideoItem[] = (data.items ?? [])
        .filter(i => i.id?.videoId && i.snippet?.title)
        .map(i => {
          const t = i.snippet!;
          const vid = i.id!.videoId!;
          const rawThumb = t.thumbnails?.high?.url ?? t.thumbnails?.medium?.url;
          return {
            id: vid,
            title: t.title ?? '',
            channelTitle: t.channelTitle ?? 'YouTube',
            description: t.description,
            publishedAt: t.publishedAt,
            thumbnailUrl: rawThumb ? proxyYt(rawThumb) : proxyYt(`https://i.ytimg.com/vi/${vid}/hqdefault.jpg`),
            viewCount: 0,
            source: 'api' as const,
          };
        });
      console.log(`[YouTube] Keyword search → ${items.length} videos`);
      return items;
    } catch { continue; }
  }
  return [];
}

// ─── Web-client API fallback (no quota) ──────────────────────────────────────
// Uses the public key embedded in every YouTube page — same one yt-dlp uses.

const YT_INNER_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

// Recursively walk any JSON structure to collect all videoRenderer objects.
// More resilient than hardcoding the path — handles YouTube layout changes.
function collectVideoRenderers(obj: unknown, out: VideoItem[] = []): VideoItem[] {
  if (!obj || typeof obj !== 'object') return out;
  if (Array.isArray(obj)) { obj.forEach(v => collectVideoRenderers(v, out)); return out; }

  const node = obj as Record<string, unknown>;

  // videoRenderer or gridVideoRenderer or reelItemRenderer
  const renderer = (node.videoRenderer ?? node.gridVideoRenderer ?? node.reelItemRenderer) as Record<string, unknown> | undefined;
  if (renderer) {
    const videoId = renderer.videoId as string | undefined;
    const titleRuns = ((renderer.title as Record<string, unknown>)?.runs as Array<{ text?: string }>);
    const title = titleRuns?.[0]?.text ?? '';
    if (videoId && title) {
      const thumbs = ((renderer.thumbnail as Record<string, unknown>)?.thumbnails as Array<{ url?: string; width?: number }>) ?? [];
      const best = thumbs.reduce((a, b) => (b.width ?? 0) > (a.width ?? 0) ? b : a, thumbs[0] ?? {});
      out.push({
        id: videoId,
        title,
        channelTitle: (((renderer.ownerText as Record<string, unknown>)?.runs as Array<{ text?: string }>)?.[0]?.text ?? 'YouTube'),
        thumbnailUrl: best.url ? proxyYt(best.url) : proxyYt(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`),
        viewCount: 0,
        source: 'webclient' as const,
      });
    }
  }

  // Recurse into all values
  for (const v of Object.values(node)) collectVideoRenderers(v, out);
  return out;
}

async function fetchViaWebClient(regionCode: string): Promise<VideoItem[]> {
  try {
    const res = await fetch(`https://www.youtube.com/youtubei/v1/browse?key=${YT_INNER_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: { client: { clientName: 'WEB', clientVersion: '2.20250101.00.00', hl: 'en', gl: regionCode } },
        browseId: 'FEtrending',
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) { console.warn(`[YouTube] Web client ${regionCode} → ${res.status}`); return []; }

    const data = await res.json() as unknown;
    const items = collectVideoRenderers(data);

    // Dedupe by videoId
    const seen = new Set<string>();
    const unique = items.filter(i => { if (!i.id || seen.has(i.id)) return false; seen.add(i.id!); return true; });
    console.log(`[YouTube] Web client ${regionCode} → ${unique.length} videos`);
    return unique;
  } catch (e) {
    console.warn('[YouTube] Web client failed:', (e as Error).message);
    return [];
  }
}

// ─── Apify fallback ───────────────────────────────────────────────────────────

async function fetchViaApify(apifyToken: string): Promise<VideoItem[]> {
  const reservation = await reserveCall('apify/youtube-scraper', 50, 10);
  if (!reservation) { console.warn('[YouTube] Apify budget exhausted'); return []; }

  try {
    const res = await fetch(
      `${APIFY_BASE}/acts/apify~youtube-scraper/run-sync-get-dataset-items?timeout=120&format=json`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${apifyToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ startUrls: [{ url: 'https://www.youtube.com/feed/trending?gl=IN' }], maxItems: reservation.safeLimit }),
        signal: AbortSignal.timeout(130_000),
      },
    );
    if (!res.ok) { await releaseReservation(reservation); return []; }

    const raw = await res.json() as Array<{ title?: string; channelName?: string; thumbnailUrl?: string; viewCount?: number; likeCount?: number; publishedAt?: string; uploadDate?: string }>;
    await commitActual(reservation, raw.length);
    console.log(`[YouTube] Apify → ${raw.length} videos`);

    return raw.map(i => ({
      title: i.title ?? '',
      channelTitle: i.channelName ?? 'YouTube',
      thumbnailUrl: i.thumbnailUrl,
      viewCount: Number(i.viewCount ?? 0),
      likeCount: Number(i.likeCount ?? 0),
      publishedAt: i.publishedAt ?? i.uploadDate,
      source: 'apify' as const,
    }));
  } catch (e) {
    console.error('[YouTube] Apify fetch failed:', e);
    await releaseReservation(reservation);
    return [];
  }
}

// ─── Classify + image-fill ────────────────────────────────────────────────────

async function resolveImages(items: VideoItem[]): Promise<VideoItem[]> {
  // Fill missing thumbnails with topic-relevant images (batched to avoid hammering)
  const resolved = [...items];
  const missing = resolved.map((it, i) => ({ it, i })).filter(({ it }) => !it.thumbnailUrl);

  for (let b = 0; b < missing.length; b += 8) {
    const batch = missing.slice(b, b + 8);
    const imgs = await Promise.all(batch.map(({ it }) => fetchTopicImage(it.title.slice(0, 60) || 'youtube trending')));
    imgs.forEach((url, j) => { if (url) resolved[batch[j].i].thumbnailUrl = url; });
  }
  return resolved;
}

function toMoments(items: VideoItem[]): Moment[] {
  return items
    .filter(it => it.title && isEnglishTitle(it.title))
    .map(item => {
      const views = item.viewCount ?? 0;
      const score = Math.min(100, 50 + Math.floor(Math.log10(Math.max(views, 1)) * 6));
      const description = item.description?.replace(/\n/g, ' ').trim().slice(0, 120)
        ? `${item.description!.replace(/\n/g, ' ').trim().slice(0, 120)}… — ${item.channelTitle}`
        : `${item.channelTitle} • ${views > 0 ? views.toLocaleString() + ' views • ' : ''}Trending on YouTube`;

      return classifyTrend({
        name: item.title.slice(0, 100),
        description,
        imageUrl: item.thumbnailUrl,
        trendingScore: score,
        platform: 'YouTube',
        originDate: item.publishedAt,
        sourceAccounts: [
          { name: item.channelTitle, url: `https://www.youtube.com/results?search_query=${encodeURIComponent(item.channelTitle)}` },
          { name: `Watch on YouTube`, url: item.id ? `https://www.youtube.com/watch?v=${item.id}` : `https://www.youtube.com/results?search_query=${encodeURIComponent(item.title)}` },
        ],
      });
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function fetchYouTubeTrends(): Promise<Moment[]> {
  // 1. Serve fresh cache — no API calls needed
  if (isCacheFresh()) return getCachedMoments();

  const keys = getApiKeys();
  let rawItems: VideoItem[] = [];

  // 2. Try YouTube Data API v3 with all keys (IN + US trending + keyword search)
  if (keys.length > 0) {
    const [indiaResult, usResult, keywordItems] = await Promise.all([
      fetchTrendingWithRotation('IN'),
      fetchTrendingWithRotation('US'),
      fetchByKeywords(),
    ]);

    // Merge and dedupe by title
    const seen = new Set<string>();
    for (const item of [...indiaResult.items, ...usResult.items, ...keywordItems]) {
      const key = item.title.toLowerCase().trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rawItems.push(item);
    }

    console.log(`[YouTube] API → ${rawItems.length} videos (IN:${indiaResult.items.length} US:${usResult.items.length} search:${keywordItems.length})`);

    // If API returned nothing useful, fall through to web client
    if (rawItems.length === 0) {
      console.warn('[YouTube] API returned 0 items — trying web client fallback...');
    }
  }

  // 3. Web-client fallback (quota-free) — always try if API returned nothing
  if (rawItems.length === 0) {
    const [wcIndia, wcUs] = await Promise.all([
      fetchViaWebClient('IN'),
      fetchViaWebClient('US'),
    ]);

    const seen = new Set<string>();
    for (const item of [...wcIndia, ...wcUs]) {
      const key = item.title.toLowerCase().trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rawItems.push(item);
    }
    console.log(`[YouTube] Web client → ${rawItems.length} videos`);
  }

  // 4. Apify fallback
  if (rawItems.length === 0) {
    const apifyToken = process.env.APIFY_TOKEN;
    if (apifyToken) {
      const apifyItems = await fetchViaApify(apifyToken);
      rawItems.push(...apifyItems);
    }
  }

  // 5. Stale cache
  if (rawItems.length === 0) {
    const cached = getCachedMoments();
    if (cached.length > 0) {
      console.warn('[YouTube] All live sources exhausted — serving stale cache');
      return cached;
    }
    console.warn('[YouTube] No data available from any source');
    return [];
  }

  // 6. Fill missing thumbnails with topic-relevant images, then classify
  const withImages = await resolveImages(rawItems);
  const moments = toMoments(withImages);

  saveCache(moments);
  console.log(`[YouTube] ✓ ${moments.length} moments ready`);
  return moments;
}
