import type { Moment } from '@/types';
import { classifyTrend } from './classifier';

// ─── Primary: Apify Facebook Posts Scraper ──────────────────────────────────
const ACTOR_ID = 'apify~facebook-posts-scraper';
const APIFY_BASE = 'https://api.apify.com/v2';
const VIRAL_ENGAGEMENT_THRESHOLD = 10_000;

const TRENDING_PAGES = [
  'https://www.facebook.com/ndtv',
  'https://www.facebook.com/TimesofIndia',
  'https://www.facebook.com/IndianExpress',
  'https://www.facebook.com/HindustanTimes',
  'https://www.facebook.com/bollywoodhungama',
  'https://www.facebook.com/IPL',
  'https://www.facebook.com/cricket',
  'https://www.facebook.com/ESPNcricinfo',
  'https://www.facebook.com/BBCNews',
  'https://www.facebook.com/cnn',
  'https://www.facebook.com/ZeeNews',
  'https://www.facebook.com/aajtak',
  'https://www.facebook.com/india.today',
  'https://www.facebook.com/republicworld',
  'https://www.facebook.com/pinkvilla',
  'https://www.facebook.com/filmfare',
];

// ─── Fallback: RSS feeds from major Indian news & entertainment sources ──────
// These are FREE, public RSS feeds that mirror what goes viral on Facebook
const RSS_SOURCES = [
  { url: 'https://feeds.feedburner.com/ndtvnews-top-stories', source: 'NDTV' },
  { url: 'https://timesofindia.indiatimes.com/rssfeedstopstories.cms', source: 'Times of India' },
  { url: 'https://www.hindustantimes.com/feeds/rss/topnews/rssfeed.xml', source: 'Hindustan Times' },
  { url: 'https://www.thehindu.com/news/national/feeder/default.rss', source: 'The Hindu' },
  { url: 'https://indianexpress.com/feed/', source: 'Indian Express' },
  { url: 'https://www.indiatoday.in/rss/home', source: 'India Today' },
  { url: 'https://zeenews.india.com/rss/india-national-news.xml', source: 'Zee News' },
  { url: 'https://www.pinkvilla.com/rss.xml', source: 'Pinkvilla' },
  { url: 'https://www.bollywoodhungama.com/rss/news.xml', source: 'Bollywood Hungama' },
  { url: 'https://rss.espncricinfo.com/rss/content/story/feeds/0.xml', source: 'ESPNcricinfo' },
  { url: 'https://feeds.feedburner.com/gadgets360-latest', source: 'Gadgets 360' },
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
  pubDate?: string;
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

// ─── RSS parsing helpers ────────────────────────────────────────────────────

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
  // Try media:content, media:thumbnail, enclosure, og:image patterns
  const patterns = [
    /media:content[^>]*url="([^"]+)"/i,
    /media:thumbnail[^>]*url="([^"]+)"/i,
    /<enclosure[^>]*url="([^"]+)"[^>]*type="image/i,
    /<img[^>]*src="([^"]+)"/i,
    /url="(https?:\/\/[^"]+\.(jpg|jpeg|png|webp)[^"]*)"/i,
  ];
  for (const pat of patterns) {
    const m = itemBlock.match(pat);
    if (m?.[1] && m[1].startsWith('http')) return m[1];
  }
  return undefined;
}

async function fetchRSSSource(rssUrl: string, sourceName: string): Promise<RSSItem[]> {
  try {
    const res = await fetch(rssUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MomentMarketing/1.0; +https://momentmarketing.app)',
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];

    const xml = await res.text();
    const itemBlocks = xml.match(/<item>([\s\S]*?)<\/item>/gi) ?? [];

    return itemBlocks.slice(0, 20).map(block => {
      const title = extractRSSTag(block, 'title');
      const desc = extractRSSTag(block, 'description') || extractRSSTag(block, 'summary');
      const pubDate = extractRSSTag(block, 'pubDate') || extractRSSTag(block, 'dc:date');
      const imageUrl = extractRSSImageUrl(block);

      return {
        title: title || sourceName + ' Update',
        description: desc.slice(0, 300) || title,
        imageUrl,
        source: sourceName,
        pubDate,
      };
    }).filter(item => item.title.length > 5);
  } catch {
    return [];
  }
}

