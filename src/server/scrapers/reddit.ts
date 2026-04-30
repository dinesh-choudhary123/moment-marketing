import type { Moment } from '@/types';
import { classifyTrend } from './classifier';
import { fetchTopicImage } from './image-utils';

// ─── Reddit r/all/hot — single lightweight call, no auth needed ───────────────
// Returns the 25 hottest posts across all of Reddit right now.
// Image: data.thumbnail (if not a sentinel) → data.preview.images[0].source.url → fetchTopicImage

const HEADERS = { 'User-Agent': 'MomentMarketing/2.0 (by /u/momentmarketing)' };

// Reddit sentinels that are not real thumbnail URLs
const THUMBNAIL_SENTINELS = new Set(['self', 'default', 'nsfw', 'image', 'spoiler', '']);

interface RedditPost {
  title?: string;
  selftext?: string;   // post body — available for text posts
  subreddit?: string;
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
  // 1. thumbnail — valid https URL that isn't a Reddit sentinel
  if (
    d.thumbnail &&
    d.thumbnail.startsWith('https://') &&
    !THUMBNAIL_SENTINELS.has(d.thumbnail)
  ) {
    return d.thumbnail;
  }

  // 2. preview image — HTML-decode &amp; (Reddit escapes & in JSON-inside-HTML contexts)
  const previewUrl = d.preview?.images?.[0]?.source?.url;
  if (previewUrl) return previewUrl.replace(/&amp;/g, '&');

  return undefined;
}

export async function fetchRedditTrends(): Promise<Moment[]> {
  try {
    const res = await fetch('https://www.reddit.com/r/all/hot.json?limit=25', {
      headers: HEADERS,
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      console.warn(`[Reddit] r/all/hot returned ${res.status}`);
      return [];
    }

    const data = await res.json() as RedditListing;
    const posts = (data.data?.children ?? [])
      .map(c => c.data!)
      .filter((d): d is RedditPost => !!d && !!d.title);

    console.log(`[Reddit] r/all/hot → ${posts.length} posts`);

    // Resolve images in parallel: direct post image or fetchTopicImage fallback
    const imageUrls = await Promise.all(
      posts.map(d => {
        const direct = extractDirectImage(d);
        return direct ? Promise.resolve(direct) : fetchTopicImage(d.title ?? 'reddit trending');
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

      const moment = classifyTrend({
        name: (d.title ?? '').slice(0, 100),
        description,
        imageUrl: imageUrls[i],
        trendingScore: score,
        platform: 'Reddit',
        originDate: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : undefined,
      });
      if (moment) moments.push(moment);
    }

    return moments;
  } catch (e) {
    console.error('[Reddit] Scraper failed:', e);
    return [];
  }
}
