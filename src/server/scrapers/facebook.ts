import type { Moment } from '@/types';
import { classifyTrend } from './classifier';
import { planCall, recordSpend } from '@/server/db/apify-spend';

// ─── Apify Config ────────────────────────────────────────────────────────────
const APIFY_BASE = 'https://api.apify.com/v2';
const VIRAL_ENGAGEMENT_THRESHOLD = 1_500;
// Only include Facebook posts < 48h old; RSS items < 72h (news can lag).
const FRESHNESS_WINDOW_MS = 48 * 60 * 60 * 1000;
const RSS_FRESHNESS_WINDOW_MS = 72 * 60 * 60 * 1000;
// Cost-safe default: 50 items × $5/1K ≈ $0.25 / run.
const DEFAULT_RESULTS_LIMIT = 50;

// Top 8 high-reach Indian pages (trimmed from 15 for cost control)
const TRENDING_PAGES = [
  'https://www.facebook.com/ndtv',
  'https://www.facebook.com/TimesofIndia',
  'https://www.facebook.com/india.today',
  'https://www.facebook.com/IPL',
  'https://www.facebook.com/ESPNcricinfo',
  'https://www.facebook.com/bollywoodhungama',
  'https://www.facebook.com/aajtak',
  'https://www.facebook.com/pinkvilla',
];

function isFresh(iso: string | number | undefined, windowMs = FRESHNESS_WINDOW_MS): boolean {
  if (!iso) return false;
  const t = typeof iso === 'number' ? iso * 1000 : new Date(iso).getTime();
  if (isNaN(t)) return false;
  return Date.now() - t <= windowMs;
}

// ─── RSS sources: Indian news + entertainment (free, live, no auth needed) ───
// These RSS feeds update every 15–30 minutes with real content.
const RSS_SOURCES = [
  // Tier 1 — highest reach/engagement on Facebook
  { url: 'https://feeds.feedburner.com/ndtvnews-top-stories', source: 'NDTV', tier: 1 },
  { url: 'https://timesofindia.indiatimes.com/rssfeedstopstories.cms', source: 'Times of India', tier: 1 },
  { url: 'https://www.hindustantimes.com/feeds/rss/topnews/rssfeed.xml', source: 'Hindustan Times', tier: 1 },
  { url: 'https://www.indiatoday.in/rss/home', source: 'India Today', tier: 1 },
  // Tier 2 — strong reach
  { url: 'https://www.thehindu.com/news/national/feeder/default.rss', source: 'The Hindu', tier: 2 },
  { url: 'https://indianexpress.com/feed/', source: 'Indian Express', tier: 2 },
  { url: 'https://zeenews.india.com/rss/india-national-news.xml', source: 'Zee News', tier: 2 },
  { url: 'https://www.firstpost.com/rss', source: 'Firstpost', tier: 2 },
  // Entertainment & Sports
  { url: 'https://www.pinkvilla.com/rss.xml', source: 'Pinkvilla', tier: 2 },
  { url: 'https://www.bollywoodhungama.com/rss/news.xml', source: 'Bollywood Hungama', tier: 2 },
  { url: 'https://rss.espncricinfo.com/rss/content/story/feeds/0.xml', source: 'ESPNcricinfo', tier: 2 },
  { url: 'https://feeds.feedburner.com/gadgets360-latest', source: 'Gadgets360', tier: 2 },
  // Real-time news
  { url: 'https://www.business-standard.com/rss/home_page_top_stories.rss', source: 'Business Standard', tier: 2 },
  { url: 'https://economictimes.indiatimes.com/rssfeedstopstories.cms', source: 'Economic Times', tier: 1 },
  { url: 'https://www.livemint.com/rss/news', source: 'Livemint', tier: 2 },
];

