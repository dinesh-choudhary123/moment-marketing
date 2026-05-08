import type { Moment } from '@/types';
import { classifyTrend } from './classifier';
import { reserveCall, commitActual, releaseReservation } from '@/server/db/apify-spend';
import { fetchTopicImage } from './image-utils';
import { request as httpsRequest } from 'node:https';

// ─── node:https helpers ───────────────────────────────────────────────────────
// We use node:https instead of global fetch for Apify calls because undici
// (the Node.js fetch implementation) has a hard 10-second TCP connect timeout
// (UND_ERR_CONNECT_TIMEOUT) that fires before Apify's server can respond.
// node:https uses native libuv sockets with configurable timeouts.

function nodeHttpsPost(url: string, token: string, body: unknown): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const bodyStr = JSON.stringify(body);
    const req = httpsRequest(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
        },
        timeout: 60_000,
      },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try { resolve({ status: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString()) }); }
          catch { resolve({ status: res.statusCode ?? 0, json: {} }); }
        });
      },
    );
    req.on('timeout', () => { req.destroy(); reject(new Error('Apify start timeout')); });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function nodeHttpsGet(url: string, token: string): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = httpsRequest(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        timeout: 30_000,
      },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try { resolve({ status: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString()) }); }
          catch { resolve({ status: res.statusCode ?? 0, json: {} }); }
        });
      },
    );
    req.on('timeout', () => { req.destroy(); reject(new Error('Apify poll timeout')); });
    req.on('error', reject);
    req.end();
  });
}

// ─── Instagram scraper ────────────────────────────────────────────────────────
//
// Scraping chain (each level is tried in order, falls to next on failure):
//
//   1. apify/instagram-scraper  with searchHashtags  ← trending hashtag posts
//   2. apify/instagram-scraper  with directUrls      ← top Indian profiles
//   3. Google Trends India RSS                       ← free, always-on fallback
//
// Both Apify paths use the SAME actor (`apify/instagram-scraper`) which is the
// official, most stable Apify actor for Instagram. Using one actor avoids actor-
// existence uncertainty. The only difference is the input object.

const APIFY_BASE = 'https://api.apify.com/v2';

// Keep posts up to 7 days old — Instagram trends often stay hot for many days.
// If timestamp field is ABSENT, posts are INCLUDED (don't silently drop them).
const FRESHNESS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// Seed hashtags — moment marketing tags first, then India trend categories.
// These always have fresh posts on Instagram.
// Only scrape these exact hashtags — specified by user
const SEED_HASHTAGS = [
  'momentmarketing', 'moment', 'marketingmentor', 'kitkat',
  'advertising', 'outdooradvertising', 'marketing', 'creativeads',
];

// We previously had hardcoded celebrity profiles here, but that skewed trends 
// entirely based on follower counts rather than real virality. We now rely exclusively 
// on discovering organic trends via hashtags.

// ─── Types ────────────────────────────────────────────────────────────────────

// Field names that different versions of apify/instagram-scraper use for the
// same data. We check all of them so nothing is silently dropped.
interface InstagramPost {
  id?: string;
  shortCode?: string;
  caption?: string;
  hashtags?: string[];
  url?: string;
  displayUrl?: string;
  images?: string[];
  videoUrl?: string;
  likesCount?: number;
  commentsCount?: number;
  videoViewCount?: number;
  ownerUsername?: string;
  ownerFullName?: string;
  ownerFollowersCount?: number; // follower count — used for engagement rate normalisation
  ownerVideoViewCount?: number;
  type?: string;
  // Multiple possible timestamp field names across actor versions:
  timestamp?: string;           // ISO string — most common
  takenAtTimestamp?: number;    // Unix seconds — older actor versions
  createdAt?: string;           // Alternative ISO field name
  taken_at?: number;            // Yet another variant (Unix seconds)
}

