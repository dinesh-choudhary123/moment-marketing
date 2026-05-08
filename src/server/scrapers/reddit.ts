import type { Moment } from '@/types';
import { classifyTrend } from './classifier';
import { fetchTopicImage } from './image-utils';

// ─── Reddit India multi-subreddit hot — no auth needed ───────────────────────
// Fetches trending posts from India-relevant subreddits for moment marketing.
// Subreddits: india, bollywood, cricket, IPL, IndianMemes, technology, Damnthatsinteresting
// Image: data.preview.images[0].source.url → direct url → data.thumbnail (last resort) → fetchTopicImage

const HEADERS = { 'User-Agent': 'MomentMarketing/2.0 (by /u/momentmarketing)' };

// Reddit sentinels that are not real thumbnail URLs
const THUMBNAIL_SENTINELS = new Set(['self', 'default', 'nsfw', 'image', 'spoiler', '']);

interface RedditPost {
  title?: string;
  selftext?: string;
  subreddit?: string;
  author?: string;
  ups?: number;
  score?: number;
  num_comments?: number;
  thumbnail?: string;
  preview?: {
    images?: Array<{
      source?: { url?: string };
    }>;
  };
  created_utc?: number;
  url?: string;
}

interface RedditListing {
  data?: { children?: Array<{ data?: RedditPost }> };
}

/** Extract a real image URL from a Reddit post — no fetchTopicImage fallback here. */
function extractDirectImage(d: RedditPost): string | undefined {
  // 1. preview image (full-quality post image) — HTML-decode &amp;
  // This is the actual post photo/meme at full resolution, far better than the thumbnail
  const previewUrl = d.preview?.images?.[0]?.source?.url;
  if (previewUrl) return previewUrl.replace(/&amp;/g, '&');

  // 2. direct image URL (i.redd.it, i.imgur.com, etc.)
  if (d.url && /\.(jpg|jpeg|png|webp|gif)$/i.test(d.url)) {
    return d.url;
  }

  // 3. thumbnail — last resort (tiny 70px crops, often subreddit icons)
  if (
    d.thumbnail &&
    d.thumbnail.startsWith('https://') &&
    !THUMBNAIL_SENTINELS.has(d.thumbnail)
  ) {
    return d.thumbnail;
  }

  return undefined;
}

// Marketing keyword search query — same hashtags used on Instagram
const MARKETING_SEARCH_QUERY = 'momentmarketing OR "moment marketing" OR creativeads OR "creative advertising" OR marketingmentor OR "outdoor advertising" OR kitkat OR advertising';

async function fetchRedditByKeywords(): Promise<RedditPost[]> {
  try {
    const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(MARKETING_SEARCH_QUERY)}&sort=top&t=week&limit=25`;
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(12_000) });
    if (!res.ok) { console.warn(`[Reddit] keyword search returned ${res.status}`); return []; }
    const data = await res.json() as RedditListing;
    const posts = (data.data?.children ?? []).map(c => c.data!).filter((d): d is RedditPost => !!d && !!d.title);
    console.log(`[Reddit] marketing keyword search → ${posts.length} posts`);
    return posts;
  } catch (e) {
    console.warn('[Reddit] keyword search failed:', (e as Error).message);
    return [];
  }
}

export async function fetchRedditTrends(): Promise<Moment[]> {
  try {
    // India subreddits + marketing subreddits in parallel with keyword search
    const subreddits = 'india+bollywood+cricket+IPL+IndianMemes+technology+Damnthatsinteresting+marketing+advertising+branding+DigitalMarketing+socialmediamarketing';
    const [hotRes, keywordPosts] = await Promise.all([
      fetch(`https://www.reddit.com/r/${subreddits}/hot.json?limit=30`, {
        headers: HEADERS,
        signal: AbortSignal.timeout(15_000),
      }),
      fetchRedditByKeywords(),
    ]);

    if (!hotRes.ok) {
      console.warn(`[Reddit] multi-subreddit hot returned ${hotRes.status}`);
      return [];
    }

    const data = await hotRes.json() as RedditListing;
    const hotPosts = (data.data?.children ?? [])
      .map(c => c.data!)
      .filter((d): d is RedditPost => !!d && !!d.title);

    // Merge: hot posts first, then keyword posts — dedupe by title
    const seenTitles = new Set(hotPosts.map(p => (p.title ?? '').toLowerCase().slice(0, 60)));
    const uniqueKeyword = keywordPosts.filter(p => {
      const key = (p.title ?? '').toLowerCase().slice(0, 60);
      if (seenTitles.has(key)) return false;
      seenTitles.add(key);
      return true;
    });
    const posts = [...hotPosts, ...uniqueKeyword];

    console.log(`[Reddit] ${hotPosts.length} hot + ${uniqueKeyword.length} marketing keyword posts = ${posts.length} total`);

    // Resolve images in parallel: proxy the direct post image or use fetchTopicImage fallback
    const imageUrls = await Promise.all(
      posts.map(d => {
        const direct = extractDirectImage(d);
        if (direct) {
          return Promise.resolve(`/api/image-proxy?url=${encodeURIComponent(direct)}`);
        }
        return fetchTopicImage(d.title ?? 'reddit trending');
      }),
    );

    const moments: Moment[] = [];
    for (let i = 0; i < posts.length; i++) {
      const d = posts[i];
      const ups = d.ups ?? d.score ?? 0;
      const comments = d.num_comments ?? 0;
      const score = Math.min(100, 50 + Math.floor(Math.log10(Math.max(ups + 1, 1)) * 10));

      // Use the post body as description when available — much more informative than upvote counts
      const body = (d.selftext ?? '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
      const description = body.length > 20
        ? `${body.slice(0, 120)}${body.length > 120 ? '…' : ''}`
        : `r/${d.subreddit ?? 'all'} • ${ups.toLocaleString()} upvotes • ${comments.toLocaleString()} comments`;

      const subreddit = d.subreddit ?? 'all';
      const moment = classifyTrend({
        name: (d.title ?? '').slice(0, 100),
        description,
        imageUrl: imageUrls[i],
        trendingScore: score,
        platform: 'Reddit',
        originDate: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : undefined,
        sourceAccounts: [
          { name: `r/${subreddit}`, url: `https://www.reddit.com/r/${subreddit}/` },
          ...(d.author && d.author !== '[deleted]' ? [{ name: `u/${d.author}`, url: `https://www.reddit.com/u/${d.author}/` }] : []),
        ],
      });
      if (moment) moments.push(moment);
    }

    return moments;
  } catch (e) {
    console.error('[Reddit] Scraper failed:', e);
    return [];
  }
}
