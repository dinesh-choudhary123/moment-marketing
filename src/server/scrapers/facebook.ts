import type { Moment } from '@/types';
import { classifyTrend } from './classifier';
import { fetchTopicImage } from './image-utils';

// ─── Facebook scraper ─────────────────────────────────────────────────────────
// Primary  : ScrapeGraphAI extract() — scrapes Facebook hashtag pages AND public
//            brand/marketing pages using AI-powered extraction.
// Fallback : RSS from established marketing publications (afaqs!, Adweek, etc.)
// Last     : Seed hashtag cards.

const HASHTAGS = [
  'momentmarketing', 'moment', 'marketingmentor', 'kitkat',
  'advertising', 'outdooradvertising', 'marketing', 'creativeads',
];

// All 8 hashtag search URLs
const HASHTAG_URLS = HASHTAGS.map(tag => ({
  tag,
  url: `https://www.facebook.com/hashtag/${tag}`,
  type: 'hashtag' as const,
}));

// Public brand/marketing pages — no login needed for basic post view
const BRAND_PAGE_URLS = [
  { tag: 'amul',        url: 'https://www.facebook.com/amul.india',                type: 'page' as const },
  { tag: 'zomato',      url: 'https://www.facebook.com/ZomatoIN',                  type: 'page' as const },
  { tag: 'adweek',      url: 'https://www.facebook.com/adweek',                    type: 'page' as const },
  { tag: 'afaqs',       url: 'https://www.facebook.com/afaqs',                     type: 'page' as const },
  { tag: 'fevicol',     url: 'https://www.facebook.com/Fevicol',                   type: 'page' as const },
  { tag: 'creativegaga',url: 'https://www.facebook.com/creativegaga',              type: 'page' as const },
];

// ─── Plain JSON Schema for extraction ────────────────────────────────────────

const FB_POSTS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    posts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text:          { type: 'string',  description: 'Post caption or text content' },
          authorName:    { type: 'string',  description: 'Name of the page or profile that posted' },
          authorUrl:     { type: 'string',  description: 'Profile URL of the author' },
          postUrl:       { type: 'string',  description: 'Direct link to this post' },
          imageUrl:      { type: 'string',  description: 'Main image URL from the post' },
          likesCount:    { type: 'number',  description: 'Number of likes or reactions' },
          commentsCount: { type: 'number',  description: 'Number of comments' },
          date:          { type: 'string',  description: 'Post date or time ago string' },
        },
        required: ['text', 'authorName'],
      },
      description: 'List of Facebook posts visible on this page',
    },
  },
  required: ['posts'],
};

interface FbPost {
  text: string;
  authorName: string;
  authorUrl?: string;
  postUrl?: string;
  imageUrl?: string;
  likesCount?: number;
  commentsCount?: number;
  date?: string;
}

// ─── ScrapeGraphAI helper ─────────────────────────────────────────────────────

async function scrapeOnePage(
  apiKey: string,
  tag: string,
  url: string,
  type: 'hashtag' | 'page',
): Promise<FbPost[]> {
  try {
    const { extract } = await import('scrapegraph-js');

    const prompt = type === 'hashtag'
      ? `This is a Facebook hashtag page for #${tag}. Extract all visible posts. ` +
        `For each post get: the full post text or caption, the author page/profile name, ` +
        `author profile URL, direct post URL, the main image URL, ` +
        `number of likes or reactions, number of comments, and the date posted. ` +
        `Return up to 12 posts. If the page asks you to log in, extract whatever is visible before the login wall.`
      : `This is a public Facebook page for a brand or publication. Extract their recent posts. ` +
        `For each post get: the full post text or caption, the page name (author), ` +
        `the page URL as author URL, direct post URL, the main image URL, ` +
        `number of likes or reactions, number of comments, and the date posted. ` +
        `Return up to 8 posts. Focus on marketing, advertising, and brand-related content.`;

    console.log(`[Facebook] SGAI extracting ${type} #${tag}: ${url}`);
    const response = await extract(apiKey, {
      url,
      prompt,
      schema: FB_POSTS_JSON_SCHEMA,
      mode: 'normal',
    });

    if (response.status !== 'success' || !response.data?.json) {
      console.warn(`[Facebook] SGAI ${type} #${tag} failed:`, response.error ?? 'no data');
      return [];
    }

    const raw = response.data.json as { posts?: unknown[] };
    const posts: FbPost[] = (raw?.posts ?? []) as FbPost[];

    console.log(`[Facebook] SGAI ${type} #${tag} → ${posts.length} posts`);
    return posts.filter(p => p.text && p.text.length > 5);
  } catch (e) {
    console.error(`[Facebook] SGAI error for ${tag}:`, e);
    return [];
  }
}