interface TrendingTopic {
  name: string;
  traffic?: number;
  relatedNews?: string[];
  imageUrl?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extract whichever timestamp field is present across different actor versions. */
function getTimestamp(p: InstagramPost): string | number | undefined {
  return p.timestamp ?? p.createdAt ?? p.takenAtTimestamp ?? p.taken_at;
}

function isFresh(ts: string | number | undefined): boolean {
  if (!ts) return true; // ← CRITICAL FIX: no timestamp = assume recent, do NOT drop
  const t = typeof ts === 'number'
    ? (ts > 1e10 ? ts : ts * 1000) // handle both ms and seconds
    : new Date(ts).getTime();
  if (isNaN(t)) return true; // unparseable = assume recent
  return Date.now() - t <= FRESHNESS_WINDOW_MS;
}

function isNonLatinScript(text: string): boolean {
  const nonLatinCount = (text.match(/[^\x00-\x7F]/g) ?? []).length;
  return nonLatinCount > text.length * 0.4;
}

function toHashtag(name: string): string {
  return name
    .replace(/^#/, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()
    .trim();
}

/** Filter raw posts: remove old/duplicate, keep everything else. */
function filterPosts(posts: InstagramPost[]): InstagramPost[] {
  const seen = new Set<string>();
  return posts.filter(p => {
    // Must have some content (caption OR image URL)
    const hasContent = !!(p.caption || p.displayUrl || p.images?.length || p.videoUrl);
    if (!hasContent) return false;

    // Freshness — only drop posts confirmed to be OLD.
    // If timestamp is ABSENT: include the post (don't silently discard).
    const ts = getTimestamp(p);
    if (!isFresh(ts)) return false;

    // Deduplicate
    const key = p.shortCode ?? p.id ?? p.caption?.slice(0, 60) ?? '';
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Compute a "bubble escape" virality score to remove follower-count bias. */
function computeScore(post: InstagramPost): number {
  const likes = post.likesCount ?? 0;
  const comments = post.commentsCount ?? 0;
  const views = post.videoViewCount ?? 0;
  
  // Virality metric: How many views & comments per like? 
  // High views/comments relative to likes means it's escaping the creator's follower bubble
  // and hitting the broader algorithm feed.
  const viralityRatio = ((comments * 20) + views) / (likes + 1);
  
  if (views > 0 || post.type === 'Video') {
    // If it's a Reel/Video, use the virality ratio
    return Math.min(100, 50 + Math.floor(viralityRatio * 2));
  }

  // If no views (image post), rely on comments vs likes
  const commentRatio = comments / (likes + 1);
  return Math.min(100, 50 + Math.floor(commentRatio * 1000));
}

/** Sort posts by virality ratio so viral small-creator reels surface above celebrity posts. */
function sortByEngagementRate(posts: InstagramPost[]): InstagramPost[] {
  return posts.slice().sort((a, b) => {
    const ratioA = (((a.commentsCount ?? 0) * 20) + (a.videoViewCount ?? 0)) / ((a.likesCount ?? 0) + 1);
    const ratioB = (((b.commentsCount ?? 0) * 20) + (b.videoViewCount ?? 0)) / ((b.likesCount ?? 0) + 1);
    return ratioB - ratioA;
  });
}

function postToMoment(post: InstagramPost, imageUrl: string | undefined): Moment | null {
  const score = computeScore(post);
  const caption = (post.caption ?? '').replace(/\n+/g, ' ').trim();
  const hashtagsText = (post.hashtags ?? []).slice(0, 3).map(h => `#${h}`).join(' ');
  const owner = post.ownerUsername ?? post.ownerFullName ?? 'instagram';

  // Minimal, useful context: first full sentence of caption or short snippet
  const captionSnippet = caption.replace(/#\S+/g, '').replace(/\s+/g, ' ').trim();
  let description = captionSnippet;
  if (captionSnippet.length > 120) {
    const firstSentenceMatch = captionSnippet.match(/^[^.!?]+[.!?]/);
    description = firstSentenceMatch ? firstSentenceMatch[0] : `${captionSnippet.slice(0, 120)}…`;
  }
  if (!description || description.length < 5) {
    description = `@${owner} shared a trending moment`;
  }

  const ts = getTimestamp(post);

  const ownerHandle = post.ownerUsername ?? '';
  const postHashtags = (post.hashtags ?? []).slice(0, 3);

  return classifyTrend({
    name: (caption || `@${owner} on Instagram`).slice(0, 100),
    description,
    imageUrl,
    trendingScore: score,
    platform: 'Instagram',
    originDate: typeof ts === 'number'
      ? new Date(ts > 1e10 ? ts : ts * 1000).toISOString()
      : (ts as string | undefined),
    sourceAccounts: [
      ...(ownerHandle ? [{ name: `@${ownerHandle}`, url: `https://www.instagram.com/${ownerHandle}/` }] : []),
      ...postHashtags.map(h => ({ name: `#${toHashtag(h)}`, url: `https://www.instagram.com/explore/tags/${toHashtag(h)}/` })),
    ],
  });
}

async function postsToMoments(posts: InstagramPost[]): Promise<Moment[]> {
  // Sort by engagement rate first so viral small-creator posts surface above celebrities
  const sorted = sortByEngagementRate(filterPosts(posts));

  // Use actual post images via proxy to avoid CDN blocks, fallback to Unsplash
  const imageUrls: Array<string | undefined> = await Promise.all(
    sorted.map(async (p) => {
      const realUrl = p.displayUrl || p.images?.[0];
      if (realUrl) {
        return `/api/image-proxy?url=${encodeURIComponent(realUrl)}`;
      }
      const caption = (p.caption ?? '').replace(/#\S+/g, '').replace(/\n/g, ' ').trim();
      const hashtags = (p.hashtags ?? []).slice(0, 2).join(' ');
      const keyword = caption.slice(0, 80) || hashtags || 'instagram trending india';
      return fetchTopicImage(keyword);
    })
  );

  return sorted
    .map((post, idx) => postToMoment(post, imageUrls[idx]))
    .filter((m): m is NonNullable<typeof m> => m !== null);
}

// ─── Instagram mobile web API (no token needed) ──────────────────────────────
// Uses the same endpoint Instagram's Android app calls for hashtag explore.
// No auth required for public hashtags — returns posts with full image URLs.

interface IGMobileMedia {
  id?: string;
  caption?: { text?: string };
  image_versions2?: { candidates?: Array<{ url?: string; width?: number; height?: number }> };
  carousel_media?: Array<{ image_versions2?: { candidates?: Array<{ url?: string }> } }>;
  like_count?: number;
  comment_count?: number;
  view_count?: number;
  video_view_count?: number;
  taken_at?: number;
  user?: { username?: string; full_name?: string };
  media_type?: number; // 1 = photo, 2 = video, 8 = carousel
}

interface IGMobileSectionMedia {
  media?: IGMobileMedia;
}

interface IGMobileSection {
  layout_content?: { medias?: IGMobileSectionMedia[] };
}

interface IGMobileTagResponse {
  sections?: IGMobileSection[];
  more_available?: boolean;
}

function igMediaToPost(m: IGMobileMedia): InstagramPost | null {
  if (!m.id) return null;

  // Pick the best image: first candidate (highest res) or first carousel image
  const candidates = m.image_versions2?.candidates ?? [];
  const carouselFirst = m.carousel_media?.[0]?.image_versions2?.candidates?.[0]?.url;
  const imageUrl = candidates[0]?.url ?? carouselFirst;

  const caption = m.caption?.text ?? '';
  const hashtags = (caption.match(/#\w+/g) ?? []).map(h => h.replace('#', ''));

  return {
    id: m.id,
    caption,
    hashtags,
    displayUrl: imageUrl,
    likesCount: m.like_count ?? 0,
    commentsCount: m.comment_count ?? 0,
    videoViewCount: m.video_view_count ?? m.view_count,
    ownerUsername: m.user?.username,
    ownerFullName: m.user?.full_name,
    type: m.media_type === 2 ? 'Video' : 'Image',
    taken_at: m.taken_at,
  };
}

async function fetchInstagramViaWebAPI(hashtags: string[]): Promise<InstagramPost[]> {
  const allPosts: InstagramPost[] = [];
  const headers = {
    'User-Agent': 'Instagram 123.0.0.21.114 Android (26/8.0.0; 480dpi; 1080x1920; OnePlus; ONEPLUS A3010; OnePlus3T; qcom; en_US; 123444975)',
    'X-IG-App-ID': '936619743392459',
    Accept: '*/*',
  };

  for (const tag of hashtags) {
    try {
      const url = `https://i.instagram.com/api/v1/tags/${encodeURIComponent(tag)}/sections/?count=20&surface=explore`;
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });

      if (!res.ok) {
        // 400/401/403/429 = Instagram blocking unauthenticated access — stop all further tries
        if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 429) {
          console.warn(`[Instagram] Mobile API blocked (${res.status}) — skipping all hashtags`);
          break;
        }
        console.warn(`[Instagram] Mobile API ${tag}: ${res.status}`);
        continue;
      }

      const data = await res.json() as IGMobileTagResponse;
      const medias = (data.sections ?? [])
        .flatMap(s => s.layout_content?.medias ?? [])
        .map(sm => sm.media)
        .filter((m): m is IGMobileMedia => !!m);

      const posts = medias.map(igMediaToPost).filter((p): p is InstagramPost => p !== null);
      allPosts.push(...posts);
      console.log(`[Instagram] Mobile API #${tag} → ${posts.length} posts`);

      // Small delay to avoid rate limiting between hashtag requests
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      console.warn(`[Instagram] Mobile API #${tag} failed:`, (e as Error).message);
    }
  }

  console.log(`[Instagram] Mobile API total: ${allPosts.length} posts from ${hashtags.length} hashtags`);
  return allPosts;
}

// ─── Apify helper ─────────────────────────────────────────────────────────────

async function runInstagramScraper(
  token: string,
  input: Record<string, unknown>,
  label: string,
  reservedItems: number,
  minItems = 10,
): Promise<InstagramPost[]> {
  const reservation = await reserveCall('apify/instagram-scraper', reservedItems, minItems);
  if (!reservation) {
    console.warn(`[Instagram] ${label}: Apify budget exhausted`);
    return [];
  }

  console.log(`[Instagram] ${label}: starting async run (budget reserved: $${reservation.reservedUsd.toFixed(3)})...`);

  // Use node:https (not global fetch) to avoid undici's 10-second TCP connect timeout.
  let runId: string;
  try {
    const { status: httpStatus, json: startData } = await nodeHttpsPost(
      `${APIFY_BASE}/acts/apify~instagram-scraper/runs`,
      token,
      { ...input, maxRequestRetries: 2 },
    );
    if (httpStatus < 200 || httpStatus >= 300) {
      console.error(`[Instagram] ${label} start error ${httpStatus}`);
      await releaseReservation(reservation);
      return [];
    }
    runId = (startData as { data?: { id?: string } }).data?.id ?? '';
    if (!runId) {
      console.error(`[Instagram] ${label}: no run ID returned`);
      await releaseReservation(reservation);
      return [];
    }
    console.log(`[Instagram] ${label}: run ${runId} started — polling...`);
  } catch (e) {
    console.error(`[Instagram] ${label} start failed:`, e);
    await releaseReservation(reservation);
    return [];
  }

  // Poll every 10s, up to 8 minutes
  const deadline = Date.now() + 8 * 60 * 1000;
  let status = 'RUNNING';
  while (Date.now() < deadline && (status === 'RUNNING' || status === 'READY')) {
    await new Promise(r => setTimeout(r, 10_000));
    try {
      const { json: statusData } = await nodeHttpsGet(`${APIFY_BASE}/actor-runs/${runId}`, token);
      status = (statusData as { data?: { status?: string } }).data?.status ?? 'RUNNING';
      console.log(`[Instagram] ${label}: run status = ${status}`);
    } catch { /* network hiccup — retry next poll */ }
  }

  if (status !== 'SUCCEEDED') {
    console.error(`[Instagram] ${label}: run ended with status ${status}`);
    await releaseReservation(reservation);
    return [];
  }

  // Fetch dataset results
  let posts: InstagramPost[] = [];
  try {
    const { status: dataStatus, json: dataJson } = await nodeHttpsGet(
      `${APIFY_BASE}/actor-runs/${runId}/dataset/items?format=json&limit=${reservation.safeLimit}`,
      token,
    );
    if (dataStatus < 200 || dataStatus >= 300) {
      console.error(`[Instagram] ${label} dataset fetch error ${dataStatus}`);
      await releaseReservation(reservation);
      return [];
    }
    posts = dataJson as InstagramPost[];
  } catch (e) {
    console.error(`[Instagram] ${label} dataset fetch failed:`, e);
    await releaseReservation(reservation);
    return [];
  }

  await commitActual(reservation, posts.length);
  console.log(`[Instagram] ${label} → ${posts.length} raw posts`);
  return posts;
}

// ─── Google Trends RSS seed ───────────────────────────────────────────────────

async function fetchGoogleTrendsIndia(): Promise<TrendingTopic[]> {
  try {
    const res = await fetch('https://trends.google.com/trending/rss?geo=IN', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.warn(`[Instagram] Google Trends returned ${res.status}`);
      return [];
    }

    const xml = await res.text();
    const itemBlocks = xml.match(/<item>([\s\S]*?)<\/item>/gi) ?? [];
    const topics: TrendingTopic[] = [];

    for (const block of itemBlocks.slice(0, 50)) {
      const titleMatch = block.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/i);
      const title = titleMatch?.[1]
        ?.trim()
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'");
      if (!title || title === 'Daily Search Trends' || title.length < 3) continue;

      const trafficRaw = block.match(/<ht:approx_traffic>(.*?)<\/ht:approx_traffic>/i)?.[1] ?? '';
      let traffic: number | undefined;
      if (trafficRaw) {
        const cleaned = trafficRaw.replace(/\+/g, '').trim();
        if (cleaned.endsWith('M')) traffic = parseFloat(cleaned) * 1_000_000;
        else if (cleaned.endsWith('K')) traffic = parseFloat(cleaned) * 1_000;
        else traffic = parseInt(cleaned.replace(/,/g, ''), 10) || undefined;
      }

      const newsBlocks = block.match(/<ht:news_item>([\s\S]*?)<\/ht:news_item>/gi) ?? [];
      const relatedNews = newsBlocks
        .map(nb =>
          (nb.match(/<ht:news_item_title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/ht:news_item_title>/i)?.[1]?.trim() ?? '')
            .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"'),
        )
        .filter(Boolean);

      let displayName = title;
      if (isNonLatinScript(title)) {
        const eng = relatedNews.find(n => !isNonLatinScript(n) && n.length > 5);
        if (eng) displayName = eng.slice(0, 80);
      }

      const picMatch =
        block.match(/<ht:picture[^>]*>([^<]+)<\/ht:picture>/i) ??
        block.match(/<ht:news_item_picture[^>]*>([^<]+)<\/ht:news_item_picture>/i);
      const rssImageUrl = picMatch?.[1]?.trim() || undefined;

      topics.push({
        name: displayName,
        traffic,
        relatedNews: relatedNews.filter(n => !isNonLatinScript(n)),
        imageUrl: rssImageUrl,
      });
    }

    console.log(`[Instagram] Google Trends India: ${topics.length} topics`);
    return topics;
  } catch (e) {
    console.warn('[Instagram] Google Trends fetch error:', e);
    return [];
  }
}

// ─── Google Trends fallback → moments ─────────────────────────────────────────

async function googleTrendsToMoments(topics: TrendingTopic[]): Promise<Moment[]> {
  if (topics.length === 0) return [];

  const imageUrls: Array<string | undefined> = [];
  for (let i = 0; i < topics.length; i += 10) {
    const batch = topics.slice(i, i + 10);
    const imgs = await Promise.all(
      batch.map(t =>
        t.imageUrl && t.imageUrl.startsWith('http')
          ? Promise.resolve(t.imageUrl)
          : fetchTopicImage(t.name),
      ),
    );
    imageUrls.push(...imgs);
  }

  const moments: Moment[] = [];
  for (let i = 0; i < topics.length; i++) {
    const { name, traffic, relatedNews } = topics[i];
    let score = 68;
    if (traffic) score = Math.min(96, 62 + Math.floor(Math.log10(traffic + 1) * 8));

    // Use the related news headline as description — actual minimal useful context
    const newsHeadline = relatedNews?.[0] ?? '';
    let description = newsHeadline ? newsHeadline.slice(0, 150) : `A popular trending topic right now.`;

    const m = classifyTrend({
      name: name.slice(0, 100),
      description,
      imageUrl: imageUrls[i],
      trendingScore: score,
      platform: 'Instagram',
    });
    if (m) moments.push(m);
  }

  console.log(`[Instagram] Google Trends fallback → ${moments.length} moments`);
  return moments;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function fetchInstagramTrends(): Promise<Moment[]> {
  const token = process.env.APIFY_TOKEN;

  if (token) {
    // ── Path 1: Apify directUrls hashtag scraping ──────────────────────────
    // Uses directUrls pointing to hashtag explore pages — searchHashtags is
    // deprecated in current actor versions and returns near-zero results.
    const scrapeHashtags = SEED_HASHTAGS; // momentmarketing, moment, marketingmentor, kitkat, advertising, outdooradvertising, marketing, creativeads
    const directUrls = scrapeHashtags.map(h => `https://www.instagram.com/explore/tags/${encodeURIComponent(h)}/`);

    const hashtagPosts = await runInstagramScraper(
      token,
      {
        directUrls,
        resultsType: 'posts',
        resultsLimit: 30,           // 30 posts per hashtag
        proxy: { useApifyProxy: true },
      },
      `hashtag-explore (#momentmarketing #moment #marketing #advertising …)`,
      scrapeHashtags.length * 30,   // 8 hashtags × 30 posts = 240 max
      5,
    );

    if (hashtagPosts.length > 0) {
      const moments = await postsToMoments(hashtagPosts);
      if (moments.length > 0) {
        console.log(`[Instagram] ✓ ${moments.length} moments via Apify hashtag explore`);
        return moments;
      }
      console.warn('[Instagram] Apify hashtag explore returned 0 moments after filtering');
    }
  }

  // ── Path 2: Instagram mobile web API (no APIFY_TOKEN needed) ───────────────
  // Uses the same endpoint Instagram's Android app calls for hashtag explore.
  // Priority hashtags: moment marketing specific first, then India trending.
  const mobileHashtags = SEED_HASHTAGS;
  const mobilePosts = await fetchInstagramViaWebAPI(mobileHashtags);
  if (mobilePosts.length > 0) {
    const moments = await postsToMoments(mobilePosts);
    if (moments.length > 0) {
      console.log(`[Instagram] ✓ ${moments.length} moments via mobile web API`);
      return moments;
    }
    console.warn('[Instagram] Mobile web API returned posts but 0 moments after filtering');
  }

  // ── Path 3: Google Trends fallback ─────────────────────────────────────────
  // Free, always available, guaranteed results when Google Trends is up.
  const topics = await fetchGoogleTrendsIndia();
  const moments = await googleTrendsToMoments(topics);
  if (moments.length > 0) {
    console.log(`[Instagram] ✓ ${moments.length} moments via Google Trends fallback`);
    return moments;
  }

  // ── Path 4: Emergency seed fallback ─────────────────────────────────────────
  // If everything else failed (budget gone + Google Trends down), produce moments
  // from the hardcoded seed hashtags so the Instagram section is never empty.
  console.warn('[Instagram] All paths returned 0 — using emergency seed fallback');
  const now = new Date().toISOString();
  const seedMoments: Moment[] = [];
  const seedBatch = SEED_HASHTAGS.slice(0, 10);
  const seedImages = await Promise.all(seedBatch.map(h => fetchTopicImage(h)));
  for (let i = 0; i < seedBatch.length; i++) {
    const hashtag = seedBatch[i];
    const m = classifyTrend({
      name: `#${hashtag}`,
      description: `A trending topic right now on Instagram.`,
      imageUrl: seedImages[i],
      trendingScore: 65,
      platform: 'Instagram',
      originDate: now,
    });
    if (m) seedMoments.push(m);
  }
  console.log(`[Instagram] ✓ ${seedMoments.length} moments via seed fallback`);
  return seedMoments;
}
