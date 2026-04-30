import type { Moment } from '@/types';
import { classifyTrend } from './classifier';
import { reserveCall, commitActual, releaseReservation } from '@/server/db/apify-spend';
import { fetchTopicImage } from './image-utils';

// ─── Facebook scraper ─────────────────────────────────────────────────────────
// Primary:  Apify apify/facebook-pages-scraper — scrapes recent posts from top Indian pages
// Fallback: 15 Indian news RSS feeds (free, updates every 15–30 min)

const APIFY_BASE = 'https://api.apify.com/v2';
const FRESHNESS_WINDOW_MS = 48 * 60 * 60 * 1000;
const RSS_FRESHNESS_WINDOW_MS = 72 * 60 * 60 * 1000;

// Top 15 high-reach Indian pages for trending content
const TRENDING_PAGES = [
  'https://www.facebook.com/ndtv',
  'https://www.facebook.com/TimesofIndia',
  'https://www.facebook.com/india.today',
  'https://www.facebook.com/IPL',
  'https://www.facebook.com/ESPNcricinfo',
  'https://www.facebook.com/bollywoodhungama',
  'https://www.facebook.com/aajtak',
  'https://www.facebook.com/zeenews',
  'https://www.facebook.com/pinkvilla',
  'https://www.facebook.com/SportsKeedaOfficial',
  'https://www.facebook.com/economictimes',
  'https://www.facebook.com/LiveHindustan',
  'https://www.facebook.com/narendramodi',
  'https://www.facebook.com/thehindu',
  'https://www.facebook.com/HindustanTimes',
];

// ─── RSS sources (fallback) ───────────────────────────────────────────────────