// ─── Primary: ScrapeGraphAI ───────────────────────────────────────────────────

async function fetchViaScrapeGraphAI(apiKey: string): Promise<Moment[]> {
  // First try all 8 hashtag URLs
  const allTargets = [...HASHTAG_URLS, ...BRAND_PAGE_URLS];
  const allPosts: Array<FbPost & { tag: string }> = [];

  // Process hashtag pages first (run in batches of 3 to avoid rate limits)
  const hashtagBatchSize = 3;
  for (let i = 0; i < HASHTAG_URLS.length; i += hashtagBatchSize) {
    const batch = HASHTAG_URLS.slice(i, i + hashtagBatchSize);
    const batchResults = await Promise.all(
      batch.map(({ tag, url, type }) => scrapeOnePage(apiKey, tag, url, type)),
    );
    for (let j = 0; j < batch.length; j++) {
      for (const p of batchResults[j]) allPosts.push({ ...p, tag: batch[j].tag });
    }
    if (allPosts.length >= 30) break;
  }

  // If hashtag pages gave < 5 posts, also try public brand pages
  if (allPosts.length < 5) {
    console.log('[Facebook] Hashtag pages returned few posts — also scraping brand pages...');
    const brandBatchSize = 3;
    for (let i = 0; i < BRAND_PAGE_URLS.length; i += brandBatchSize) {
      const batch = BRAND_PAGE_URLS.slice(i, i + brandBatchSize);
      const batchResults = await Promise.all(
        batch.map(({ tag, url, type }) => scrapeOnePage(apiKey, tag, url, type)),
      );
      for (let j = 0; j < batch.length; j++) {
        for (const p of batchResults[j]) allPosts.push({ ...p, tag: batch[j].tag });
      }
      if (allPosts.length >= 30) break;
    }
  }

  console.log(`[Facebook] SGAI total: ${allPosts.length} posts from ${allTargets.length} sources`);
  if (allPosts.length === 0) return [];

  // Dedupe by text
  const seen = new Set<string>();
  const unique = allPosts.filter(p => {
    const key = p.text.slice(0, 80).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Resolve images
  const imageUrls = await Promise.all(
    unique.map(p => {
      if (p.imageUrl?.startsWith('http')) return Promise.resolve(p.imageUrl);
      return fetchTopicImage(`${p.tag} marketing advertising`);
    }),
  );

  const mapped = unique.map((p, idx) => {
    const pageName = p.authorName || 'Facebook Page';
    const pageUrl  = p.authorUrl  || `https://www.facebook.com/${p.tag}`;

    const engagement = (p.likesCount ?? 0) + (p.commentsCount ?? 0) * 3;
    const score = Math.min(100, 65 + Math.floor(Math.log10(Math.max(engagement, 1) + 1) * 8));

    const name        = p.text.slice(0, 100) || `${pageName} on Facebook`;
    const description = p.text.slice(0, 150) + (p.text.length > 150 ? '…' : '');

    console.log(`[Facebook] post: #${p.tag} author="${pageName}" text="${name.slice(0, 50)}"`);

    return classifyTrend({
      name,
      description,
      imageUrl: imageUrls[idx],
      trendingScore: score,
      platform: 'Facebook',
      originDate: p.date ? new Date(p.date).toISOString() : undefined,
      sourceAccounts: [{ name: pageName, url: pageUrl }],
    });
  });

  const results = mapped.filter((m): m is NonNullable<typeof m> => m !== null);
  console.log(`[Facebook] SGAI final: ${results.length} moments`);
  return results;
}

// ─── Fallback: RSS from marketing publications ────────────────────────────────

interface RssSource { name: string; rssUrl: string; fbPage: string }
const MARKETING_RSS_SOURCES: RssSource[] = [
  { name: 'afaqs!',         rssUrl: 'https://www.afaqs.com/rss',               fbPage: 'https://www.facebook.com/afaqs' },
  { name: 'Adweek',         rssUrl: 'https://www.adweek.com/feed/',            fbPage: 'https://www.facebook.com/adweek' },
  { name: 'Marketing Week', rssUrl: 'https://www.marketingweek.com/feed/',     fbPage: 'https://www.facebook.com/marketingweekmagazine' },
  { name: 'Campaign India', rssUrl: 'https://www.campaignindia.in/rss',        fbPage: 'https://www.facebook.com/campaignindia.in' },
  { name: 'Creative Gaga',  rssUrl: 'https://creativegaga.com/feed/',          fbPage: 'https://www.facebook.com/creativegaga' },
  { name: 'Campaign Asia',  rssUrl: 'https://www.campaignasia.com/feed/',      fbPage: 'https://www.facebook.com/campaignasia' },
];

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&nbsp;/g, ' ');
}

