import { NextRequest, NextResponse } from 'next/server';

/**
 * Image proxy route — /api/image-proxy?url=<encoded-url>
 *
 * Fetches an external image server-side and streams it back to the browser.
 * Needed for Instagram CDN URLs that block browser-level hotlinking
 * but are accessible from server-side fetch.
 *
 * Also adds aggressive caching headers so the browser doesn't re-fetch.
 */

// Domains explicitly known to host images we use
const ALLOWED_DOMAINS = [
  // Instagram
  'scontent.cdninstagram.com',
  'cdninstagram.com',
  'instagram.com',
  'fbcdn.net',
  // Reddit
  'i.redd.it',
  'preview.redd.it',
  'external-preview.redd.it',
  // YouTube thumbnails
  'i.ytimg.com',
  'img.youtube.com',
  // Wikipedia / Wikimedia
  'upload.wikimedia.org',
  'wikipedia.org',
  // Bing News thumbnails
  'th.bing.com',
  'bing.com',
  'msn.com',
  // Google News / Google Images
  'news.google.com',
  'lh3.googleusercontent.com',
  'encrypted-tbn0.gstatic.com',
  // Common news CDNs
  'images.hindustantimes.com',
  'akm-img-a-in.tosshub.com',
  'feeds.abplive.com',
  'static.toiimg.com',
  'ndtvimg.com',
  'images.news18.com',
  'images.indianexpress.com',
  'images.livemint.com',
  'images.financialexpress.com',
  'bsmedia.business-standard.com',
  'timesofindia.indiatimes.com',
  'economictimes.indiatimes.com',
  'img.etimg.com',
  // Unsplash
  'images.unsplash.com',
  // Generic image hosts
  'pbs.twimg.com',
  'media.tenor.com',
  'i.imgur.com',
];

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');

  if (!url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  try {
    const parsed = new URL(url);

    // Security: only proxy from known image domains OR https URLs that look like images
    const isAllowed =
      ALLOWED_DOMAINS.some(d => parsed.hostname.includes(d)) ||
      /\.(jpg|jpeg|png|webp|gif|avif)($|\?)/i.test(parsed.pathname);

    if (!isAllowed) {
      return NextResponse.json({ error: 'Domain not allowed' }, { status: 403 });
    }

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `Upstream returned ${res.status}` },
        { status: res.status },
      );
    }

    const contentType = res.headers.get('content-type') ?? 'image/jpeg';
    const buffer = await res.arrayBuffer();

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (e) {
    console.error('[image-proxy] Failed:', e);
    return NextResponse.json({ error: 'Proxy fetch failed' }, { status: 502 });
  }
}
