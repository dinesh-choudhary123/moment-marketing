import type { Moment } from '@/types';
import { classifyTrend } from './classifier';
import { reserveCall, commitActual, releaseReservation } from '@/server/db/apify-spend';

const APIFY_BASE = 'https://api.apify.com/v2';

interface Tweet {
  text?: string;
  public_metrics?: {
    like_count?: number;
    retweet_count?: number;
    reply_count?: number;
    impression_count?: number;
    quote_count?: number;
  };
  entities?: {
    hashtags?: Array<{ tag?: string }>;
    annotations?: Array<{ normalized_text?: string; type?: string }>;
    urls?: Array<{ expanded_url?: string; images?: Array<{ url?: string }> }>;
  };
  attachments?: { media_keys?: string[] };
  created_at?: string;
}

interface TweetSearchResponse {
  data?: Tweet[];
  meta?: { result_count?: number; newest_id?: string };
  includes?: {
    media?: Array<{ media_key?: string; preview_image_url?: string; url?: string; type?: string }>;
  };
}

// ─── Trending queries covering IPL 2026, Bollywood, current affairs ───────
// Broad mix: sports, entertainment, viral, finance, tech — all India-relevant
// Sorted by expected engagement — first 5 are run, rest on slower refresh
const TRENDING_QUERIES = [
  // Live sports — IPL is April–May every year, massive engagement
  'IPL 2026 -is:retweet lang:en min_faves:100',
  // Bollywood always trending
  'Bollywood trending -is:retweet lang:en min_faves:200',
  // Cricket always massive in India
  'India cricket -is:retweet lang:en min_faves:200',
  // Viral & meme content
  'viral India -is:retweet lang:en min_faves:500',
  // Breaking news India
  'breaking India -is:retweet lang:en min_faves:300',
  // Tech news
  'trending tech India -is:retweet lang:en min_faves:100',
  // Finance / markets
  'Sensex Nifty trending -is:retweet lang:en min_faves:100',
  // Music
  'new song trending India -is:retweet lang:en min_faves:200',
  // Memes India
  '#memes India -is:retweet lang:en min_faves:300',
  // Business
  'startup India funding -is:retweet lang:en min_faves:100',
  // Fashion & lifestyle
  'fashion India trending -is:retweet lang:en min_faves:50',
  // Food trends
  'food recipe trending India -is:retweet lang:en min_faves:50',
  // Fitness & wellness
  'fitness wellness India -is:retweet lang:en min_faves:50',
  // Travel
  'travel India wanderlust -is:retweet lang:en min_faves:50',
  // Brand campaigns
  'brand campaign India viral -is:retweet lang:en min_faves:50',
  // OTT releases
  'OTT release India Netflix Prime -is:retweet lang:en min_faves:100',
  // Awards & events
  'award ceremony India 2026 -is:retweet lang:en min_faves:100',
  // Product launches
  'product launch India 2026 -is:retweet lang:en min_faves:50',
  // Finance & investment
  'finance investment India -is:retweet lang:en min_faves:100',
  // Politics trending
  'politics India trending 2026 -is:retweet lang:en min_faves:200',
];

// Free tier: 500k tweet reads/month. We run 5 queries × 100 tweets = 500/run.
// Running up to 10 times/day = 5000 reads/day = ~150k/month — well within limit.
const MAX_QUERIES_PER_RUN = 10;

// Lower threshold to capture medium-viral trends too — gives Low/Medium priority moments
const VIRAL_LIKES_THRESHOLD = 500;
// Only keep tweets created within the last 48 hours — "trending NOW"
const FRESHNESS_WINDOW_MS = 48 * 60 * 60 * 1000;
function isFresh(iso: string | undefined): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return !isNaN(t) && Date.now() - t <= FRESHNESS_WINDOW_MS;
}

function extractImageFromTweet(tweet: Tweet, includes?: TweetSearchResponse['includes']): string | undefined {
  if (!tweet.attachments?.media_keys?.length || !includes?.media) return undefined;
  const key = tweet.attachments.media_keys[0];
  const media = includes.media.find(m => m.media_key === key);
  return media?.url ?? media?.preview_image_url;
}

