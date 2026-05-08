// Shared image resolution utility for all trend scrapers.
//
// Resolution chain (all free, zero quota cost):
//   1. Wikipedia pageimages API — topic-exact for named entities (people, events, films)
//   2. Bing News RSS — news thumbnails, great for trending events
//   3. Returns undefined — classifyTrend() calls getSmartFallbackImage() → curated Unsplash
//
// YouTube search.list was removed: it costs 100 quota units/call and exhausted the full
// 10,000-unit daily quota on image lookups when 50+ trends run at startup.

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

    // Try <media:thumbnail url="…">
    const thumbMatch = xml.match(/<media:thumbnail[^>]+url="([^"]+)"/i);
    if (thumbMatch?.[1]) {
      const src = thumbMatch[1];
      if (src.startsWith('http') && !usedImageUrls.has(src)) {
        usedImageUrls.add(src);
        return src;
      }
    }

    // Try <media:content url="…">
    const mediaMatch = xml.match(/<media:content[^>]+url="([^"]+)"/i);
    if (mediaMatch?.[1]) {
      const src = mediaMatch[1];
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

// YouTube search.list was removed from fetchTopicImage — it costs 100 quota units per call
// (vs 1 unit for the trending chart). With 50+ trends per scrape, it exhausted the entire
// 10,000-unit daily quota on image lookups alone. Wikipedia + Bing News are free replacements.

/**
 * Fetch a topic-relevant image for `keyword` with zero quota cost.
 * Chain: Wikipedia → Bing News → undefined (classifier uses curated Unsplash).
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
