import type { Moment } from '@/types';
import { classifyTrend } from './classifier';
import { planCall, recordSpend } from '@/server/db/apify-spend';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

// ─── Apify Config ────────────────────────────────────────────────────────────
const APIFY_BASE = 'https://api.apify.com/v2';
const VIRAL_LIKES_THRESHOLD = 1_000;
const VIRAL_VIEWS_THRESHOLD = 5_000;
// Only keep posts made within the last 48 hours — "trending NOW" signal.
const FRESHNESS_WINDOW_MS = 48 * 60 * 60 * 1000;
// Cost-safe defaults — 10 profiles × 8 posts/profile = ~80 items → ~$0.18 / run
const DEFAULT_RESULTS_LIMIT = 8;

// Top 10 high-signal Indian + global accounts (trimmed from 26 for cost control)
const TARGET_PROFILES = [
  'https://www.instagram.com/virat.kohli/',
  'https://www.instagram.com/narendramodi/',
  'https://www.instagram.com/shahrukhkhan/',
  'https://www.instagram.com/bollywood/',
  'https://www.instagram.com/iplt20/',
  'https://www.instagram.com/ndtv/',
  'https://www.instagram.com/pinkvilla/',
  'https://www.instagram.com/cristiano/',
  'https://www.instagram.com/zomato/',
  'https://www.instagram.com/myntra/',
];

function isFresh(iso: string | number | undefined): boolean {
  if (!iso) return false;
  const t = typeof iso === 'number' ? iso * 1000 : new Date(iso).getTime();
  if (isNaN(t)) return false;
  return Date.now() - t <= FRESHNESS_WINDOW_MS;
}

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
  type?: string;
  timestamp?: string;
  alt?: string;
}

// ─── Image downloading & caching ─────────────────────────────────────────────
const IMAGE_CACHE_DIR = join(process.cwd(), 'public', 'images', 'ig');

async function ensureCacheDir(): Promise<void> {
  if (!existsSync(IMAGE_CACHE_DIR)) {
    await mkdir(IMAGE_CACHE_DIR, { recursive: true });
  }
}

async function cacheInstagramImage(
  displayUrl: string | undefined,
  shortCode: string,
): Promise<string | undefined> {
  if (!displayUrl) return undefined;

  const filename = `${shortCode}.jpg`;
  const localPath = join(IMAGE_CACHE_DIR, filename);
  const publicPath = `/images/ig/${filename}`;

  if (existsSync(localPath)) return publicPath;

  try {
    await ensureCacheDir();
    const res = await fetch(displayUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return `/api/image-proxy?url=${encodeURIComponent(displayUrl)}`;
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.startsWith('image/')) return `/api/image-proxy?url=${encodeURIComponent(displayUrl)}`;
    const buffer = Buffer.from(await res.arrayBuffer());
    await writeFile(localPath, buffer);
    console.log(`[Instagram] Cached image: ${publicPath} (${(buffer.length / 1024).toFixed(0)}KB)`);
    return publicPath;
  } catch {
    return `/api/image-proxy?url=${encodeURIComponent(displayUrl)}`;
  }
}

// ─── Category fallback images (Unsplash) ─────────────────────────────────────
const CATEGORY_IMAGES: Record<string, string> = {
  Sports: 'https://images.unsplash.com/photo-1540747913346-19212a4b423f?w=800&auto=format&fit=crop',
  Movies: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=800&auto=format&fit=crop',
  Meme: 'https://images.unsplash.com/photo-1516251193007-45ef944ab0c6?w=800&auto=format&fit=crop',
  Fashion: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&auto=format&fit=crop',
  Food: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800&auto=format&fit=crop',
  Travel: 'https://images.unsplash.com/photo-1524492412937-b28074a5d7da?w=800&auto=format&fit=crop',
  Health: 'https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?w=800&auto=format&fit=crop',
  Tech: 'https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=800&auto=format&fit=crop',
  Music: 'https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?w=800&auto=format&fit=crop',
  Entertainment: 'https://images.unsplash.com/photo-1485846234645-a62644f84728?w=800&auto=format&fit=crop',
  Marketing: 'https://images.unsplash.com/photo-1552664730-d307ca884978?w=800&auto=format&fit=crop',
  Finance: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=800&auto=format&fit=crop',
  Gaming: 'https://images.unsplash.com/photo-1552820728-8b83bb6b773f?w=800&auto=format&fit=crop',
  Politics: 'https://images.unsplash.com/photo-1529107386315-e1a2ed48a620?w=800&auto=format&fit=crop',
};

