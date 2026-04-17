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

const ALLOWED_DOMAINS = [
  'scontent.cdninstagram.com',
  'cdninstagram.com',
  'instagram.com',
  'fbcdn.net',
  'scontent-',               // All scontent-*.cdninstagram.com variants
  'i.redd.it',
  'preview.redd.it',
  'i.ytimg.com',
  'images.unsplash.com',
];

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');

  if (!url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  try {
    const parsed = new URL(url);

    // Security: only proxy from known image CDN domains
    const isAllowed = ALLOWED_DOMAINS.some(d => parsed.hostname.includes(d));
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
