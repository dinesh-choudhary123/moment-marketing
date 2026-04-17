import type { Moment } from '@/types';
import { classifyTrend } from './classifier';

// ─── Google Trends RSS (free, no API key needed) ────────────────────────────
// Docs: https://trends.google.com/trends/trendingsearches/daily/rss?geo=IN
// Returns real-time daily trending searches for India (and US as backup)

const GEO_TARGETS = [
  { geo: 'IN', label: 'India' },
  { geo: 'US', label: 'Global' },
];

// Updated endpoint (Google changed URL in 2025)
const TRENDS_RSS_BASE = 'https://trends.google.com/trending/rss';

interface GoogleTrendItem {
  title: string;
  traffic: string;
  description: string;
  imageUrl?: string;
  newsTitle?: string;
  newsSource?: string;
}

// Simple XML value extractor using regex (no external parser needed)
function extractTag(xml: string, tag: string): string {
  const patterns = [
    new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i'),
    new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'),
  ];
  for (const pat of patterns) {
    const m = xml.match(pat);
    if (m?.[1]) return m[1].trim();
  }
  return '';
}

function extractAttr(xml: string, tag: string, attr: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`, 'i'));
  return m?.[1] ?? '';
}

function parseTrafficToScore(traffic: string): number {
  // Realtime trending feed: "200+", "500+", "2000+", "5000+", "10000+"
  // Daily trending feed (legacy): "50,000+", "1,000,000+"
  const num = parseInt(traffic.replace(/[^0-9]/g, ''), 10);
  if (!num) return 55;
  if (num >= 1_000_000) return 97;
  if (num >= 500_000) return 93;
  if (num >= 200_000) return 88;
  if (num >= 100_000) return 83;
  if (num >= 50_000) return 80;
  if (num >= 10_000) return 78;
  if (num >= 5_000) return 75;
  if (num >= 2_000) return 72;
  if (num >= 500) return 67;
  return 62;
}

// Only keep English-ish titles (filter out regional language trends for marketing use)
function isUsableForMarketing(title: string): boolean {
  // Keep if mostly ASCII characters (English, numbers, punctuation)
  const asciiRatio = (title.match(/[\x00-\x7F]/g) ?? []).length / title.length;
  return asciiRatio > 0.7;
}

async function fetchGoogleTrendsRSS(geo: string): Promise<GoogleTrendItem[]> {
  const url = `${TRENDS_RSS_BASE}?geo=${geo}`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MomentMarketing/1.0)',
        Accept: 'application/rss+xml, application/xml, text/xml',
      },
    });
    if (!res.ok) return [];

    const xml = await res.text();

    // Split into <item> blocks
    const itemBlocks = xml.match(/<item>([\s\S]*?)<\/item>/gi) ?? [];
    const results: GoogleTrendItem[] = [];

    for (const block of itemBlocks) {
      const title = extractTag(block, 'title');
      if (!title) continue;

      const traffic = extractTag(block, 'ht:approx_traffic');
      const imageUrl = extractAttr(block, 'ht:picture', 'url') ||
        extractTag(block, 'ht:picture') ||
        extractAttr(block, 'ht:news_item_picture', 'url') ||
        extractTag(block, 'ht:news_item_picture');

      const newsTitle = extractTag(block, 'ht:news_item_title');
      const newsSource = extractTag(block, 'ht:news_item_source');
      const newsSnippet = extractTag(block, 'ht:news_item_snippet');

      results.push({
        title,
        traffic,
        description: newsSnippet || newsTitle || `Trending on Google with ${traffic || 'high'} searches`,
        imageUrl: imageUrl || undefined,
        newsTitle: newsTitle || undefined,
        newsSource: newsSource || undefined,
      });
    }

    return results;
  } catch (e) {
    console.warn(`[Google] RSS fetch failed for geo=${geo}:`, e);
    return [];
  }
}

export async function fetchGoogleTrends(): Promise<Moment[]> {
  const allItems: (GoogleTrendItem & { geo: string })[] = [];

  // Fetch India + US trends in parallel
  const [indiaItems, usItems] = await Promise.all([
    fetchGoogleTrendsRSS('IN'),
    fetchGoogleTrendsRSS('US'),
  ]);

  for (const item of indiaItems) allItems.push({ ...item, geo: 'IN' });
  for (const item of usItems) allItems.push({ ...item, geo: 'US' });

  if (allItems.length === 0) {
    console.warn('[Google] RSS returned no items — falling back to empty');
    return [];
  }

  // Filter to English/marketable topics and dedupe by title
  const seen = new Set<string>();
  const unique = allItems.filter(item => {
    if (!isUsableForMarketing(item.title)) return false;
    const key = item.title.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`[Google] Fetched ${unique.length} trending searches (IN: ${indiaItems.length}, US: ${usItems.length})`);

  return unique.slice(0, 60).map(item => {
    const score = parseTrafficToScore(item.traffic);
    const source = item.newsSource ? ` • Source: ${item.newsSource}` : '';
    const traffic = item.traffic ? ` • ${item.traffic} searches` : '';
    const geoLabel = item.geo === 'IN' ? 'India' : 'Global';

    // gstatic.com images from Google Trends work fine (200 OK)
    // Add Unsplash fallback for searches without a news image
    const fallbackImg = (() => {
      const t = item.title.toLowerCase();
      if (/cricket|ipl|sport/.test(t)) return 'https://images.unsplash.com/photo-1531415074968-036ba1b575da?w=800&auto=format&fit=crop';
      if (/bollywood|film|movie/.test(t)) return 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=800&auto=format&fit=crop';
      if (/tech|ai|phone/.test(t)) return 'https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=800&auto=format&fit=crop';
      if (/finance|stock|budget/.test(t)) return 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=800&auto=format&fit=crop';
      return 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=800&auto=format&fit=crop';
    })();

    return classifyTrend({
      name: item.title,
      description: `${item.description}${source}${traffic} • Trending in ${geoLabel}`,
      imageUrl: item.imageUrl ?? fallbackImg,
      trendingScore: score,
      platform: 'Google',
    });
  }).filter((m): m is NonNullable<typeof m> => m !== null);
}
