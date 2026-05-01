// Shared image resolution utility for all trend scrapers.
//
// Resolution chain:
//   1. YouTube Data API search — most visually relevant, topic-exact thumbnail
//   2. Wikipedia pageimages API — free, topic-exact when it works
//   3. Bing News RSS — news article thumbnails, very relevant for trending events
//   4. Returns undefined — classifyTrend() in classifier.ts then calls
//      getSmartFallbackImage() which has curated, category-matched Unsplash images.

// Per-run dedup set — prevents the same image URL appearing on multiple cards.
// Cleared via resetImageDedup() at the start of each runAllScrapers() call.
const usedImageUrls = new Set<string>();

export function resetImageDedup(): void {
  usedImageUrls.clear();
}

export function trackImage(url: string): void {
  usedImageUrls.add(url);
}

/**
 * Fetch a topic-relevant news image from Bing News RSS.
 * Returns the first <enclosure> image URL found, or undefined.
 */
async function fetchBingNewsImage(keyword: string): Promise<string | undefined> {
  try {
    const url = `https://www.bing.com/news/search?q=${encodeURIComponent(keyword)}&format=RSS`;
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return undefined;
    const xml = await res.text();

    // Try <enclosure url="…"> first (standard RSS image attachment)
    const enclosureMatch = xml.match(/<enclosure[^>]+url="([^"]+)"/i);
    if (enclosureMatch?.[1]) {
      const src = enclosureMatch[1];
      if (src.startsWith('http') && !usedImageUrls.has(src)) {
        usedImageUrls.add(src);
        return src;
      }
    }

    // Fallback: any image URL in the first <item> block
    const firstItem = xml.match(/<item>([\s\S]*?)<\/item>/i)?.[1] ?? '';
    const urlMatch = firstItem.match(
      /url="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)(?:[^"]{0,50})?)"/i,
    );
    if (urlMatch?.[1]) {
      const src = urlMatch[1];
      if (!usedImageUrls.has(src)) {
        usedImageUrls.add(src);
        return src;
      }
    }
  } catch {
    // Silent — network errors are expected
  }
  return undefined;
}

/**
 * Search YouTube for the keyword and return the best video thumbnail.
 * Uses the YOUTUBE_API_KEY env variable (same one the YouTube scraper uses).
 * YouTube thumbnails are the most visually relevant source for any trending topic.
 */
async function fetchYouTubeThumbnail(keyword: string): Promise<string | undefined> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return undefined;

  try {
    const url = [
      'https://www.googleapis.com/youtube/v3/search',
      '?part=snippet',
      `&q=${encodeURIComponent(keyword)}`,
      '&type=video',
      '&maxResults=1',
      '&safeSearch=moderate',
      `&key=${apiKey}`,
    ].join('');

    const res = await fetch(url, { signal: AbortSignal.timeout(6_000) });
    if (!res.ok) return undefined;

    const data = await res.json() as {
      items?: Array<{
        snippet?: {
          thumbnails?: {
            high?: { url?: string };
            medium?: { url?: string };
          };
        };
      }>;
    };

    const thumb =
      data?.items?.[0]?.snippet?.thumbnails?.high?.url ??
      data?.items?.[0]?.snippet?.thumbnails?.medium?.url;

    if (thumb && !usedImageUrls.has(thumb)) {
      usedImageUrls.add(thumb);
      return thumb;
    }
  } catch {
    // Silent — network or quota errors
  }
  return undefined;
}

/**
 * Fetch a topic-relevant image for `keyword`.
 *
 * Resolution chain:
 *   1. YouTube Data API search thumbnail — most visually specific for any trending topic
 *   2. Wikipedia pageimages API — great for named entities (people, places, films)
 *   3. Bing News RSS thumbnail — great for trending events and news topics
 *   4. Returns undefined → classifyTrend calls getSmartFallbackImage() → curated Unsplash
 *
 * Retries Wikipedia once on network failure.
 * Deduplicates returned URLs across the current run.
 */
/** Wrap any external image URL through our server-side proxy to avoid hotlink blocks */
function proxyUrl(url: string): string {
  if (url.startsWith('/')) return url; // already local
  return `/api/image-proxy?url=${encodeURIComponent(url)}`;
}

export async function fetchTopicImage(keyword: string): Promise<string | undefined> {
  const clean = keyword
    .replace(/^#/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]/g, ' ')
    .trim();
  if (!clean || clean.length < 2) return undefined;

  // ── 1. YouTube search thumbnail ──────────────────────────────────────────────
  // Best for Reddit text posts, meme topics, discussions — always visually specific
  const ytThumb = await fetchYouTubeThumbnail(clean);
  if (ytThumb) return proxyUrl(ytThumb);

  // ── 2. Wikipedia pageimages API ──────────────────────────────────────────────
  const wikiUrl = [
    'https://en.wikipedia.org/w/api.php',
    '?action=query&generator=search',
    `&gsrsearch=${encodeURIComponent(clean)}`,
    '&gsrlimit=1&prop=pageimages&format=json&pithumbsize=800&redirects=1',
  ].join('');

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(wikiUrl, { signal: AbortSignal.timeout(6_000) });
      if (res.ok) {
        const data = await res.json() as {
          query?: { pages?: Record<string, { thumbnail?: { source?: string } }> };
        };
        const pages = data?.query?.pages ?? {};
        const src = (Object.values(pages)[0] as { thumbnail?: { source?: string } } | undefined)
          ?.thumbnail?.source;
        if (src && !usedImageUrls.has(src)) {
          usedImageUrls.add(src);
          return proxyUrl(src);
        }
      }
    } catch {
      // Network error — retry on attempt 0, give up on attempt 1
    }
  }

  // ── 3. Bing News RSS thumbnail ──────────────────────────────────────────────
  const bingImage = await fetchBingNewsImage(clean);
  if (bingImage) return proxyUrl(bingImage);

  // ── 4. Return undefined → classifier uses curated Unsplash fallback ──────────
  return undefined;
}