function buildTweetTitle(tweet: Tweet): string {
  // Prefer hashtags as title — concise and branded
  const hashtags = tweet.entities?.hashtags?.map(h => `#${h.tag}`);
  if (hashtags?.length) {
    return hashtags.slice(0, 4).join(' ');
  }
  // Use named entity annotations if available
  const annotations = tweet.entities?.annotations
    ?.filter(a => a.type === 'Organization' || a.type === 'Place' || a.type === 'Product')
    ?.map(a => a.normalized_text);
  if (annotations?.length) {
    const body = tweet.text?.replace(/https?:\/\/\S+/g, '').trim().slice(0, 80) ?? '';
    return body || annotations.join(', ');
  }
  // Fallback: first 80 chars of tweet body, strip URLs
  return (tweet.text ?? '').replace(/https?:\/\/\S+/g, '').replace(/\n/g, ' ').trim().slice(0, 80);
}

// ── Apify primary path — apidojo/tweet-scraper is cheap + no free-tier quota ──
interface ApifyTweet {
  text?: string;
  likeCount?: number;
  retweetCount?: number;
  replyCount?: number;
  quoteCount?: number;
  viewCount?: number;
  createdAt?: string;
  author?: { userName?: string; name?: string };
  hashtags?: string[];
  entities?: { hashtags?: Array<{ tag?: string }> };
  media?: Array<{ type?: string; url?: string; previewImageUrl?: string }>;
}

const APIFY_TWITTER_QUERIES = [
  'IPL 2026 min_faves:200 lang:en -is:retweet',
  'Bollywood min_faves:300 lang:en -is:retweet',
  'India cricket min_faves:300 lang:en -is:retweet',
  'viral India min_faves:500 lang:en -is:retweet',
  'breaking India min_faves:300 lang:en -is:retweet',
  '#trending India min_faves:200 lang:en -is:retweet',
  'new song India min_faves:200 lang:en -is:retweet',
  'Sensex Nifty min_faves:100 lang:en -is:retweet',
];