function extractTag(xml: string, tag: string): string {
  const c = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`));
  if (c) return c[1].trim();
  const p = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return p ? p[1].trim() : '';
}

async function fetchViaRSS(): Promise<Moment[]> {
  console.log('[Facebook] RSS fallback...');
  const allItems: Array<{ title: string; link: string; description: string; pubDate: string; imageUrl?: string; sourceName: string; fbPage: string }> = [];

  await Promise.allSettled(
    MARKETING_RSS_SOURCES.map(async src => {
      try {
        const res = await fetch(src.rssUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MomentBot/1.0)' },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return;
        const xml = await res.text();
        const re = /<item>([\s\S]*?)<\/item>/g;
        let m; let count = 0;
        while ((m = re.exec(xml)) !== null && count < 5) {
          const raw = m[1];
          const title = decodeEntities(extractTag(raw, 'title').replace(/<[^>]+>/g, '').trim());
          const link  = raw.match(/<link>([^<]+)<\/link>/)?.[1]?.trim() ?? '';
          const desc  = decodeEntities(extractTag(raw, 'description').replace(/<[^>]+>/g, '').trim()).slice(0, 200);
          const date  = extractTag(raw, 'pubDate') || '';
          const img   = raw.match(/<enclosure[^>]+url="([^"]+)"/)?.[1]
            ?? raw.match(/<media:content[^>]+url="([^"]+)"/)?.[1]
            ?? raw.match(/<media:thumbnail[^>]+url="([^"]+)"/)?.[1]
            ?? extractTag(raw, 'description').match(/<img[^>]+src="([^"]+)"/)?.[1];
          if (title && link) {
            allItems.push({ title, link, description: desc, pubDate: date, imageUrl: img?.startsWith('http') ? img : undefined, sourceName: src.name, fbPage: src.fbPage });
            count++;
          }
        }
        console.log(`[Facebook] RSS ${src.name} → ${count} items`);
      } catch { /* skip */ }
    }),
  );

  if (allItems.length === 0) return [];
  allItems.sort((a, b) => (new Date(b.pubDate).getTime() || 0) - (new Date(a.pubDate).getTime() || 0));

  const imageUrls = await Promise.all(
    allItems.map(i => i.imageUrl ? Promise.resolve(i.imageUrl) : fetchTopicImage(`${i.title} marketing`)),
  );

  return allItems
    .map((item, idx) => classifyTrend({
      name: item.title.slice(0, 100),
      description: item.description || item.title,
      imageUrl: imageUrls[idx],
      trendingScore: 72,
      platform: 'Facebook',
      originDate: item.pubDate || new Date().toISOString(),
      sourceAccounts: [{ name: item.sourceName, url: item.fbPage }],
    }))
    .filter((m): m is NonNullable<typeof m> => m !== null);
}

// ─── Seed fallback ────────────────────────────────────────────────────────────

async function fetchViaSeedFallback(): Promise<Moment[]> {
  const now = new Date().toISOString();
  const images = await Promise.all(HASHTAGS.map(h => fetchTopicImage(`${h} marketing advertising`)));
  return HASHTAGS
    .map((tag, i) => classifyTrend({
      name: `#${tag}`,
      description: `Trending marketing content under #${tag} on Facebook.`,
      imageUrl: images[i],
      trendingScore: 65,
      platform: 'Facebook',
      originDate: now,
      sourceAccounts: [{ name: `#${tag}`, url: `https://www.facebook.com/hashtag/${tag}` }],
    }))
    .filter((m): m is NonNullable<typeof m> => m !== null);
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function fetchFacebookTrends(): Promise<Moment[]> {
  const sgaiKey = process.env.SGAI_API_KEY;

  // Primary: ScrapeGraphAI — scrapes all 8 hashtag pages + brand pages
  if (sgaiKey && sgaiKey.trim().length > 0) {
    try {
      const results = await fetchViaScrapeGraphAI(sgaiKey.trim());
      if (results.length > 0) {
        console.log(`[Facebook] Using ${results.length} SGAI posts`);
        return results;
      }
      console.warn('[Facebook] SGAI returned 0 — falling back to RSS');
    } catch (e) {
      console.error('[Facebook] SGAI error:', e);
    }
  } else {
    console.log('[Facebook] No SGAI_API_KEY set — using RSS');
  }

  // Fallback: RSS from marketing publications
  try {
    const rss = await fetchViaRSS();
    if (rss.length > 0) return rss;
  } catch (e) {
    console.error('[Facebook] RSS error:', e);
  }

  return fetchViaSeedFallback();
}
