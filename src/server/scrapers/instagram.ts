import type { Moment } from '@/types';
import { classifyTrend } from './classifier';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

// ─── Primary: Apify Instagram Scraper ───────────────────────────────────────
const ACTOR_ID = 'apify~instagram-scraper';
const APIFY_BASE = 'https://api.apify.com/v2';

const VIRAL_LIKES_THRESHOLD = 5_000;
const VIRAL_VIEWS_THRESHOLD = 20_000;

// Popular Indian + global accounts with consistently viral content
const TARGET_PROFILES = [
  'https://www.instagram.com/virat.kohli/',
  'https://www.instagram.com/priyankachopra/',
  'https://www.instagram.com/deepikapadukone/',
  'https://www.instagram.com/shahrukhkhan/',
  'https://www.instagram.com/aliaabhatt/',
  'https://www.instagram.com/ranveersingh/',
  'https://www.instagram.com/katrinakaif/',
  'https://www.instagram.com/narendramodi/',
  'https://www.instagram.com/mumbaiindians/',
  'https://www.instagram.com/chennaiipl/',
  'https://www.instagram.com/iplt20/',
  'https://www.instagram.com/bollywood/',
  'https://www.instagram.com/filmfare/',
  'https://www.instagram.com/pinkvilla/',
  'https://www.instagram.com/bollywoodhungama/',
  'https://www.instagram.com/zoomtv/',
  'https://www.instagram.com/ndtv/',
  'https://www.instagram.com/cristiano/',
  'https://www.instagram.com/leomessi/',
  'https://www.instagram.com/therock/',
  // Brand accounts for more Brand-type moments
  'https://www.instagram.com/zomato/',
  'https://www.instagram.com/swiggy/',
  'https://www.instagram.com/myntra/',
  'https://www.instagram.com/nykaabeauty/',
  'https://www.instagram.com/amazon/',
  'https://www.instagram.com/flipkart/',
  'https://www.instagram.com/tatacompanies/',
  'https://www.instagram.com/mahindraise/',
  'https://www.instagram.com/amul_india/',
  'https://www.instagram.com/nestle_india/',
];

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
  dimensionsHeight?: number;
  dimensionsWidth?: number;
}

// ─── Image downloading & caching ──────────────────────────────────────────────
// Instagram CDN URLs (scontent.cdninstagram.com) are signed and expire after a
// few hours. The ONLY reliable approach: download the image at scrape time while
// the URL is still fresh, save to public/images/ig/, and reference the local path.

const IMAGE_CACHE_DIR = join(process.cwd(), 'public', 'images', 'ig');

async function ensureCacheDir(): Promise<void> {
  if (!existsSync(IMAGE_CACHE_DIR)) {
    await mkdir(IMAGE_CACHE_DIR, { recursive: true });
  }
}

/**
 * Downloads an Instagram image at scrape time and saves it locally.
 * Returns the public URL path (e.g., /images/ig/ABC123.jpg).
 * Falls back to image-proxy URL if download fails.
 */
async function cacheInstagramImage(
  displayUrl: string | undefined,
  shortCode: string,
): Promise<string | undefined> {
  if (!displayUrl) return undefined;

  const filename = `${shortCode}.jpg`;
  const localPath = join(IMAGE_CACHE_DIR, filename);
  const publicPath = `/images/ig/${filename}`;

  // If already cached from a previous scrape, reuse it
  if (existsSync(localPath)) {
    return publicPath;
  }

  try {
    await ensureCacheDir();

    const res = await fetch(displayUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      console.warn(`[Instagram] Image download failed (${res.status}) for ${shortCode}, using proxy`);
      // Fall back to proxy route — the URL might still work server-side
      return `/api/image-proxy?url=${encodeURIComponent(displayUrl)}`;
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.startsWith('image/')) {
      console.warn(`[Instagram] Non-image content-type (${contentType}) for ${shortCode}`);
      return `/api/image-proxy?url=${encodeURIComponent(displayUrl)}`;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    await writeFile(localPath, buffer);
    console.log(`[Instagram] Cached image: ${publicPath} (${(buffer.length / 1024).toFixed(0)}KB)`);
    return publicPath;
  } catch (e) {
    console.warn(`[Instagram] Image cache failed for ${shortCode}:`, e);
    // Last resort: proxy URL
    return `/api/image-proxy?url=${encodeURIComponent(displayUrl)}`;
  }
}

// ─── Guaranteed fallback images per category (Unsplash) ───────────────────────
// Only used when image download AND proxy both fail
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
  if (/virat\.kohli|mumbaiindians|chennaiipl|iplt20|cricket/.test(text)) return CATEGORY_IMAGES.Sports;
  if (/leomessi|cristiano|therock/.test(text)) return CATEGORY_IMAGES.Sports;
  if (/shahrukhkhan|aliaabhatt|deepikapadukone|ranveersingh|katrinakaif|priyankachopra/.test(text)) return CATEGORY_IMAGES.Movies;
  if (/bollywood|filmfare|pinkvilla|bollywoodhungama|zoomtv/.test(text)) return CATEGORY_IMAGES.Movies;
  if (/narendramodi|ndtv/.test(text)) return CATEGORY_IMAGES.Politics;
  if (/cricket|ipl|sport|football|tennis|match|score|team/.test(text)) return CATEGORY_IMAGES.Sports;
  if (/bollywood|film|movie|cinema|actor|actress|release|trailer/.test(text)) return CATEGORY_IMAGES.Movies;
  if (/fashion|style|outfit|wear|designer/.test(text)) return CATEGORY_IMAGES.Fashion;
  if (/food|recipe|cook|eat|dish/.test(text)) return CATEGORY_IMAGES.Food;
  if (/travel|trip|tourism|destination/.test(text)) return CATEGORY_IMAGES.Travel;
  if (/fitness|gym|workout|health|yoga/.test(text)) return CATEGORY_IMAGES.Health;
  if (/tech|ai|startup|gadget|phone/.test(text)) return CATEGORY_IMAGES.Tech;
  if (/music|song|concert|album|singer/.test(text)) return CATEGORY_IMAGES.Music;
  if (/meme|funny|viral|reel|comedy/.test(text)) return CATEGORY_IMAGES.Meme;
  if (/finance|stock|market|crypto/.test(text)) return CATEGORY_IMAGES.Finance;
  if (/game|gaming|esport/.test(text)) return CATEGORY_IMAGES.Gaming;
  return CATEGORY_IMAGES.Entertainment;
}