// Category-based Unsplash fallback images for Facebook/news stories
const NEWS_FALLBACK_IMAGES: Record<string, string> = {
  sports: 'https://images.unsplash.com/photo-1540747913346-19212a4b423f?w=800&auto=format&fit=crop',
  cricket: 'https://images.unsplash.com/photo-1531415074968-036ba1b575da?w=800&auto=format&fit=crop',
  bollywood: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=800&auto=format&fit=crop',
  tech: 'https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=800&auto=format&fit=crop',
  finance: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=800&auto=format&fit=crop',
  travel: 'https://images.unsplash.com/photo-1524492412937-b28074a5d7da?w=800&auto=format&fit=crop',
  food: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800&auto=format&fit=crop',
  politics: 'https://images.unsplash.com/photo-1529107386315-e1a2ed48a620?w=800&auto=format&fit=crop',
  health: 'https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?w=800&auto=format&fit=crop',
  default: 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=800&auto=format&fit=crop',
};

function getNewsFallbackImage(title: string): string {
  const t = title.toLowerCase();
  if (/cricket|ipl|match|score/.test(t)) return NEWS_FALLBACK_IMAGES.cricket;
  if (/bollywood|film|movie|actor|celebrity/.test(t)) return NEWS_FALLBACK_IMAGES.bollywood;
  if (/tech|ai|startup|phone|app/.test(t)) return NEWS_FALLBACK_IMAGES.tech;
  if (/finance|stock|market|economy|budget/.test(t)) return NEWS_FALLBACK_IMAGES.finance;
  if (/travel|tourism|destination/.test(t)) return NEWS_FALLBACK_IMAGES.travel;
  if (/food|recipe|restaurant/.test(t)) return NEWS_FALLBACK_IMAGES.food;
  if (/politic|election|minister|government/.test(t)) return NEWS_FALLBACK_IMAGES.politics;
  if (/health|fitness|hospital|medical/.test(t)) return NEWS_FALLBACK_IMAGES.health;
  if (/sport|football|tennis|hockey/.test(t)) return NEWS_FALLBACK_IMAGES.sports;
  return NEWS_FALLBACK_IMAGES.default;
}

// Score RSS items by freshness and source reputation
function scoreRSSItem(item: RSSItem, sourceIndex: number): number {
  let score = 65;
  // Top sources (NDTV, TOI) get a boost
  if (sourceIndex <= 2) score += 10;
  // Bollywood/Entertainment content typically high engagement on Facebook
  if (/bollywood|film|movie|actor|actress|celebrity/i.test(item.title)) score += 8;
  // Sports content
  if (/cricket|ipl|match|score|win|team/i.test(item.title)) score += 7;
  // Viral keywords
  if (/viral|trending|massive|huge|shocking|amazing/i.test(item.title)) score += 5;
  // Recency boost if pubDate is available
  if (item.pubDate) {
    const age = Date.now() - new Date(item.pubDate).getTime();
    const ageHours = age / (1000 * 60 * 60);
    if (ageHours < 2) score += 12;
    else if (ageHours < 6) score += 8;
    else if (ageHours < 12) score += 4;
  }
  return Math.min(95, score);
}

// ─── Apify primary scraper ──────────────────────────────────────────────────

