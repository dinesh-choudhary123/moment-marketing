import type { Moment } from '@/types';
import { classifyTrend } from './classifier';

export type RedditSortOption = 'hot' | 'top' | 'new' | 'relevance';

const HEADERS = { 'User-Agent': 'MomentMarketing/1.0 (by /u/momentmarketing)' };

// Surface posts with ≥1k upvotes — captures normal trending content, not just mega-viral
const VIRAL_UPVOTE_THRESHOLD = 1_000;

// Subreddits to scrape for viral global + India-centric content
const TRENDING_SUBREDDITS = [
  'all',
  'popular',
  'india',
  'IndiaSpeaks',
  'BollywoodNews',
  'bollywood',
  'Cricket',
  'ipl',
  'memes',
  'dankmemes',
  'funny',
  'worldnews',
  'news',
  'technology',
  'sports',
  'entertainment',
  'movies',
  'music',
  'gaming',
  'videos',
  'pics',
  'interestingasfuck',
  'nextfuckinglevel',
  'Damnthatsinteresting',
  'todayilearned',
];

// Search queries for live events
const SEARCH_QUERIES = [
  'trending India',
  'IPL 2026',
  'Bollywood',
  'viral',
  'breaking news India',
  'viral video',
];

// ─── Image extraction ────────────────────────────────────────

interface RedditPostData {
  title?: string;
  selftext?: string;
  subreddit?: string;
  ups?: number;
  score?: number;
  upvote_ratio?: number;
  num_comments?: number;
  url?: string;
  url_overridden_by_dest?: string;
  thumbnail?: string;
  post_hint?: string;
  is_video?: boolean;
  is_gallery?: boolean;
  is_self?: boolean;
  domain?: string;
  permalink?: string;
  created_utc?: number;
  preview?: {
    images?: Array<{
      source?: { url?: string; width?: number; height?: number };
      resolutions?: Array<{ url?: string; width?: number; height?: number }>;
    }>;
  };
  media_metadata?: Record<string, {
    status?: string;
    e?: string;
    s?: { u?: string; x?: number; y?: number };
    p?: Array<{ u?: string; x?: number; y?: number }>;
  }>;
  secure_media?: {
    reddit_video?: { fallback_url?: string };
  };
}

// Category-based Unsplash fallback images for Reddit posts without accessible images
const REDDIT_FALLBACK_IMAGES: Record<string, string> = {
  sports: 'https://images.unsplash.com/photo-1540747913346-19212a4b423f?w=800&auto=format&fit=crop',
  cricket: 'https://images.unsplash.com/photo-1531415074968-036ba1b575da?w=800&auto=format&fit=crop',
  meme: 'https://images.unsplash.com/photo-1516251193007-45ef944ab0c6?w=800&auto=format&fit=crop',
  funny: 'https://images.unsplash.com/photo-1516251193007-45ef944ab0c6?w=800&auto=format&fit=crop',
  news: 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=800&auto=format&fit=crop',
  tech: 'https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=800&auto=format&fit=crop',
  gaming: 'https://images.unsplash.com/photo-1552820728-8b83bb6b773f?w=800&auto=format&fit=crop',
  india: 'https://images.unsplash.com/photo-1524492412937-b28074a5d7da?w=800&auto=format&fit=crop',
  bollywood: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=800&auto=format&fit=crop',
  food: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800&auto=format&fit=crop',
  default: 'https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=800&auto=format&fit=crop',
};

function getRedditFallbackImage(title: string, subreddit: string): string {
  const text = (title + ' ' + subreddit).toLowerCase();
  if (/cricket|ipl|sport|football|nba/.test(text)) return REDDIT_FALLBACK_IMAGES.cricket;
  if (/meme|funny|humor|lol/.test(text)) return REDDIT_FALLBACK_IMAGES.meme;
  if (/tech|ai|software|hardware/.test(text)) return REDDIT_FALLBACK_IMAGES.tech;
  if (/gaming|gta|game|esport/.test(text)) return REDDIT_FALLBACK_IMAGES.gaming;
  if (/india|bollywood/.test(text)) return REDDIT_FALLBACK_IMAGES.india;
  if (/bollywood|film|movie/.test(text)) return REDDIT_FALLBACK_IMAGES.bollywood;
  if (/food|recipe|cook/.test(text)) return REDDIT_FALLBACK_IMAGES.food;
  if (/news|world|politics/.test(text)) return REDDIT_FALLBACK_IMAGES.news;
  return REDDIT_FALLBACK_IMAGES.default;
}