function getCategoryFallbackImage(usernameOrTag: string, contentText: string): string {
  const text = (usernameOrTag + ' ' + contentText).toLowerCase();
  if (/virat\.kohli|mumbaiindians|chennaiipl|iplt20/.test(text)) return CATEGORY_IMAGES.Sports;
  if (/leomessi|cristiano|therock/.test(text)) return CATEGORY_IMAGES.Sports;
  if (/shahrukhkhan|aliaabhatt|deepikapadukone|ranveersingh|katrinakaif|priyankachopra/.test(text)) return CATEGORY_IMAGES.Movies;
  if (/bollywood|filmfare|pinkvilla|bollywoodhungama|zoomtv/.test(text)) return CATEGORY_IMAGES.Movies;
  if (/politic|election|minister|government|modi|bjp|congress/.test(text)) return CATEGORY_IMAGES.Politics;
  if (/cricket|ipl|sport|football|tennis|match|score|team|fifa|league|wpl|bcci/.test(text)) return CATEGORY_IMAGES.Sports;
  if (/bollywood|film|movie|cinema|actor|actress|release|trailer|ott|netflix|prime/.test(text)) return CATEGORY_IMAGES.Movies;
  if (/fashion|style|outfit|wear|designer|runway|couture|saree|kurta/.test(text)) return CATEGORY_IMAGES.Fashion;
  if (/food|recipe|cook|eat|dish|restaurant|biryani|chai|dosa|street food/.test(text)) return CATEGORY_IMAGES.Food;
  if (/travel|trip|tourism|destination|hill station|beach|temple|holiday/.test(text)) return CATEGORY_IMAGES.Travel;
  if (/fitness|gym|workout|health|yoga|diet|weight|run|marathon/.test(text)) return CATEGORY_IMAGES.Health;
  if (/tech|ai|startup|gadget|phone|app|software|iphone|samsung|isro/.test(text)) return CATEGORY_IMAGES.Tech;
  if (/music|song|concert|album|singer|rapper|dj|spotify|gaana|wynk/.test(text)) return CATEGORY_IMAGES.Music;
  if (/meme|funny|viral|reel|comedy|lol|humour|roast/.test(text)) return CATEGORY_IMAGES.Meme;
  if (/finance|stock|market|crypto|bitcoin|sensex|nifty|economy|rbi/.test(text)) return CATEGORY_IMAGES.Finance;
  if (/game|gaming|esport|pubg|valorant|bgmi|freefire/.test(text)) return CATEGORY_IMAGES.Gaming;
  return CATEGORY_IMAGES.Entertainment;
}

// ─── Real-time fallback: Google Trends India ─────────────────────────────────
// Fetches what's ACTUALLY trending in India RIGHT NOW — no API key needed,
// updates every hour from Google's own trending search data.

interface TrendingTopic {
  name: string;
  traffic?: number;
  relatedNews?: string[];
}

// Detect if a string is mostly non-Latin (Hindi/Telugu/Kannada etc.)
function isNonLatinScript(text: string): boolean {
  const nonLatinCount = (text.match(/[^\x00-\x7F]/g) ?? []).length;
  return nonLatinCount > text.length * 0.4;
}

