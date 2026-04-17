import type { Moment } from '@/types';
import { classifyTrend } from './classifier';

interface YouTubeVideoItem {
  snippet?: {
    title?: string;
    description?: string;
    channelTitle?: string;
    publishedAt?: string;
    thumbnails?: { high?: { url?: string }; maxres?: { url?: string } };
  };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
}

interface YouTubeResponse {
  items?: YouTubeVideoItem[];
  error?: { message?: string };
}

export async function fetchYouTubeTrends(): Promise<Moment[]> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return [];

  try {
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&chart=mostPopular&regionCode=IN&maxResults=50&videoCategoryId=0&key=${key}`;
    const res = await fetch(url, { next: { revalidate: 3600 } });

    if (!res.ok) {
      const text = await res.text();
      console.error(`YouTube trends error ${res.status}:`, text);
      return [];
    }

    const data = await res.json() as YouTubeResponse;

    if (data.error) {
      console.error('YouTube API error:', data.error.message);
      return [];
    }

    const VIRAL_VIEWS_THRESHOLD = 100_000;
    const items = data.items ?? [];
    const viral = items.filter(item => parseInt(item.statistics?.viewCount ?? '0') >= VIRAL_VIEWS_THRESHOLD);

    console.log(`[YouTube] Found ${viral.length} viral videos (≥${VIRAL_VIEWS_THRESHOLD.toLocaleString()} views) out of ${items.length} scraped`);

    return viral.map((item) => {
      const views = parseInt(item.statistics?.viewCount ?? '0');
      const likes = parseInt(item.statistics?.likeCount ?? '0');
      // 100k=85, 1M=91, 10M=97
      const score = Math.min(100, 55 + Math.floor(Math.log10(views) * 6));

      const thumb = item.snippet?.thumbnails?.maxres?.url ?? item.snippet?.thumbnails?.high?.url;

      return classifyTrend({
        name: (item.snippet?.title ?? 'YouTube Trending').slice(0, 100),
        description: `${item.snippet?.channelTitle ?? 'YouTube'} • ${views.toLocaleString()} views${likes > 0 ? ` • ${likes.toLocaleString()} likes` : ''}`,
        imageUrl: thumb,
        trendingScore: score,
        platform: 'YouTube',
      });
    }).filter((m): m is NonNullable<typeof m> => m !== null);
  } catch (e) {
    console.error('YouTube scraper failed:', e);
    return [];
  }
}
