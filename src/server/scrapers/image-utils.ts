// Shared image resolution utility for all trend scrapers.
//
// Resolution chain:
//   1. Wikipedia pageimages API — free, topic-exact when it works
//   2. Bing News RSS — news article thumbnails, very relevant for trending events
//   3. Returns undefined — classifyTrend() in classifier.ts then calls
//      getSmartFallbackImage() which has curated, category-matched Unsplash images.
//      This is ALWAYS better than a grey SVG with text.

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
 * Fetch a topic-relevant image for `keyword`.
 *
 * Resolution chain:
 *   1. Wikipedia pageimages API — great for named entities (people, places, films)
 *   2. Bing News RSS thumbnail — great for trending events and news topics
 *   3. Returns undefined → classifyTrend calls getSmartFallbackImage() → curated Unsplash
 *
 * Retries Wikipedia once on network failure.
 * Deduplicates returned URLs across the current run.
 */
export async function fetchTopicImage(keyword: string): Promise<string | undefined> {
  const clean = keyword
    .replace(/^#/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]/g, ' ')
    .trim();
  if (!clean || clean.length < 2) return undefined;

  // ── 1. Wikipedia pageimages API ──────────────────────────────────────────────
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
          return src;
        }
      }
    } catch {
      // Network error — retry on attempt 0, give up on attempt 1
    }
  }

  // ── 2. Bing News RSS thumbnail ───────────────────────────────────────────────
  const bingImage = await fetchBingNewsImage(clean);
  if (bingImage) return bingImage;

  // ── 3. Return undefined → classifier uses curated Unsplash fallback ──────────
  return undefined;
}