async function fetchGoogleTrendsIndia(): Promise<TrendingTopic[]> {
  try {
    const res = await fetch(
      'https://trends.google.com/trending/rss?geo=IN',
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'application/rss+xml, application/xml, text/xml, */*',
        },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) {
      console.warn(`[Instagram] Google Trends returned ${res.status}`);
      return [];
    }

    const xml = await res.text();
    const itemBlocks = xml.match(/<item>([\s\S]*?)<\/item>/gi) ?? [];
    const topics: TrendingTopic[] = [];

    for (const block of itemBlocks.slice(0, 25)) {
      const titleMatch = block.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/i);
      const title = titleMatch?.[1]
        ?.trim()
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'");

      if (!title || title === 'Daily Search Trends' || title.length < 3) continue;

      // Parse approximate traffic volume (e.g., "200K+")
      const trafficRaw = block.match(/<ht:approx_traffic>(.*?)<\/ht:approx_traffic>/i)?.[1] ?? '';
      let traffic: number | undefined;
      if (trafficRaw) {
        const cleaned = trafficRaw.replace(/\+/g, '').trim();
        if (cleaned.endsWith('M')) traffic = parseFloat(cleaned) * 1_000_000;
        else if (cleaned.endsWith('K')) traffic = parseFloat(cleaned) * 1_000;
        else traffic = parseInt(cleaned.replace(/,/g, ''), 10) || undefined;
      }

      // Extract related news headlines — prefer English ones for UI readability
      const newsBlocks = block.match(/<ht:news_item>([\s\S]*?)<\/ht:news_item>/gi) ?? [];
      const relatedNews = newsBlocks.map(nb => {
        const t = nb.match(/<ht:news_item_title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/ht:news_item_title>/i)?.[1]?.trim() ?? '';
        return t.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
      }).filter(Boolean);

      // If the topic title is in non-Latin script (Hindi/Telugu/Kannada),
      // prefer an English news headline as the display name — but never skip the topic.
      let displayName = title;
      if (isNonLatinScript(title)) {
        const englishHeadline = relatedNews.find(n => !isNonLatinScript(n) && n.length > 5);
        if (englishHeadline) {
          // Use the English news headline (truncated) as the topic name
          displayName = englishHeadline.slice(0, 80);
        }
        // If no English headline, keep original title — it still represents a real trend
      }

      const englishNews = relatedNews.filter(n => !isNonLatinScript(n));
      topics.push({ name: displayName, traffic, relatedNews: englishNews });
    }

    console.log(`[Instagram] Google Trends IN: ${topics.length} live trending topics`);
    return topics;
  } catch (e) {
    console.warn('[Instagram] Google Trends fetch error:', e);
    return [];
  }
}

// Also query Instagram's public search endpoint to get post counts for topics
async function getInstagramHashtagCount(query: string): Promise<number | undefined> {
  try {
    const res = await fetch(
      `https://www.instagram.com/web/search/topsearch/?query=${encodeURIComponent(query)}&context=hashtag`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
          Accept: 'application/json',
          'X-IG-App-ID': '936619743392459',
        },
        signal: AbortSignal.timeout(4000),
      },
    );
    if (!res.ok) return undefined;
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('json')) return undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await res.json() as any;
    return data?.hashtags?.[0]?.hashtag?.media_count as number | undefined;
  } catch {
    return undefined;
  }
}

// ─── Apify primary path ───────────────────────────────────────────────────────