async function fetchViaApify(token: string): Promise<Moment[]> {
  // Reserve ~250 tweets @ $0.0004 = $0.10 budget slice
  const reservation = await reserveCall('apidojo/tweet-scraper', 250, 30);
  if (!reservation) {
    console.warn('[Twitter] Daily Apify $2 cap reached — falling back to X API');
    return [];
  }

  let tweets: ApifyTweet[] = [];
  try {
    const res = await fetch(
      `${APIFY_BASE}/acts/apidojo~tweet-scraper/run-sync-get-dataset-items?timeout=300&format=json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          searchTerms: APIFY_TWITTER_QUERIES,
          maxItems: reservation.safeLimit,
          sort: 'Latest',
          tweetLanguage: 'en',
        }),
        signal: AbortSignal.timeout(310_000),
      },
    );
    if (!res.ok) {
      const t = await res.text();
      console.error(`[Twitter] Apify error ${res.status}:`, t.slice(0, 300));
      await releaseReservation(reservation);
      return [];
    }
    tweets = await res.json() as ApifyTweet[];
  } catch (e) {
    console.error('[Twitter] Apify fetch failed:', e);
    await releaseReservation(reservation);
    return [];
  }
  await commitActual(reservation, tweets.length);

  const results: Moment[] = [];
  const seenNames = new Set<string>();

  const viral = tweets
    .filter(t => t.text && isFresh(t.createdAt) && (t.likeCount ?? 0) >= VIRAL_LIKES_THRESHOLD)
    .sort((a, b) => ((b.likeCount ?? 0) + (b.retweetCount ?? 0) * 3) - ((a.likeCount ?? 0) + (a.retweetCount ?? 0) * 3));

  for (const tweet of viral.slice(0, 50)) {
    const likes = tweet.likeCount ?? 0;
    const rts = tweet.retweetCount ?? 0;
    const replies = tweet.replyCount ?? 0;
    const quotes = tweet.quoteCount ?? 0;
    const engagement = likes + rts * 3 + replies + quotes * 2;
    const score = Math.min(100, 50 + Math.floor(Math.log10(engagement + 1) * 10));

    // Title preference: hashtags > clean text
    const hashtags = (tweet.entities?.hashtags?.map(h => h.tag) ?? tweet.hashtags ?? []).filter(Boolean) as string[];
    const titleFromTags = hashtags.slice(0, 4).map(t => `#${t}`).join(' ');
    const cleanText = (tweet.text ?? '').replace(/https?:\/\/\S+/g, '').replace(/\n/g, ' ').trim();
    const name = titleFromTags || cleanText.slice(0, 80);
    const nameKey = name.toLowerCase().trim();
    if (!name || seenNames.has(nameKey)) continue;
    seenNames.add(nameKey);

    const image = tweet.media?.find(m => m.type === 'photo' || m.type === 'video');
    const imageUrl = image?.url ?? image?.previewImageUrl;
    const hashtagStr = hashtags.slice(0, 3).map(t => `#${t}`).join(' ');
    const description = `${cleanText} • ${likes.toLocaleString()} likes • ${rts.toLocaleString()} RTs${hashtagStr ? ' • ' + hashtagStr : ''}`;

    const moment = classifyTrend({
      name,
      description: description.slice(0, 300),
      imageUrl,
      trendingScore: score,
      platform: 'Twitter',
      originDate: tweet.createdAt,
    });
    if (moment) results.push(moment);
  }

  console.log(`[Twitter] Apify returned ${tweets.length} tweets → ${results.length} viral (≥${VIRAL_LIKES_THRESHOLD} likes, <48h)`);
  return results;
}

export async function fetchTwitterTrends(): Promise<Moment[]> {
  // Prefer Apify — X API free tier is only 100 reads/month and exhausts fast.
  const apifyToken = process.env.APIFY_TOKEN;
  if (apifyToken) {
    const apifyResults = await fetchViaApify(apifyToken);
    if (apifyResults.length > 0) return apifyResults;
    console.warn('[Twitter] Apify returned 0 — trying X API fallback');
  }

  const token = process.env.TWITTER_BEARER_TOKEN;
  if (!token) {
    console.warn('[Twitter] Neither APIFY_TOKEN nor TWITTER_BEARER_TOKEN usable — skipping');
    return [];
  }

  const results: Moment[] = [];
  const seenNames = new Set<string>();

  for (const query of TRENDING_QUERIES.slice(0, MAX_QUERIES_PER_RUN)) {
    try {
      const params = new URLSearchParams({
        query,
        max_results: '100',
        sort_order: 'relevancy',
        'tweet.fields': 'public_metrics,entities,attachments,created_at',
        'expansions': 'attachments.media_keys',
        'media.fields': 'preview_image_url,url,type',
      });

      const url = `https://api.twitter.com/2/tweets/search/recent?${params}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        // 402 = monthly credits depleted; 403 = plan restriction — stop silently
        if (res.status === 402 || res.status === 403) {
          console.warn(`[Twitter] API limit or plan restriction (${res.status}) — stopping`);
          break;
        }
        const text = await res.text();
        console.warn(`[Twitter] Query "${query}" → ${res.status}:`, text.slice(0, 150));
        continue;
      }

      const data = await res.json() as TweetSearchResponse;
      const tweets = data.data ?? [];

      // Filter by freshness (< 48h) + viral threshold
      const viral = tweets
        .filter(t => isFresh(t.created_at) && (t.public_metrics?.like_count ?? 0) >= VIRAL_LIKES_THRESHOLD)
        .sort((a, b) => {
          const aScore = (a.public_metrics?.like_count ?? 0) + (a.public_metrics?.retweet_count ?? 0) * 3;
          const bScore = (b.public_metrics?.like_count ?? 0) + (b.public_metrics?.retweet_count ?? 0) * 3;
          return bScore - aScore;
        });

      for (const tweet of viral.slice(0, 15)) {
        const likes = tweet.public_metrics?.like_count ?? 0;
        const rts = tweet.public_metrics?.retweet_count ?? 0;
        const replies = tweet.public_metrics?.reply_count ?? 0;
        const quotes = tweet.public_metrics?.quote_count ?? 0;
        const engagement = likes + rts * 3 + replies + quotes * 2;

        // Score: 1k eng=70, 10k=83, 100k=93, 1M=100
        const score = Math.min(100, 50 + Math.floor(Math.log10(engagement + 1) * 10));

        const name = buildTweetTitle(tweet);
        const nameKey = name.toLowerCase().trim();
        if (!name || seenNames.has(nameKey)) continue;
        seenNames.add(nameKey);

        const imageUrl = extractImageFromTweet(tweet, data.includes);
        const hashtags = tweet.entities?.hashtags?.slice(0, 3).map(h => `#${h.tag}`).join(' ') ?? '';
        const description = `${tweet.text?.replace(/https?:\/\/\S+/g, '').trim() ?? ''} • ${likes.toLocaleString()} likes • ${rts.toLocaleString()} RTs${hashtags ? ' • ' + hashtags : ''}`;

        const moment = classifyTrend({
          name,
          description: description.slice(0, 300),
          imageUrl,
          trendingScore: score,
          platform: 'Twitter',
          originDate: tweet.created_at,
        });
        if (moment) results.push(moment);
      }
    } catch (e) {
      console.warn(`[Twitter] Query "${query}" failed:`, e);
    }
  }

  console.log(`[Twitter] Found ${results.length} viral tweets (≥${VIRAL_LIKES_THRESHOLD.toLocaleString()} likes)`);
  return results;
}