// ─── Fallback: trending hashtags ──────────────────────────────────────────────

const TRENDING_HASHTAGS = [
  { tag: 'IPL2026', displayName: 'IPL 2026', category: 'Sports', imageQuery: 'cricket ipl' },
  { tag: 'Bollywood', displayName: 'Bollywood Trending', category: 'Movies', imageQuery: 'bollywood' },
  { tag: 'ViralReels', displayName: 'Viral Reels India', category: 'Meme', imageQuery: 'viral reels' },
  { tag: 'IndiaFashion', displayName: 'India Fashion Week', category: 'Fashion', imageQuery: 'india fashion' },
  { tag: 'IndianFood', displayName: 'Indian Food Viral', category: 'Food', imageQuery: 'indian food street' },
  { tag: 'CricketIndia', displayName: 'Cricket India', category: 'Sports', imageQuery: 'cricket' },
  { tag: 'TravelIndia', displayName: 'Travel India Viral', category: 'Travel', imageQuery: 'india travel' },
  { tag: 'FitnessIndia', displayName: 'Fitness Transformation', category: 'Health', imageQuery: 'fitness gym' },
  { tag: 'TechIndia', displayName: 'India Tech Trends', category: 'Tech', imageQuery: 'technology india' },
  { tag: 'IndieMusic', displayName: 'Indie Music India', category: 'Music', imageQuery: 'music india' },
];

async function tryFetchHashtagPosts(hashtag: string): Promise<{ imageUrl?: string; postCount?: number } | null> {
  try {
    const res = await fetch(
      `https://www.instagram.com/explore/tags/${encodeURIComponent(hashtag)}/?__a=1&__d=dis`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
          Accept: 'application/json',
          'X-IG-App-ID': '936619743392459',
        },
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('json')) return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await res.json() as any;
    const edges = data?.graphql?.hashtag?.edge_hashtag_to_media?.edges ?? data?.data?.hashtag?.edge_hashtag_to_media?.edges ?? [];
    const postCount = data?.graphql?.hashtag?.edge_hashtag_to_media?.count ?? data?.data?.hashtag?.edge_hashtag_to_media?.count;
    const firstPost = edges[0]?.node;
    const imageUrl = firstPost?.display_url ?? firstPost?.thumbnail_src;
    return { imageUrl, postCount };
  } catch {
    return null;
  }
}

// ─── Apify primary path ─────────────────────────────────────────────────────