async function fetchViaApify(token: string): Promise<Moment[]> {
  // Daily spend gate — skip Apify entirely if remaining budget is too low.
  const safeLimit = planCall('apify/instagram-scraper', DEFAULT_RESULTS_LIMIT, 20);
  if (safeLimit === null) {
    console.warn('[Instagram] Daily Apify budget exhausted — falling back to Google Trends');
    return [];
  }

  console.log(`[Instagram] Apify: live scrape via run-sync-get-dataset-items (resultsLimit=${safeLimit}) ...`);

  const res = await fetch(
    `${APIFY_BASE}/acts/apify~instagram-scraper/run-sync-get-dataset-items?timeout=300&format=json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        directUrls: TARGET_PROFILES,
        resultsType: 'posts',
        resultsLimit: safeLimit,
        addParentData: false,
        searchType: 'user',
        searchLimit: 1,
      }),
      signal: AbortSignal.timeout(310_000),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    console.error(`[Instagram] Apify run error ${res.status}:`, text.slice(0, 300));
    return [];
  }

  const posts = (await res.json()) as InstagramPost[];
  // Record actual spend (items returned × rate).
  recordSpend('apify/instagram-scraper', posts.length);
  if (posts.length === 0) return [];

  const seen = new Set<string>();
  const viral = posts
    .filter(p => {
      if (!p.caption && !p.displayUrl) return false;
      // Freshness — only posts < 48h old count as "trending now"
      if (!isFresh(p.timestamp)) return false;
      const likes = p.likesCount ?? 0;
      const views = p.videoViewCount ?? 0;
      if (likes < VIRAL_LIKES_THRESHOLD && views < VIRAL_VIEWS_THRESHOLD) return false;
      const key = p.shortCode ?? p.id?.toString() ?? p.caption?.slice(0, 50) ?? '';
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const aScore = (a.likesCount ?? 0) + (a.videoViewCount ?? 0) / 10;
      const bScore = (b.likesCount ?? 0) + (b.videoViewCount ?? 0) / 10;
      return bScore - aScore;
    });

  console.log(`[Instagram] Apify: ${viral.length} fresh-viral posts (< 48h, ≥${VIRAL_LIKES_THRESHOLD.toLocaleString()} likes or ≥${VIRAL_VIEWS_THRESHOLD.toLocaleString()} views) from ${posts.length} total`);

  const moments: Moment[] = [];
  const batch = viral.slice(0, 80);
  const imageResults = await Promise.allSettled(
    batch.map(post => {
      const code = post.shortCode ?? post.id?.toString() ?? 'unknown';
      return cacheInstagramImage(post.displayUrl, code);
    }),
  );

  for (let i = 0; i < batch.length; i++) {
    const post = batch[i];
    const likes = post.likesCount ?? 0;
    const comments = post.commentsCount ?? 0;
    const views = post.videoViewCount ?? 0;
    const engagement = likes + comments * 5 + views;
    const score = Math.min(100, 55 + Math.floor(Math.log10(engagement + 1) * 7));
    const caption = (post.caption ?? 'Instagram Trend').replace(/\n+/g, ' ').trim();
    const hashtagsText = post.hashtags?.slice(0, 3).map(h => `#${h}`).join(' ') ?? '';
    const name = caption.slice(0, 100) || 'Instagram Trending Post';

    let imageUrl: string;
    const imgResult = imageResults[i];
    if (imgResult.status === 'fulfilled' && imgResult.value) {
      imageUrl = imgResult.value;
    } else {
      imageUrl = getCategoryFallbackImage(post.ownerUsername ?? '', name + ' ' + (post.hashtags?.join(' ') ?? ''));
    }

    const moment = classifyTrend({
      name,
      description: `@${post.ownerUsername ?? 'instagram'} • ${likes.toLocaleString()} likes • ${comments.toLocaleString()} comments${hashtagsText ? ` • ${hashtagsText}` : ''}`,
      imageUrl,
      trendingScore: score,
      platform: 'Instagram',
      originDate: post.timestamp,
    });
    if (moment) moments.push(moment);
  }

  return moments;
}

// ─── Additional source: Twitter API trending queries (uses existing bearer token) ─
// Fetches trending Indian content from Twitter to supplement Instagram moments.
async function fetchTwitterTrendingTopics(): Promise<TrendingTopic[]> {
  const token = process.env.TWITTER_BEARER_TOKEN;
  if (!token) return [];

  const INDIA_QUERIES = [
    'IPL 2025 trending', 'Bollywood viral today', 'India cricket latest',
    'trending India today', 'viral reel India', 'India news trending',
  ];

  try {
    const results = await Promise.allSettled(
      INDIA_QUERIES.slice(0, 4).map(async q => {
        const url = new URL('https://api.twitter.com/2/tweets/search/recent');
        url.searchParams.set('query', `${q} lang:en -is:retweet`);
        url.searchParams.set('max_results', '10');
        url.searchParams.set('tweet.fields', 'public_metrics,entities');
        const res = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) return [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = await res.json() as any;
        return (data?.data ?? []) as Array<{ text: string; public_metrics?: { like_count?: number; retweet_count?: number } }>;
      }),
    );

    const topics: TrendingTopic[] = [];
    const seen = new Set<string>();
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      for (const tweet of r.value) {
        const text = tweet.text?.replace(/https?:\/\/\S+/g, '').replace(/@\S+/g, '').trim();
        if (!text || text.length < 10) continue;
        const name = text.slice(0, 80);
        const key = name.toLowerCase().slice(0, 30);
        if (seen.has(key)) continue;
        seen.add(key);
        const likes = tweet.public_metrics?.like_count ?? 0;
        const retweets = tweet.public_metrics?.retweet_count ?? 0;
        topics.push({ name, traffic: likes + retweets * 3 });
      }
    }
    console.log(`[Instagram] Twitter supplement: ${topics.length} trending topics`);
    return topics.slice(0, 8);
  } catch {
    return [];
  }
}