async function fetchViaApify(token: string): Promise<Moment[]> {
  const runRes = await fetch(
    `${APIFY_BASE}/acts/${ACTOR_ID}/runs?waitForFinish=240`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        startUrls: TRENDING_PAGES.map(url => ({ url })),
        resultsLimit: 300,
        maxPosts: 20,
      }),
    },
  );

  if (!runRes.ok) {
    const text = await runRes.text();
    console.error(`[Facebook] Apify run error ${runRes.status}:`, text.slice(0, 200));
    return [];
  }

  const runData = await runRes.json() as { data?: { defaultDatasetId?: string } };
  const datasetId = runData.data?.defaultDatasetId;
  if (!datasetId) return [];

  const dataRes = await fetch(
    `${APIFY_BASE}/datasets/${datasetId}/items?format=json&limit=500`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!dataRes.ok) return [];

  const posts = await dataRes.json() as FacebookPost[];

  const seen = new Set<string>();
  const viral = posts
    .filter(p => {
      const text = p.text ?? p.message_text;
      if (!text) return false;
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

  console.log(`[Facebook] Apify: Found ${viral.length} viral posts (≥${VIRAL_ENGAGEMENT_THRESHOLD.toLocaleString()} engagement) out of ${posts.length} scraped`);

  return viral.slice(0, 60).map(post => {
    const reactions = countReactions(post);
    const comments = post.commentsCount ?? 0;
    const shares = post.sharesCount ?? 0;
    const engagement = reactions + comments * 3 + shares * 5;
    const score = Math.min(100, 55 + Math.floor(Math.log10(engagement + 1) * 8));
    const text = ((post.text ?? post.message_text) ?? '').replace(/\n+/g, ' ').trim();
    const pageName = post.pageName ?? post.user?.name ?? 'Facebook';

    return classifyTrend({
      name: text.slice(0, 100) || 'Facebook Trending Post',
      description: `${pageName} • ${reactions.toLocaleString()} reactions • ${comments.toLocaleString()} comments • ${shares.toLocaleString()} shares`,
      imageUrl: extractImage(post),
      trendingScore: score,
      platform: 'Facebook',
    });
  }).filter((m): m is NonNullable<typeof m> => m !== null);
}

// ─── RSS fallback scraper ───────────────────────────────────────────────────

async function fetchViaRSS(): Promise<Moment[]> {
  console.log('[Facebook] Using RSS fallback for trending news');

  // Run all RSS fetches in parallel
  const results = await Promise.allSettled(
    RSS_SOURCES.map((s, i) => fetchRSSSource(s.url, s.source).then(items => ({ items, sourceIndex: i })))
  );

  const allItems: (RSSItem & { sourceIndex: number })[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      for (const item of r.value.items) {
        allItems.push({ ...item, sourceIndex: r.value.sourceIndex });
      }
    }
  }

  // Dedupe by title
  const seen = new Set<string>();
  const unique = allItems.filter(item => {
    const key = item.title.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`[Facebook] RSS fallback: Found ${unique.length} trending news stories`);

  return unique.slice(0, 60).map(item => {
    const score = scoreRSSItem(item, item.sourceIndex);
    // Guarantee an image — use RSS image if available, else smart fallback
    const imageUrl = item.imageUrl ?? getNewsFallbackImage(item.title);
    return classifyTrend({
      name: item.title.slice(0, 100),
      description: `${item.source} • ${item.description.slice(0, 200)}`,
      imageUrl,
      trendingScore: score,
      platform: 'Facebook',
    });
  }).filter((m): m is NonNullable<typeof m> => m !== null);
}

// ─── Main export ────────────────────────────────────────────────────────────

export async function fetchFacebookTrends(): Promise<Moment[]> {
  const token = process.env.APIFY_TOKEN;

  if (!token) {
    console.warn('[Facebook] APIFY_TOKEN not set — using RSS fallback');
    return fetchViaRSS();
  }

  try {
    const apifyResults = await fetchViaApify(token);
    if (apifyResults.length > 0) return apifyResults;

    // Apify returned empty (could be limit or no results) — use RSS fallback
    console.warn('[Facebook] Apify returned empty — switching to RSS fallback');
    return fetchViaRSS();
  } catch (e) {
    console.error('[Facebook] Apify failed:', e);
    return fetchViaRSS();
  }
}
