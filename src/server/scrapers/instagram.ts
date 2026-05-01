import type { Moment } from '@/types';
import { classifyTrend } from './classifier';
import { reserveCall, commitActual, releaseReservation } from '@/server/db/apify-spend';
import { fetchTopicImage } from './image-utils';

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

// Seed hashtags — used when Google Trends returns nothing or all non-Latin.
// These always have fresh posts on Instagram.
const SEED_HASHTAGS = [
  'ipl', 'ipl2026', 'cricket', 'bollywood', 'india', 'trending',
  'viral', 'reels', 'indianews', 'entertainment', 'music', 'fashion',
  'food', 'travel', 'sports', 'technology',
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

  return classifyTrend({
    name: (caption || `@${owner} on Instagram`).slice(0, 100),
    description,
    imageUrl,
    trendingScore: score,
    platform: 'Instagram',
    originDate: typeof ts === 'number'
      ? new Date(ts > 1e10 ? ts : ts * 1000).toISOString()
      : (ts as string | undefined),
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

  console.log(`[Instagram] ${label}: running (budget reserved: $${reservation.reservedUsd.toFixed(3)})...`);

  let posts: InstagramPost[] = [];
  try {
    const res = await fetch(
      `${APIFY_BASE}/acts/apify~instagram-scraper/run-sync-get-dataset-items?timeout=300&format=json`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, maxRequestRetries: 3 }),
        signal: AbortSignal.timeout(310_000),
      },
    );

    if (!res.ok) {
      const text = await res.text();
      console.error(`[Instagram] ${label} error ${res.status}:`, text.slice(0, 300));
      await releaseReservation(reservation);
      return [];
    }

    posts = (await res.json()) as InstagramPost[];
  } catch (e) {
    console.error(`[Instagram] ${label} failed:`, e);
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

  // Always fetch Google Trends first — it's free and seeds hashtags + fallback
  const topics = await fetchGoogleTrendsIndia();

  // Build final hashtag list: Google Trends topics + always-on seeds, deduped
  const gtHashtags = topics
    .map(t => toHashtag(t.name))
    .filter(h => h.length >= 2);
  const allHashtags = [...new Set([...gtHashtags, ...SEED_HASHTAGS])];
  console.log(`[Instagram] ${allHashtags.length} hashtags ready (${gtHashtags.length} from trends + ${SEED_HASHTAGS.length} seeds)`);

  if (token) {
    // ── Path 1: Hashtag search ──────────────────────────────────────────────
    // Use top 20 hashtags, 25 posts each → up to 500 posts
    // This deep pool allows our virality algorithm to sift past the 
    // celebrity posts and find the true breakout organic trends.
    const top20 = allHashtags.slice(0, 20);
    const hashtagPosts = await runInstagramScraper(
      token,
      {
        searchHashtags: top20,
        resultsType: 'posts',
        resultsLimit: 25,        // 25 posts per hashtag
      },
      'hashtag-search',
      top20.length * 25,         // reserve for up to 500 posts
      5,                         // min viable = 5 posts
    );

    if (hashtagPosts.length > 0) {
      const moments = await postsToMoments(hashtagPosts);
      if (moments.length > 0) {
        console.log(`[Instagram] ✓ ${moments.length} moments via hashtag search`);
        return moments;
      }
      console.warn('[Instagram] Hashtag search returned 0 — using Google Trends fallback');
    }
  } else {
    console.warn('[Instagram] APIFY_TOKEN not set — using Google Trends fallback');
  }

  // ── Path 3: Google Trends fallback ─────────────────────────────────────────
  // Free, always available, guaranteed results when Google Trends is up.
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