interface FacebookPost {
  postId?: string;
  url?: string;
  text?: string;
  message_text?: string;
  time?: string;
  timestamp?: string;
  user?: { name?: string; id?: string };
  pageName?: string;
  media?: Array<{ thumbnail?: string; photo_image?: { uri?: string } }>;
  images?: string[];
  thumbnails?: string[];
  likesCount?: number;
  reactionsCount?: number;
  reactions?: Record<string, number> | number;
  commentsCount?: number;
  sharesCount?: number;
  feedbackId?: string;
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

function extractImage(post: FacebookPost): string | undefined {
  if (post.images?.[0]) return post.images[0];
  if (post.thumbnails?.[0]) return post.thumbnails[0];
  if (post.media?.[0]) {
    const m = post.media[0];
    return m.photo_image?.uri ?? m.thumbnail;
  }
  return undefined;
}

function countReactions(post: FacebookPost): number {
  if (typeof post.reactionsCount === 'number') return post.reactionsCount;
  if (typeof post.likesCount === 'number') return post.likesCount;
  if (typeof post.reactions === 'number') return post.reactions;
  if (post.reactions && typeof post.reactions === 'object') {
    return Object.values(post.reactions).reduce((sum, v) => sum + (v ?? 0), 0);
  }
  return 0;
}

// ─── RSS parsing ──────────────────────────────────────────────────────────────

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
    // Handle og:image or any image url in the block
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
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];

    const xml = await res.text();
    const itemBlocks = xml.match(/<item>([\s\S]*?)<\/item>/gi) ?? [];

    return itemBlocks.slice(0, 20).map(block => {
      const title = extractRSSTag(block, 'title');
      const desc = extractRSSTag(block, 'description')
        || extractRSSTag(block, 'summary')
        || extractRSSTag(block, 'content');
      const pubDateStr = extractRSSTag(block, 'pubDate')
        || extractRSSTag(block, 'dc:date')
        || extractRSSTag(block, 'published');
      const imageUrl = extractRSSImageUrl(block);

      let pubTimestamp: number | undefined;
      if (pubDateStr) {
        const t = new Date(pubDateStr).getTime();
        if (!isNaN(t)) pubTimestamp = t;
      }

      return {
        title: title.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"') || `${sourceName} Update`,
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

// ─── Smart image fallback by content category ─────────────────────────────────
const NEWS_FALLBACK_IMAGES: Record<string, string> = {
  sports:      'https://images.unsplash.com/photo-1540747913346-19212a4b423f?w=800&auto=format&fit=crop',
  cricket:     'https://images.unsplash.com/photo-1531415074968-036ba1b575da?w=800&auto=format&fit=crop',
  bollywood:   'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=800&auto=format&fit=crop',
  tech:        'https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=800&auto=format&fit=crop',
  finance:     'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=800&auto=format&fit=crop',
  travel:      'https://images.unsplash.com/photo-1524492412937-b28074a5d7da?w=800&auto=format&fit=crop',
  food:        'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800&auto=format&fit=crop',
  politics:    'https://images.unsplash.com/photo-1529107386315-e1a2ed48a620?w=800&auto=format&fit=crop',
  health:      'https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?w=800&auto=format&fit=crop',
  fashion:     'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&auto=format&fit=crop',
  education:   'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=800&auto=format&fit=crop',
  environment: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=800&auto=format&fit=crop',
  default:     'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=800&auto=format&fit=crop',
};

function getNewsFallbackImage(title: string, description: string): string {
  const t = (title + ' ' + description).toLowerCase();
  if (/cricket|ipl|bcci|test match|t20|odi|wpl/.test(t)) return NEWS_FALLBACK_IMAGES.cricket;
  if (/bollywood|film|movie|actor|actress|celebrity|ott|netflix|prime video/.test(t)) return NEWS_FALLBACK_IMAGES.bollywood;
  if (/tech|ai|artificial intelligence|startup|gadget|phone|app|iphone|android|isro/.test(t)) return NEWS_FALLBACK_IMAGES.tech;
  if (/stock|market|sensex|nifty|economy|budget|rbi|finance|investment|crypto/.test(t)) return NEWS_FALLBACK_IMAGES.finance;
  if (/travel|tourism|destination|hill station|beach|pilgrimage|holiday/.test(t)) return NEWS_FALLBACK_IMAGES.travel;
  if (/food|recipe|restaurant|biryani|street food|cuisine/.test(t)) return NEWS_FALLBACK_IMAGES.food;
  if (/politic|election|minister|government|bjp|congress|modi|parliament/.test(t)) return NEWS_FALLBACK_IMAGES.politics;
  if (/health|fitness|hospital|medical|doctor|vaccine|covid|yoga|wellness/.test(t)) return NEWS_FALLBACK_IMAGES.health;
  if (/fashion|style|outfit|designer|runway|trend/.test(t)) return NEWS_FALLBACK_IMAGES.fashion;
  if (/educat|school|college|exam|university|upsc|jee|neet/.test(t)) return NEWS_FALLBACK_IMAGES.education;
  if (/environment|climate|nature|forest|flood|weather/.test(t)) return NEWS_FALLBACK_IMAGES.environment;
  if (/sport|football|tennis|hockey|badminton|kabaddi|fifa/.test(t)) return NEWS_FALLBACK_IMAGES.sports;
  return NEWS_FALLBACK_IMAGES.default;
}

// Score RSS items by freshness, tier, and content signals
function scoreRSSItem(item: RSSItem): number {
  let score = 60;

  // Tier boost: Tier 1 sources (NDTV, TOI, ET, India Today) get more weight
  if (item.tier === 1) score += 12;

  // Content category boosts (these perform best on Facebook in India)
  const combined = (item.title + ' ' + item.description).toLowerCase();
  if (/cricket|ipl|match|score|win/.test(combined)) score += 10;
  if (/bollywood|film|movie|actor|actress/.test(combined)) score += 9;
  if (/viral|trending|massive|shocking|breaking/.test(combined)) score += 6;
  if (/budget|economy|sensex|market|rbi/.test(combined)) score += 7;
  if (/election|politic|minister|modi/.test(combined)) score += 5;
  if (/tech|ai|startup|isro|phone/.test(combined)) score += 5;

  // Freshness is the most important signal for Facebook engagement
  if (item.pubTimestamp) {
    const ageMs = Date.now() - item.pubTimestamp;
    const ageHours = ageMs / (1000 * 60 * 60);
    if (ageHours < 1) score += 20;       // Breaking: < 1 hour old
    else if (ageHours < 3) score += 15;  // Very fresh: < 3 hours
    else if (ageHours < 6) score += 10;  // Fresh: < 6 hours
    else if (ageHours < 12) score += 5;  // Same day
    else if (ageHours > 48) score -= 15; // Penalise old content
  }

  return Math.min(97, Math.max(40, score));
}

// ─── Apify primary scraper ────────────────────────────────────────────────────

async function fetchViaApify(token: string): Promise<Moment[]> {
  // Daily spend gate — skip Apify entirely if remaining budget is too low.
  const safeLimit = planCall('apify/facebook-posts-scraper', DEFAULT_RESULTS_LIMIT, 20);
  if (safeLimit === null) {
    console.warn('[Facebook] Daily Apify budget exhausted — falling back to RSS');
    return [];
  }

  console.log(`[Facebook] Apify: live scrape via run-sync-get-dataset-items (resultsLimit=${safeLimit}) ...`);

  const res = await fetch(
    `${APIFY_BASE}/acts/apify~facebook-posts-scraper/run-sync-get-dataset-items?timeout=300&format=json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        startUrls: TRENDING_PAGES.map(url => ({ url })),
        resultsLimit: safeLimit,
      }),
      signal: AbortSignal.timeout(310_000),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    console.error(`[Facebook] Apify run error ${res.status}:`, text.slice(0, 300));
    return [];
  }

  const posts = (await res.json()) as FacebookPost[];
  // Record actual spend
  recordSpend('apify/facebook-posts-scraper', posts.length);
  if (posts.length === 0) return [];

  const seen = new Set<string>();
  const viral = posts
    .filter(p => {
      const text = p.text ?? p.message_text;
      if (!text) return false;
      // Freshness — < 48h old only
      if (!isFresh(p.time ?? p.timestamp)) return false;
      const reactions = countReactions(p);
      const comments = p.commentsCount ?? 0;
      const shares = p.sharesCount ?? 0;
      const engagement = reactions + comments * 3 + shares * 5;
      if (engagement < VIRAL_ENGAGEMENT_THRESHOLD) return false;
      const key = p.postId ?? p.feedbackId ?? text.slice(0, 50);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const aE = countReactions(a) + (a.commentsCount ?? 0) * 3 + (a.sharesCount ?? 0) * 5;
      const bE = countReactions(b) + (b.commentsCount ?? 0) * 3 + (b.sharesCount ?? 0) * 5;
      return bE - aE;
    });

  console.log(`[Facebook] Apify: ${viral.length} viral posts (≥${VIRAL_ENGAGEMENT_THRESHOLD.toLocaleString()} engagement) from ${posts.length} scraped`);

  return viral.slice(0, 80).map(post => {
    const reactions = countReactions(post);
    const comments = post.commentsCount ?? 0;
    const shares = post.sharesCount ?? 0;
    const engagement = reactions + comments * 3 + shares * 5;
    const score = Math.min(100, 55 + Math.floor(Math.log10(engagement + 1) * 8));
    const text = ((post.text ?? post.message_text) ?? '').replace(/\n+/g, ' ').trim();
    const pageName = post.pageName ?? post.user?.name ?? 'Facebook';
    const imgUrl = extractImage(post);

    return classifyTrend({
      name: text.slice(0, 100) || 'Facebook Trending Post',
      description: `${pageName} • ${reactions.toLocaleString()} reactions • ${comments.toLocaleString()} comments • ${shares.toLocaleString()} shares`,
      imageUrl: imgUrl,
      trendingScore: score,
      platform: 'Facebook',
      originDate: post.time ?? post.timestamp,
    });
  }).filter((m): m is NonNullable<typeof m> => m !== null);
}

// ─── Live RSS fallback ────────────────────────────────────────────────────────
// Fetches real-time content from 15 Indian news & entertainment sources.
// RSS feeds update every 15-30 minutes — this is genuine live data.

async function fetchViaRSS(): Promise<Moment[]> {
  console.log('[Facebook] Fetching live RSS feeds from Indian news sources...');

  const results = await Promise.allSettled(
    RSS_SOURCES.map(s => fetchRSSSource(s.url, s.source, s.tier).then(items => ({ items, source: s.source })))
  );

  const allItems: RSSItem[] = [];
  let sourcesFetched = 0;
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.items.length > 0) {
      allItems.push(...r.value.items);
      sourcesFetched++;
    }
  }

  // Freshness gate (< 72h for RSS) + dedupe by title similarity
  const seen = new Set<string>();
  const unique = allItems.filter(item => {
    if (!isFresh(item.pubTimestamp, RSS_FRESHNESS_WINDOW_MS)) return false;
    const key = item.title.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().slice(0, 60);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort by freshness then score
  unique.sort((a, b) => {
    const aDelta = a.pubTimestamp ? Date.now() - a.pubTimestamp : Infinity;
    const bDelta = b.pubTimestamp ? Date.now() - b.pubTimestamp : Infinity;
    return aDelta - bDelta;
  });

  console.log(`[Facebook] RSS: ${unique.length} unique stories from ${sourcesFetched}/${RSS_SOURCES.length} sources`);

  return unique.slice(0, 60).map(item => {
    const score = scoreRSSItem(item);
    // Always guarantee an image — use RSS image if valid, else smart fallback
    const imageUrl = (item.imageUrl && item.imageUrl.startsWith('http'))
      ? item.imageUrl
      : getNewsFallbackImage(item.title, item.description);

    // Build a rich, informative description
    const freshnessLabel = item.pubTimestamp
      ? (() => {
          const ageMin = Math.round((Date.now() - item.pubTimestamp) / 60000);
          if (ageMin < 60) return `${ageMin}m ago`;
          const ageHr = Math.round(ageMin / 60);
          return ageHr < 24 ? `${ageHr}h ago` : `${Math.round(ageHr / 24)}d ago`;
        })()
      : 'Today';

    return classifyTrend({
      name: item.title.slice(0, 100),
      description: `${item.source} • ${freshnessLabel} • ${item.description.slice(0, 200) || item.title}`,
      imageUrl,
      trendingScore: score,
      platform: 'Facebook',
      originDate: item.pubDate ?? (item.pubTimestamp ? new Date(item.pubTimestamp).toISOString() : undefined),
    });
  }).filter((m): m is NonNullable<typeof m> => m !== null);
}

// ─── Main export ──────────────────────────────────────────────────────────────
export async function fetchFacebookTrends(): Promise<Moment[]> {
  const token = process.env.APIFY_TOKEN;

  if (!token) {
    console.warn('[Facebook] APIFY_TOKEN not set — using live RSS feeds');
    return fetchViaRSS();
  }

  try {
    const apifyMoments = await fetchViaApify(token);
    if (apifyMoments.length > 0) {
      console.log(`[Facebook] ✓ ${apifyMoments.length} live moments from Apify (primary)`);
      return apifyMoments;
    }
    console.warn('[Facebook] Apify returned 0 moments — falling back to RSS');
    return fetchViaRSS();
  } catch (e) {
    console.error('[Facebook] Apify error — falling back to RSS:', e);
    return fetchViaRSS();
  }
}