const RSS_SOURCES = [
  { url: 'https://feeds.feedburner.com/ndtvnews-top-stories', source: 'NDTV', tier: 1 },
  { url: 'https://timesofindia.indiatimes.com/rssfeedstopstories.cms', source: 'Times of India', tier: 1 },
  { url: 'https://www.hindustantimes.com/feeds/rss/topnews/rssfeed.xml', source: 'Hindustan Times', tier: 1 },
  { url: 'https://www.indiatoday.in/rss/home', source: 'India Today', tier: 1 },
  { url: 'https://www.thehindu.com/news/national/feeder/default.rss', source: 'The Hindu', tier: 2 },
  { url: 'https://indianexpress.com/feed/', source: 'Indian Express', tier: 2 },
  { url: 'https://zeenews.india.com/rss/india-national-news.xml', source: 'Zee News', tier: 2 },
  { url: 'https://www.firstpost.com/rss', source: 'Firstpost', tier: 2 },
  { url: 'https://www.pinkvilla.com/rss.xml', source: 'Pinkvilla', tier: 2 },
  { url: 'https://www.bollywoodhungama.com/rss/news.xml', source: 'Bollywood Hungama', tier: 2 },
  { url: 'https://rss.espncricinfo.com/rss/content/story/feeds/0.xml', source: 'ESPNcricinfo', tier: 2 },
  { url: 'https://feeds.feedburner.com/gadgets360-latest', source: 'Gadgets360', tier: 2 },
  { url: 'https://www.business-standard.com/rss/home_page_top_stories.rss', source: 'Business Standard', tier: 2 },
  { url: 'https://economictimes.indiatimes.com/rssfeedstopstories.cms', source: 'Economic Times', tier: 1 },
  { url: 'https://www.livemint.com/rss/news', source: 'Livemint', tier: 2 },
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface ApifyFacebookPost {
  postId?: string;
  feedbackId?: string;
  text?: string;
  message?: string;
  time?: string;
  timestamp?: string;
  pageName?: string;
  pageId?: string;
  images?: string[];
  thumbnails?: string[];
  media?: Array<{ thumbnail?: string; photo_image?: { uri?: string } }>;
  likesCount?: number;
  reactionsCount?: number;
  reactions?: Record<string, number> | number;
  commentsCount?: number;
  sharesCount?: number;
}

// Some actors return page objects that contain a `posts` array
interface ApifyFacebookPageResult {
  title?: string;
  name?: string;
  posts?: ApifyFacebookPost[];
  // Also handle flat post format (actor may return posts directly)
  postId?: string;
  text?: string;
  time?: string;
  likesCount?: number;
}

interface RSSItem {
  title: string;
  description: string;
  imageUrl?: string;
  source: string;
  tier: number;
  pubDate?: string;
  pubTimestamp?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isFresh(iso: string | number | undefined, windowMs = FRESHNESS_WINDOW_MS): boolean {
  if (!iso) return false;
  const t = typeof iso === 'number' ? iso * 1000 : new Date(iso).getTime();
  if (isNaN(t)) return false;
  return Date.now() - t <= windowMs;
}

function countReactions(post: ApifyFacebookPost): number {
  if (typeof post.reactionsCount === 'number') return post.reactionsCount;
  if (typeof post.likesCount === 'number') return post.likesCount;
  if (typeof post.reactions === 'number') return post.reactions;
  if (post.reactions && typeof post.reactions === 'object') {
    return Object.values(post.reactions).reduce((sum, v) => sum + (v ?? 0), 0);
  }
  return 0;
}

function extractFacebookImage(post: ApifyFacebookPost): string | undefined {
  if (post.images?.[0]) return post.images[0];
  if (post.thumbnails?.[0]) return post.thumbnails[0];
  if (post.media?.[0]) {
    const m = post.media[0];
    return m.photo_image?.uri ?? m.thumbnail;
  }
  return undefined;
}

// ─── Apify facebook-pages-scraper ─────────────────────────────────────────────

async function fetchViaApify(token: string): Promise<Moment[]> {
  const reservation = await reserveCall('apify/facebook-pages-scraper', 30, 10);
  if (!reservation) {
    console.warn('[Facebook] Apify budget exhausted — using RSS fallback');
    return [];
  }

  console.log(`[Facebook] Apify facebook-pages-scraper (${TRENDING_PAGES.length} pages, limit=${reservation.safeLimit})...`);

  let rawResults: ApifyFacebookPageResult[] = [];
  try {
    const res = await fetch(
      `${APIFY_BASE}/acts/apify~facebook-pages-scraper/run-sync-get-dataset-items?timeout=300&format=json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          startUrls: TRENDING_PAGES.map(url => ({ url })),
          maxPosts: reservation.safeLimit,
          maxPostComments: 0,
          maxReviews: 0,
          scrapeAbout: false,
          scrapeReviews: false,
        }),
        signal: AbortSignal.timeout(310_000),
      },
    );

    if (!res.ok) {
      console.error(`[Facebook] Apify error ${res.status}:`, (await res.text()).slice(0, 300));
      await releaseReservation(reservation);
      return [];
    }

    rawResults = (await res.json()) as ApifyFacebookPageResult[];
  } catch (e) {
    console.error('[Facebook] Apify fetch failed:', e);
    await releaseReservation(reservation);
    return [];
  }

  // Normalise: some actors return page-level objects with nested `posts`,
  // others return flat post arrays directly.
  const posts: ApifyFacebookPost[] = [];
  for (const item of rawResults) {
    if (Array.isArray(item.posts)) {
      posts.push(...item.posts);
    } else if (item.postId ?? item.text) {
      posts.push(item as unknown as ApifyFacebookPost);
    }
  }

  await commitActual(reservation, posts.length);

  if (posts.length === 0) {
    console.warn('[Facebook] Apify returned 0 posts');
    return [];
  }

  // Filter: fresh + has text
  const seen = new Set<string>();
  const fresh = posts.filter(p => {
    const text = p.text ?? p.message;
    if (!text) return false;
    if (!isFresh(p.time ?? p.timestamp)) return false;
    const key = p.postId ?? p.feedbackId ?? text.slice(0, 50);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`[Facebook] Apify → ${fresh.length} fresh posts from ${posts.length} scraped`);

  // Resolve images in parallel: post image → fetchTopicImage(postTitle)
  const imageUrls = await Promise.all(
    fresh.map(post => {
      const direct = extractFacebookImage(post);
      const title = (post.text ?? post.message ?? '').slice(0, 60);
      return direct ? Promise.resolve(direct) : fetchTopicImage(title);
    }),
  );

  return fresh
    .map((post, idx) => {
      const reactions = countReactions(post);
      const comments = post.commentsCount ?? 0;
      const shares = post.sharesCount ?? 0;
      const engagement = reactions + comments * 3 + shares * 5;
      const score = Math.min(100, 55 + Math.floor(Math.log10(engagement + 1) * 8));
      const text = ((post.text ?? post.message) ?? '').replace(/\n+/g, ' ').trim();
      const pageName = post.pageName ?? 'Facebook';

      // Use the post body as description — the actual content tells more than metric labels
      const body = text.slice(0, 150);
      const description = body.length > 10
        ? `${body}${text.length > 150 ? '…' : ''}`
        : `${pageName} • ${reactions.toLocaleString()} reactions`;

      return classifyTrend({
        name: text.slice(0, 100) || 'Facebook Trending Post',
        description,
        imageUrl: imageUrls[idx],
        trendingScore: score,
        platform: 'Facebook',
        originDate: post.time ?? post.timestamp,
      });
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);
}

// ─── RSS fallback ─────────────────────────────────────────────────────────────

function extractRSSTag(xml: string, tag: string): string {
  const patterns = [
    new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i'),
    new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'),
  ];
  for (const pat of patterns) {
    const m = xml.match(pat);
    if (m?.[1]) return m[1].trim().replace(/<[^>]+>/g, '').trim();
  }
  return '';
}

function extractRSSImageUrl(itemBlock: string): string | undefined {
  const patterns = [
    /media:content[^>]*url="([^"]+)"/i,
    /media:thumbnail[^>]*url="([^"]+)"/i,
    /<enclosure[^>]*url="([^"]+)"[^>]*type="image/i,
    /url="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)(?:\?[^"]*)?)"/i,
    /<img[^>]*src="([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i,
    /https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp)(?:\?[^\s"'<>]*)?/i,
  ];
  for (const pat of patterns) {
    const m = itemBlock.match(pat);
    const url = m?.[1] ?? m?.[0];
    if (url && url.startsWith('http') && !url.includes('logo') && !url.includes('icon')) {
      return url;
    }
  }
  return undefined;
}

async function fetchRSSSource(
  rssUrl: string,
  sourceName: string,
  tier: number,
): Promise<RSSItem[]> {
  try {
    const res = await fetch(rssUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MomentMarketing/2.0)',
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return [];

    const xml = await res.text();
    const itemBlocks = xml.match(/<item>([\s\S]*?)<\/item>/gi) ?? [];

    return itemBlocks.slice(0, 20).map(block => {
      const title = extractRSSTag(block, 'title');
      const desc =
        extractRSSTag(block, 'description') ||
        extractRSSTag(block, 'summary') ||
        extractRSSTag(block, 'content');
      const pubDateStr =
        extractRSSTag(block, 'pubDate') ||
        extractRSSTag(block, 'dc:date') ||
        extractRSSTag(block, 'published');
      const imageUrl = extractRSSImageUrl(block);

      let pubTimestamp: number | undefined;
      if (pubDateStr) {
        const t = new Date(pubDateStr).getTime();
        if (!isNaN(t)) pubTimestamp = t;
      }

      return {
        title: title
          .replace(/&amp;/g, '&')
          .replace(/&#39;/g, "'")
          .replace(/&quot;/g, '"') || `${sourceName} Update`,
        description: desc.slice(0, 400).replace(/&amp;/g, '&').replace(/&#39;/g, "'"),
        imageUrl,
        source: sourceName,
        tier,
        pubDate: pubDateStr || undefined,
        pubTimestamp,
      };
    }).filter(item => item.title.length > 5);
  } catch {
    return [];
  }
}

function scoreRSSItem(item: RSSItem): number {
  let score = 60;
  if (item.tier === 1) score += 12;
  const combined = (item.title + ' ' + item.description).toLowerCase();
  if (/cricket|ipl|match|score|win/.test(combined)) score += 10;
  if (/bollywood|film|movie|actor|actress/.test(combined)) score += 9;
  if (/viral|trending|massive|shocking|breaking/.test(combined)) score += 6;
  if (/budget|economy|sensex|market|rbi/.test(combined)) score += 7;
  if (/election|politic|minister|modi/.test(combined)) score += 5;
  if (/tech|ai|startup|isro|phone/.test(combined)) score += 5;
  if (item.pubTimestamp) {
    const ageHours = (Date.now() - item.pubTimestamp) / 3_600_000;
    if (ageHours < 1) score += 20;
    else if (ageHours < 3) score += 15;
    else if (ageHours < 6) score += 10;
    else if (ageHours < 12) score += 5;
    else if (ageHours > 48) score -= 15;
  }
  return Math.min(97, Math.max(40, score));
}

async function fetchViaRSS(): Promise<Moment[]> {
  console.log('[Facebook] Using RSS fallback (15 Indian news sources)...');

  const results = await Promise.allSettled(
    RSS_SOURCES.map(s =>
      fetchRSSSource(s.url, s.source, s.tier).then(items => ({ items, source: s.source })),
    ),
  );

  const allItems: RSSItem[] = [];
  let sourcesFetched = 0;
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.items.length > 0) {
      allItems.push(...r.value.items);
      sourcesFetched++;
    }
  }

  // Freshness gate + dedupe
  const seen = new Set<string>();
  const unique = allItems
    .filter(item => {
      if (!isFresh(item.pubTimestamp, RSS_FRESHNESS_WINDOW_MS)) return false;
      const key = item.title
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, '')
        .trim()
        .slice(0, 60);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const aDelta = a.pubTimestamp ? Date.now() - a.pubTimestamp : Infinity;
      const bDelta = b.pubTimestamp ? Date.now() - b.pubTimestamp : Infinity;
      return aDelta - bDelta;
    });

  console.log(`[Facebook] RSS → ${unique.length} stories from ${sourcesFetched}/${RSS_SOURCES.length} sources`);

  // Resolve images: RSS image first, then fetchTopicImage
  const imageUrls = await Promise.all(
    unique.slice(0, 60).map(item =>
      item.imageUrl && item.imageUrl.startsWith('http')
        ? Promise.resolve(item.imageUrl)
        : fetchTopicImage(item.title),
    ),
  );

  return unique.slice(0, 60)
    .map((item, idx) => {
      const score = scoreRSSItem(item);
      const freshnessLabel = item.pubTimestamp
        ? (() => {
            const ageMin = Math.round((Date.now() - item.pubTimestamp!) / 60_000);
            if (ageMin < 60) return `${ageMin}m ago`;
            const ageHr = Math.round(ageMin / 60);
            return ageHr < 24 ? `${ageHr}h ago` : `${Math.round(ageHr / 24)}d ago`;
          })()
        : 'Today';

      return classifyTrend({
        name: item.title.slice(0, 100),
        description: `${item.source} • ${freshnessLabel} • ${item.description.slice(0, 200) || item.title}`,
        imageUrl: imageUrls[idx],
        trendingScore: score,
        platform: 'Facebook',
        originDate:
          item.pubDate ??
          (item.pubTimestamp ? new Date(item.pubTimestamp).toISOString() : undefined),
      });
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function fetchFacebookTrends(): Promise<Moment[]> {
  const token = process.env.APIFY_TOKEN;

  if (token) {
    try {
      const apifyResults = await fetchViaApify(token);
      if (apifyResults.length > 0) return apifyResults;
      console.warn('[Facebook] Apify returned 0 — falling back to RSS');
    } catch (e) {
      console.error('[Facebook] Apify error:', e);
    }
  }

  return fetchViaRSS();
}
