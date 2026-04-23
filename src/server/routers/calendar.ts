import { z } from 'zod';
import { router, publicProcedure } from '@/server/trpc';
import { calendarStore, getCalendarEntries, addBenchmarkToEntry, removeBenchmarkFromEntry, updateBenchmarkInEntry } from '@/server/db/store';
import { generateId } from '@/lib/utils';
import { reserveCall, commitActual, releaseReservation } from '@/server/db/apify-spend';

const CurrencySchema = z.enum(['INR', 'USD', 'EUR', 'GBP', 'JPY']);
const OwnershipSchema = z.enum(['Say Hi!', 'Small Talk', 'Conversation']);

export const calendarRouter = router({
  list: publicProcedure
    .input(z.object({
      tab: z.enum(['available', 'my-calendar']).optional(),
      ownership: z.enum(['All', 'Say Hi!', 'Small Talk', 'Conversation']).optional(),
    }))
    .query(({ input }) => {
      let entries = getCalendarEntries();
      if (input.ownership && input.ownership !== 'All') {
        entries = entries.filter(e => e.ownership === input.ownership);
      }
      return entries;
    }),

  updateEntry: publicProcedure
    .input(z.object({
      id: z.string(),
      ownership: OwnershipSchema.optional(),
      creativeBudget: z.number().min(0).optional(),
      mediaBudget: z.number().min(0).optional(),
      currency: CurrencySchema.optional(),
    }))
    .mutation(({ input }) => {
      const entry = calendarStore.get(input.id);
      if (!entry) throw new Error('Calendar entry not found');
      if (input.ownership !== undefined) entry.ownership = input.ownership;
      if (input.creativeBudget !== undefined) entry.creativeBudget = input.creativeBudget;
      if (input.mediaBudget !== undefined) entry.mediaBudget = input.mediaBudget;
      if (input.currency !== undefined) entry.currency = input.currency;
      calendarStore.set(input.id, entry);
      return entry;
    }),

  removeMoment: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      calendarStore.delete(input.id);
      return { success: true };
    }),

  addBenchmark: publicProcedure
    .input(z.object({
      calendarEntryId: z.string(),
      type: z.string().min(1),
      brandName: z.string().min(1),
      url: z.string().optional().default(''),
      likes: z.number().min(0).default(0),
      comments: z.number().min(0).default(0),
      shares: z.number().min(0).default(0),
      views: z.number().min(0).default(0),
      autoFetched: z.boolean().default(false),
    }))
    .mutation(({ input }) => {
      const { calendarEntryId, ...benchmarkData } = input;
      const result = addBenchmarkToEntry(calendarEntryId, benchmarkData);
      if (!result) throw new Error('Calendar entry not found');
      return result;
    }),

  removeBenchmark: publicProcedure
    .input(z.object({ calendarEntryId: z.string(), benchmarkId: z.string() }))
    .mutation(({ input }) => {
      removeBenchmarkFromEntry(input.calendarEntryId, input.benchmarkId);
      return { success: true };
    }),

  updateBenchmark: publicProcedure
    .input(z.object({
      calendarEntryId: z.string(),
      benchmarkId: z.string(),
      type: z.string().optional(),
      brandName: z.string().optional(),
      url: z.string().optional(),
      likes: z.number().min(0).optional(),
      comments: z.number().min(0).optional(),
      shares: z.number().min(0).optional(),
      views: z.number().min(0).optional(),
    }))
    .mutation(({ input }) => {
      const { calendarEntryId, benchmarkId, ...patch } = input;
      const result = updateBenchmarkInEntry(calendarEntryId, benchmarkId, patch);
      if (!result) throw new Error('Benchmark not found');
      return result;
    }),

  fetchUrlMeta: publicProcedure
    .input(z.object({ url: z.string().url() }))
    .mutation(async ({ input }) => {
      const APIFY_TOKEN = process.env.APIFY_TOKEN ?? '';
      const APIFY_BASE = 'https://api.apify.com/v2';
      const url = input.url;

      function extractUsername(u: string): string {
        const m = u.match(/(?:instagram\.com|twitter\.com|x\.com|youtube\.com|facebook\.com)\/@?([^/?#]+)/);
        return m?.[1] ?? '';
      }
      const fallbackBrand = extractUsername(url);
      const zero = { likes: 0, comments: 0, views: 0, shares: 0, brandName: fallbackBrand, fetched: false, error: '' as string };

      // Use the sync endpoint that returns dataset items in one call — matches the
      // working scrapers in src/server/scrapers/{instagram,facebook}.ts
      async function runApifySync(
        actorId: string,
        inputBody: Record<string, unknown>,
        timeoutSecs = 180,
      ): Promise<Record<string, unknown>[]> {
        if (!APIFY_TOKEN) throw new Error('APIFY_TOKEN not configured on server');
        console.log(`[fetchUrlMeta] ${actorId} ← ${url}`);
        const res = await fetch(
          `${APIFY_BASE}/acts/${actorId}/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=${timeoutSecs}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(inputBody),
            signal: AbortSignal.timeout((timeoutSecs + 30) * 1000),
          },
        );
        if (!res.ok) {
          const txt = await res.text();
          console.error(`[fetchUrlMeta] ${actorId} ${res.status}:`, txt.slice(0, 300));
          throw new Error(`Apify ${actorId} failed: ${res.status} ${txt.slice(0, 120)}`);
        }
        const items = await res.json() as Record<string, unknown>[];
        console.log(`[fetchUrlMeta] ${actorId} → ${items.length} items; keys:`, items[0] ? Object.keys(items[0]).slice(0, 20) : []);
        return items;
      }

      // ── Instagram post / reel ─────────────────────────────────────────
      if (/instagram\.com\/(p|reel|tv)\//.test(url)) {
        const reservation = await reserveCall('apify/instagram-scraper', 1, 1);
        if (!reservation) return { ...zero, error: 'Daily Apify budget ($2) exhausted — try again tomorrow' };
        try {
          const items = await runApifySync('apify~instagram-scraper', {
            directUrls: [url],
            resultsType: 'posts',
            resultsLimit: 1,
            addParentData: false,
          });
          await commitActual(reservation, items.length);
          const post = items[0];
          if (!post) return { ...zero, error: 'Instagram post not found or is private' };
          return {
            likes: Number(post.likesCount ?? post.likes ?? 0),
            comments: Number(post.commentsCount ?? post.comments ?? 0),
            views: Number(post.videoViewCount ?? post.videoPlayCount ?? post.playsCount ?? 0),
            shares: Number(post.sharesCount ?? 0),
            brandName: String(post.ownerFullName ?? post.ownerUsername ?? fallbackBrand),
            fetched: true,
            error: '',
          };
        } catch (e) {
          await releaseReservation(reservation);
          const msg = e instanceof Error ? e.message : String(e);
          console.error('[fetchUrlMeta] Instagram:', msg);
          return { ...zero, error: `Instagram fetch failed: ${msg}` };
        }
      }

      // ── Twitter / X ─── use apidojo/tweet-scraper (quacker is deprecated) ─
      if (/twitter\.com|x\.com/.test(url)) {
        try {
          const items = await runApifySync('apidojo~tweet-scraper', {
            startUrls: [url],
            maxItems: 1,
          });
          const tweet = items[0];
          if (!tweet) return { ...zero, error: 'Tweet not found or protected' };
          const author = tweet.author as Record<string, unknown> | undefined;
          return {
            likes: Number(tweet.likeCount ?? tweet.favoriteCount ?? tweet.likes ?? 0),
            comments: Number(tweet.replyCount ?? tweet.replies ?? 0),
            shares: Number(tweet.retweetCount ?? tweet.retweets ?? 0) + Number(tweet.quoteCount ?? 0),
            views: Number(tweet.viewCount ?? tweet.views ?? 0),
            brandName: String(author?.name ?? author?.userName ?? tweet.user_name ?? fallbackBrand),
            fetched: true,
            error: '',
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error('[fetchUrlMeta] Twitter:', msg);
          return { ...zero, error: `Twitter fetch failed: ${msg}` };
        }
      }

      // ── YouTube ── use free YouTube Data API (no Apify cost) ──────────
      if (/youtube\.com\/watch|youtu\.be\/|youtube\.com\/shorts\//.test(url)) {
        const key = process.env.YOUTUBE_API_KEY;
        if (!key) return { ...zero, error: 'YOUTUBE_API_KEY not configured' };
        try {
          const vidMatch = url.match(/(?:v=|youtu\.be\/|shorts\/)([A-Za-z0-9_-]{11})/);
          const videoId = vidMatch?.[1];
          if (!videoId) return { ...zero, error: 'Could not extract YouTube video ID from URL' };
          const apiUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${videoId}&key=${key}`;
          const res = await fetch(apiUrl, { signal: AbortSignal.timeout(15_000) });
          if (!res.ok) {
            const txt = await res.text();
            return { ...zero, error: `YouTube API ${res.status}: ${txt.slice(0, 100)}` };
          }
          const data = await res.json() as { items?: Array<{ snippet?: { channelTitle?: string }; statistics?: { likeCount?: string; commentCount?: string; viewCount?: string } }> };
          const item = data.items?.[0];
          if (!item) return { ...zero, error: 'YouTube video not found (private or removed)' };
          return {
            likes: parseInt(item.statistics?.likeCount ?? '0'),
            comments: parseInt(item.statistics?.commentCount ?? '0'),
            views: parseInt(item.statistics?.viewCount ?? '0'),
            shares: 0,
            brandName: item.snippet?.channelTitle ?? fallbackBrand,
            fetched: true,
            error: '',
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error('[fetchUrlMeta] YouTube:', msg);
          return { ...zero, error: `YouTube fetch failed: ${msg}` };
        }
      }

      // ── Facebook ──────────────────────────────────────────────────────
      if (/facebook\.com|fb\.watch/.test(url)) {
        const reservation = await reserveCall('apify/facebook-posts-scraper', 1, 1);
        if (!reservation) return { ...zero, error: 'Daily Apify budget ($2) exhausted — try again tomorrow' };
        try {
          const items = await runApifySync('apify~facebook-posts-scraper', {
            startUrls: [{ url }],
            resultsLimit: 1,
          });
          await commitActual(reservation, items.length);
          const post = items[0];
          if (!post) return { ...zero, error: 'Facebook post not found or requires login' };
          return {
            likes: Number(post.likes ?? post.likesCount ?? post.reactionsCount ?? 0),
            comments: Number(post.comments ?? post.commentsCount ?? 0),
            shares: Number(post.shares ?? post.sharesCount ?? 0),
            views: Number(post.viewsCount ?? post.videoViewCount ?? post.videoPlayCount ?? 0),
            brandName: String(post.pageName ?? (post.user as Record<string, unknown> | undefined)?.name ?? post.authorName ?? fallbackBrand),
            fetched: true,
            error: '',
          };
        } catch (e) {
          await releaseReservation(reservation);
          const msg = e instanceof Error ? e.message : String(e);
          console.error('[fetchUrlMeta] Facebook:', msg);
          return { ...zero, error: `Facebook fetch failed: ${msg}` };
        }
      }

      return { ...zero, error: 'Unsupported URL — paste an Instagram, Twitter/X, YouTube or Facebook post link' };
    }),

  getBudgetSummary: publicProcedure
    .input(z.object({ currency: CurrencySchema.optional() }))
    .query(({ input }) => {
      const entries = getCalendarEntries();
      const currency = input.currency ?? 'INR';
      // Simple sum (no FX conversion for now)
      const totalCreative = entries.reduce((s, e) => s + (e.currency === currency ? e.creativeBudget : e.creativeBudget), 0);
      const totalMedia = entries.reduce((s, e) => s + (e.currency === currency ? e.mediaBudget : e.mediaBudget), 0);
      return { totalCreative, totalMedia, currency };
    }),
});