function extractImageUrl(d: RedditPostData): string | undefined {
  // NOTE: preview.redd.it returns 403 when hotlinked — only use i.redd.it

  // 1. Direct i.redd.it image (always public, no hotlink protection)
  const directUrl = d.url_overridden_by_dest ?? d.url;
  if (directUrl && (directUrl.startsWith('https://i.redd.it/') || directUrl.startsWith('http://i.redd.it/'))) {
    return directUrl;
  }

  // 2. Direct image URL from imgur or other public hosts
  if (directUrl && /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(directUrl)) {
    if (!directUrl.includes('preview.redd.it') && !directUrl.includes('external-preview.redd.it')) {
      return directUrl;
    }
  }

  // 3. Gallery — first image via i.redd.it (extract the id from media_metadata)
  if (d.is_gallery && d.media_metadata) {
    for (const [mediaId, meta] of Object.entries(d.media_metadata)) {
      if (meta.status === 'valid' && meta.e === 'Image') {
        // Reconstruct i.redd.it URL from media id
        return `https://i.redd.it/${mediaId}.jpg`;
      }
    }
  }

  // 4. Thumbnail — only if it's a proper HTTP URL (skip "self", "nsfw", "default" etc.)
  if (d.thumbnail && d.thumbnail.startsWith('https://') && !d.thumbnail.includes('preview.redd.it')) {
    return d.thumbnail;
  }

  // 5. Fall back to category-based Unsplash image
  return getRedditFallbackImage(d.title ?? '', d.subreddit ?? '');
}

function cleanUrl(url: string): string {
  return url.replace(/&amp;/g, '&');
}

// ─── Fetching ────────────────────────────────────────────────

interface RedditListing {
  data?: {
    children?: Array<{ data?: RedditPostData }>;
  };
}

async function fetchSubreddit(
  subreddit: string,
  sort: RedditSortOption,
  limit = 50,
  timeRange = 'day',
): Promise<RedditPostData[]> {
  const timeParam = sort === 'top' ? `&t=${timeRange}` : '';
  const url = `https://www.reddit.com/r/${subreddit}/${sort}.json?limit=${limit}&raw_json=1${timeParam}`;

  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return [];
    const data = (await res.json()) as RedditListing;
    return (data.data?.children ?? []).map(c => c.data!).filter(Boolean);
  } catch {
    return [];
  }
}

async function searchReddit(query: string, sort: RedditSortOption, limit = 15): Promise<RedditPostData[]> {
  const timeParam = sort === 'top' ? '&t=day' : '';
  const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=${sort}&limit=${limit}&raw_json=1${timeParam}`;

  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return [];
    const data = (await res.json()) as RedditListing;
    return (data.data?.children ?? []).map(c => c.data!).filter(Boolean);
  } catch {
    return [];
  }
}

// ─── Main export ─────────────────────────────────────────────

// Batch helper to avoid Reddit rate limits (~60 req/min)
async function runBatched<T>(
  tasks: Array<() => Promise<T>>,
  batchSize = 8,
  delayMs = 300,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < tasks.length; i += batchSize) {
    const chunk = tasks.slice(i, i + batchSize);
    const res = await Promise.allSettled(chunk.map(t => t()));
    for (const r of res) if (r.status === 'fulfilled') out.push(r.value);
    if (i + batchSize < tasks.length) await new Promise(r => setTimeout(r, delayMs));
  }
  return out;
}

export async function fetchRedditTrends(sort: RedditSortOption = 'top'): Promise<Moment[]> {
  try {
    // Build tasks — fetch top-of-day and top-of-week from each subreddit + searches
    const tasks: Array<() => Promise<RedditPostData[]>> = [
      ...TRENDING_SUBREDDITS.map(sub => () => fetchSubreddit(sub, 'top', 50, 'day')),
      ...TRENDING_SUBREDDITS.map(sub => () => fetchSubreddit(sub, 'top', 25, 'week')),
      ...SEARCH_QUERIES.map(q => () => searchReddit(q, sort, 25)),
    ];

    const batched = await runBatched(tasks, 8, 400);
    const allPosts: RedditPostData[] = batched.flat();

    // Dedupe, filter by viral threshold, sort by score
    const seen = new Set<string>();
    const viralPosts = allPosts
      .filter(d => {
        if (!d.title) return false;
        const ups = d.ups ?? d.score ?? 0;
        // Only keep actually viral posts
        if (ups < VIRAL_UPVOTE_THRESHOLD) return false;
        const key = d.title.toLowerCase().trim();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    console.log(`[Reddit] Found ${viralPosts.length} viral posts (≥${VIRAL_UPVOTE_THRESHOLD.toLocaleString()} upvotes) out of ${allPosts.length} scraped`);

    return viralPosts.slice(0, 80).map(d => {
      const ups = d.ups ?? d.score ?? 0;
      const comments = d.num_comments ?? 0;
      // Score scales with log of upvotes; 10k=83, 50k=91, 100k=95, 200k=99
      const score = Math.min(100, 50 + Math.floor(Math.log10(ups) * 10));

      const imageUrl = extractImageUrl(d);

      return classifyTrend({
        name: (d.title ?? '').slice(0, 100),
        description: `r/${d.subreddit ?? 'reddit'} • ${ups.toLocaleString()} upvotes • ${comments.toLocaleString()} comments`,
        imageUrl,
        trendingScore: score,
        platform: 'Reddit',
      });
    }).filter((m): m is NonNullable<typeof m> => m !== null);
  } catch (e) {
    console.error('[Reddit] Scraper failed:', e);
    return [];
  }
}
