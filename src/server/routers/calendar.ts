import { z } from 'zod';
import { router, publicProcedure } from '@/server/trpc';
import { calendarStore, getCalendarEntries, addBenchmarkToEntry, removeBenchmarkFromEntry, updateBenchmarkInEntry } from '@/server/db/store';
import { generateId } from '@/lib/utils';

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
        const m = u.match(/(?:instagram\.com|twitter\.com|x\.com|youtube\.com\/@?)\/([^/?#]+)/);
        return m?.[1] ?? '';
      }
      const fallbackBrand = extractUsername(url);

      // 2-step: start run → wait → fetch dataset  (same as working instagram.ts scraper)
      async function runApify(
        actorId: string,
        inputBody: Record<string, unknown>,
        waitSecs = 120,
      ): Promise<Record<string, unknown> | null> {
        console.log(`[fetchUrlMeta] Starting Apify actor ${actorId} for ${url}`);
        const runRes = await fetch(
          `${APIFY_BASE}/acts/${actorId}/runs?waitForFinish=${waitSecs}`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${APIFY_TOKEN}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(inputBody),
            signal: AbortSignal.timeout((waitSecs + 30) * 1000),
          },
        );
        if (!runRes.ok) {
          const txt = await runRes.text();
          console.error(`[fetchUrlMeta] ${actorId} run error ${runRes.status}:`, txt.slice(0, 300));
          return null;
        }
        const runData = await runRes.json() as { data?: { defaultDatasetId?: string; status?: string } };
        console.log(`[fetchUrlMeta] ${actorId} run status:`, runData.data?.status, 'datasetId:', runData.data?.defaultDatasetId);
        const datasetId = runData.data?.defaultDatasetId;
        if (!datasetId) return null;

        const dataRes = await fetch(
          `${APIFY_BASE}/datasets/${datasetId}/items?format=json&limit=1`,
          { headers: { Authorization: `Bearer ${APIFY_TOKEN}` } },
        );
        if (!dataRes.ok) {
          console.error(`[fetchUrlMeta] dataset fetch error ${dataRes.status}`);
          return null;
        }
        const items = await dataRes.json() as Record<string, unknown>[];
        console.log(`[fetchUrlMeta] ${actorId} returned ${items.length} items, keys:`, items[0] ? Object.keys(items[0]).slice(0, 15) : []);
        return items[0] ?? null;
      }

      // ── Instagram post / reel ─────────────────────────────────────────
      if (/instagram\.com\/(p|reel|tv)\//.test(url)) {
        try {
          const post = await runApify('apify~instagram-scraper', {
            directUrls: [url],
            resultsType: 'posts',
            resultsLimit: 1,
            addParentData: false,
          });
          if (post) {
            return {
              likes: Number(post.likesCount ?? post.likes ?? 0),
              comments: Number(post.commentsCount ?? post.comments ?? 0),
              views: Number(post.videoViewCount ?? post.videoPlayCount ?? post.playsCount ?? 0),
              shares: Number(post.sharesCount ?? 0),
              brandName: String(post.ownerFullName ?? post.ownerUsername ?? fallbackBrand),
              fetched: true,
            };
          }
        } catch (e) { console.error('[fetchUrlMeta] Instagram:', e); }
        return { likes: 0, comments: 0, views: 0, shares: 0, brandName: fallbackBrand, fetched: false };
      }

      // ── Twitter / X ───────────────────────────────────────────────────
      if (/twitter\.com|x\.com/.test(url)) {
        try {
          const tweet = await runApify('quacker~twitter-scraper', {
            startUrls: [{ url }],
            maxTweets: 1,
            addUserInfo: false,
          });
          if (tweet) {
            return {
              likes: Number(tweet.favoriteCount ?? tweet.likeCount ?? tweet.likes ?? 0),
              comments: Number(tweet.replyCount ?? tweet.replies ?? 0),
              shares: Number(tweet.retweetCount ?? tweet.retweets ?? tweet.quoteCount ?? 0),
              views: Number(tweet.viewCount ?? tweet.views ?? 0),
              brandName: String(tweet.user_name ?? tweet.userName ?? fallbackBrand),
              fetched: true,
            };
          }
        } catch (e) { console.error('[fetchUrlMeta] Twitter:', e); }
        return { likes: 0, comments: 0, views: 0, shares: 0, brandName: fallbackBrand, fetched: false };
      }

      // ── YouTube ───────────────────────────────────────────────────────
      if (/youtube\.com\/watch|youtu\.be\//.test(url)) {
        try {
          const video = await runApify('streamers~youtube-scraper', {
            startUrls: [{ url }],
            maxResults: 1,
            downloadSubtitles: false,
            saveHtml: false,
            saveMarkdown: false,
          });
          if (video) {
            return {
              likes: Number(video.likes ?? video.likeCount ?? 0),
              comments: Number(video.commentCount ?? video.numberOfComments ?? 0),
              views: Number(video.viewCount ?? video.numberOfViews ?? 0),
              shares: 0,
              brandName: String(video.channelName ?? (video.channel as Record<string,unknown>|undefined)?.name ?? fallbackBrand),
              fetched: true,
            };
          }
        } catch (e) { console.error('[fetchUrlMeta] YouTube:', e); }
        return { likes: 0, comments: 0, views: 0, shares: 0, brandName: fallbackBrand, fetched: false };
      }

      // ── Facebook ──────────────────────────────────────────────────────
      if (/facebook\.com/.test(url)) {
        try {
          const post = await runApify('apify~facebook-posts-scraper', {
            startUrls: [{ url }],
            maxPosts: 1,
            maxPostComments: 0,
          });
          if (post) {
            return {
              likes: Number(post.likes ?? post.reactionsCount ?? 0),
              comments: Number(post.commentsCount ?? 0),
              shares: Number(post.sharesCount ?? post.shares ?? 0),
              views: Number(post.videoViewCount ?? 0),
              brandName: String(post.pageName ?? post.authorName ?? fallbackBrand),
              fetched: true,
            };
          }
        } catch (e) { console.error('[fetchUrlMeta] Facebook:', e); }
        return { likes: 0, comments: 0, views: 0, shares: 0, brandName: fallbackBrand, fetched: false };
      }

      return { likes: 0, views: 0, comments: 0, shares: 0, brandName: fallbackBrand, fetched: false };
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