// ─── Real-time fallback: Google Trends IN → Instagram moments ─────────────────
// Called when Apify fails or has no credits. Fetches live trending topics
// from Google India (updates every hour) and enriches with Instagram post counts.

async function fetchViaGoogleTrendsFallback(): Promise<Moment[]> {
  console.log('[Instagram] Using Google Trends India real-time fallback...');

  const topics = await fetchGoogleTrendsIndia();

  if (topics.length === 0) {
    console.warn('[Instagram] Google Trends also empty — returning 0 moments');
    return [];
  }

  // Also pull in Twitter trending topics as additional Instagram moment sources
  const twitterTopics = await fetchTwitterTrendingTopics();
  const allTopics = [...topics, ...twitterTopics].slice(0, 20);

  // Concurrently check Instagram post counts for all topics (best effort, 4s timeout each)
  const enriched = await Promise.allSettled(
    allTopics.slice(0, 18).map(async topic => {
      const igCount = await getInstagramHashtagCount(topic.name.replace(/\s+/g, ''));
      return { ...topic, igCount };
    }),
  );

  const moments: Moment[] = [];

  for (const result of enriched) {
    if (result.status !== 'fulfilled') continue;
    const { name, traffic, relatedNews, igCount } = result.value;

    // Score: Google traffic volume is the primary signal
    let score = 68;
    if (traffic) {
      score = Math.min(96, 62 + Math.floor(Math.log10(traffic + 1) * 8));
    }
    // Secondary boost: Instagram confirms high post volume on this topic
    if (igCount && igCount > 500_000) score = Math.min(99, score + 6);
    else if (igCount && igCount > 100_000) score = Math.min(99, score + 3);

    const imageUrl = getCategoryFallbackImage('', name + ' ' + (relatedNews?.join(' ') ?? ''));

    // Build rich description with real data
    const parts: string[] = ['Trending in India right now'];
    if (traffic) {
      const trafficLabel = traffic >= 1_000_000
        ? `${(traffic / 1_000_000).toFixed(1)}M`
        : traffic >= 1000
        ? `${Math.round(traffic / 1000)}K`
        : traffic.toString();
      parts.push(`${trafficLabel}+ searches today`);
    }
    if (igCount && igCount > 0) {
      const igLabel = igCount >= 1_000_000
        ? `${(igCount / 1_000_000).toFixed(1)}M`
        : igCount >= 1000
        ? `${Math.round(igCount / 1000)}K`
        : igCount.toString();
      parts.push(`${igLabel}+ Instagram posts`);
    }
    if (relatedNews?.[0]) parts.push(relatedNews[0].slice(0, 80));

    const moment = classifyTrend({
      name: name.slice(0, 100),
      description: parts.join(' • '),
      imageUrl,
      trendingScore: score,
      platform: 'Instagram',
    });
    if (moment) moments.push(moment);
  }

  console.log(`[Instagram] Real-time fallback: ${moments.length} moments from live Google Trends data`);
  return moments;
}

// ─── Main export ──────────────────────────────────────────────────────────────
export async function fetchInstagramTrends(): Promise<Moment[]> {
  const token = process.env.APIFY_TOKEN;

  if (!token) {
    console.warn('[Instagram] APIFY_TOKEN not set — using Google Trends real-time fallback');
    return fetchViaGoogleTrendsFallback();
  }

  try {
    const apifyResults = await fetchViaApify(token);
    if (apifyResults.length > 0) {
      console.log(`[Instagram] ✓ ${apifyResults.length} live moments from Apify Instagram scraper`);
      return apifyResults;
    }
    console.warn('[Instagram] Apify empty — switching to Google Trends real-time fallback');
    return fetchViaGoogleTrendsFallback();
  } catch (e) {
    console.error('[Instagram] Apify error:', e);
    return fetchViaGoogleTrendsFallback();
  }
}