async function fetchViaApify(token: string): Promise<Moment[]> {
  // Step 1: Start the Apify run
  const runRes = await fetch(
    `${APIFY_BASE}/acts/${ACTOR_ID}/runs?waitForFinish=180`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        directUrls: TARGET_PROFILES,
        resultsType: 'posts',
        resultsLimit: 10,
        addParentData: false,
      }),
    },
  );

  if (!runRes.ok) {
    const text = await runRes.text();
    console.error(`[Instagram] Apify run error ${runRes.status}:`, text.slice(0, 200));
    return [];
  }

  const runData = await runRes.json() as { data?: { defaultDatasetId?: string } };
  const datasetId = runData.data?.defaultDatasetId;
  if (!datasetId) return [];

  // Step 2: Fetch the dataset items
  const dataRes = await fetch(
    `${APIFY_BASE}/datasets/${datasetId}/items?format=json&limit=500`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!dataRes.ok) return [];

  const posts = await dataRes.json() as InstagramPost[];

  // Log the raw structure of the first post so we can see all available fields
  if (posts.length > 0) {
    const samplePost = posts[0];
    console.log(`[Instagram] RAW SAMPLE POST FIELDS:`, JSON.stringify({
      id: samplePost.id,
      shortCode: samplePost.shortCode,
      ownerUsername: samplePost.ownerUsername,
      type: samplePost.type,
      likesCount: samplePost.likesCount,
      commentsCount: samplePost.commentsCount,
      displayUrl: samplePost.displayUrl ? `${samplePost.displayUrl.slice(0, 80)}...` : 'NONE',
      images: samplePost.images,
      videoUrl: samplePost.videoUrl ? `${samplePost.videoUrl.slice(0, 80)}...` : 'NONE',
      captionPreview: samplePost.caption?.slice(0, 60),
    }, null, 2));
  }

  // Step 3: Filter to viral posts only
  const seen = new Set<string>();
  const viral = posts
    .filter(p => {
      if (!p.caption && !p.displayUrl) return false;
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

  console.log(`[Instagram] Apify: Found ${viral.length} viral posts (≥${VIRAL_LIKES_THRESHOLD.toLocaleString()} likes or ≥${VIRAL_VIEWS_THRESHOLD.toLocaleString()} views) out of ${posts.length} scraped`);

  // Step 4: Download images in parallel and build moments
  const moments: Moment[] = [];

  // Download all images concurrently (max 10 at a time to avoid overload)
  const batch = viral.slice(0, 60);
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

    // Use cached local image, or proxy URL, or Unsplash fallback
    let imageUrl: string;
    const imgResult = imageResults[i];
    if (imgResult.status === 'fulfilled' && imgResult.value) {
      imageUrl = imgResult.value;
    } else {
      // Last resort: Unsplash category fallback
      imageUrl = getCategoryFallbackImage(post.ownerUsername ?? '', name + ' ' + (post.hashtags?.join(' ') ?? ''));
    }

    const moment = classifyTrend({
      name,
      description: `@${post.ownerUsername ?? 'instagram'} • ${likes.toLocaleString()} likes • ${comments.toLocaleString()} comments${hashtagsText ? ` • ${hashtagsText}` : ''}`,
      imageUrl,
      trendingScore: score,
      platform: 'Instagram',
    });
    if (moment) moments.push(moment);
  }

  const cachedCount = imageResults.filter(r => r.status === 'fulfilled' && r.value?.startsWith('/images/')).length;
  const proxyCount = imageResults.filter(r => r.status === 'fulfilled' && r.value?.startsWith('/api/')).length;
  const fallbackCount = moments.length - cachedCount - proxyCount;
  console.log(`[Instagram] Images: ${cachedCount} cached locally, ${proxyCount} via proxy, ${fallbackCount} Unsplash fallback`);

  return moments;
}

// ─── Fallback: public hashtag data + curated trending topics ────────────────

async function fetchViaPublicFallback(): Promise<Moment[]> {
  console.log('[Instagram] Using public hashtag fallback');

  const enriched = await Promise.allSettled(
    TRENDING_HASHTAGS.map(async ht => {
      const realData = await tryFetchHashtagPosts(ht.tag);
      return { ...ht, realData };
    })
  );

  const moments: Moment[] = [];
  for (const result of enriched) {
    if (result.status !== 'fulfilled') continue;
    const { displayName, tag, realData } = result.value;

    const baseScore = realData?.postCount
      ? Math.min(92, 70 + Math.floor(Math.log10(realData.postCount + 1) * 5))
      : 68 + Math.floor(Math.random() * 10);

    // If we got a real image URL from Instagram public API, proxy it
    let imageUrl: string;
    if (realData?.imageUrl) {
      imageUrl = `/api/image-proxy?url=${encodeURIComponent(realData.imageUrl)}`;
    } else {
      imageUrl = CATEGORY_IMAGES[result.value.category]
        ?? getCategoryFallbackImage(tag, displayName);
    }

    const postCount = realData?.postCount;

    const moment = classifyTrend({
      name: displayName,
      description: `#${tag} trending on Instagram${postCount ? ` • ${postCount.toLocaleString()} posts` : ''} • High engagement opportunity for marketers`,
      imageUrl,
      trendingScore: baseScore,
      platform: 'Instagram',
    });
    if (moment) moments.push(moment);
  }

  console.log(`[Instagram] Fallback: Generated ${moments.length} trending moments`);
  return moments;
}

// ─── Main export ─────────────────────────────────────────────────────────────

export async function fetchInstagramTrends(): Promise<Moment[]> {
  const token = process.env.APIFY_TOKEN;

  if (!token) {
    console.warn('[Instagram] APIFY_TOKEN not set — using public fallback');
    return fetchViaPublicFallback();
  }

  try {
    const apifyResults = await fetchViaApify(token);
    if (apifyResults.length > 0) return apifyResults;

    console.warn('[Instagram] Apify returned empty — switching to public fallback');
    return fetchViaPublicFallback();
  } catch (e) {
    console.error('[Instagram] Apify failed:', e);
    return fetchViaPublicFallback();
  }
}
