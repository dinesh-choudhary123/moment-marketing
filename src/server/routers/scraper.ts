import { z } from 'zod';
import type { Moment, Platform } from '@/types';
import { router, publicProcedure } from '@/server/trpc';
import { runAllScrapers, canScrape } from '@/server/scrapers/index';
import { fetchRedditTrends } from '@/server/scrapers/reddit';
import { fetchInstagramTrends } from '@/server/scrapers/instagram';
import { fetchFacebookTrends } from '@/server/scrapers/facebook';
import { scraperStatus, momentsStore } from '@/server/db/store';

// Helper: replace all existing moments for a given platform with fresh ones
function replacePlatformMoments(platform: Platform, moments: Moment[]): number {
  for (const [id, m] of momentsStore.entries()) {
    if (!m.isCustom && m.platforms.includes(platform)) momentsStore.delete(id);
  }
  const seen = new Set<string>();
  let added = 0;
  for (const moment of moments) {
    const key = moment.name.toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);
    momentsStore.set(moment.id, moment);
    added++;
  }
  return added;
}

export const scraperRouter = router({
  getStatus: publicProcedure.query(() => {
    return {
      lastScrapedAt: scraperStatus.lastScrapedAt,
      isRunning: scraperStatus.isRunning,
      canScrape: canScrape(),
      totalMoments: momentsStore.size,
      byPlatform: scraperStatus.byPlatform,
    };
  }),

  scrapeAll: publicProcedure
    .input(z.object({}).optional())
    .mutation(async () => {
      if (!canScrape()) {
        return {
          success: false,
          message: 'Scraper cooled down (6h) — try again later',
          added: 0,
          total: momentsStore.size,
        };
      }
      const result = await runAllScrapers();
      return {
        success: true,
        message: `Fetched ${result.total} live moments (${result.added} new)`,
        ...result,
      };
    }),

  scrapeReddit: publicProcedure
    .input(z.object({ sort: z.enum(['hot', 'top', 'new', 'relevance']).default('hot') }))
    .mutation(async ({ input }) => {
      if (!canScrape()) {
        return { success: false, message: 'Scraper cooled down (6h) — try again later', added: 0, total: momentsStore.size };
      }
      const moments = await fetchRedditTrends(input.sort);
      const added = replacePlatformMoments('Reddit', moments);
      return {
        success: true,
        message: `Fetched ${added} Reddit moments (${input.sort})`,
        added,
        total: momentsStore.size,
      };
    }),

  scrapeInstagram: publicProcedure
    .input(z.object({}).optional())
    .mutation(async () => {
      if (!canScrape()) {
        return { success: false, message: 'Scraper cooled down (6h) — try again later', added: 0, total: momentsStore.size };
      }
      const moments = await fetchInstagramTrends();
      const added = replacePlatformMoments('Instagram', moments);
      return {
        success: true,
        message: added > 0
          ? `Fetched ${added} Instagram moments`
          : 'Instagram scraper returned no results — check APIFY_TOKEN and credits',
        added,
        total: momentsStore.size,
      };
    }),

  scrapeFacebook: publicProcedure
    .input(z.object({}).optional())
    .mutation(async () => {
      if (!canScrape()) {
        return { success: false, message: 'Scraper cooled down (6h) — try again later', added: 0, total: momentsStore.size };
      }
      const moments = await fetchFacebookTrends();
      const added = replacePlatformMoments('Facebook', moments);
      return {
        success: true,
        message: added > 0
          ? `Fetched ${added} Facebook moments`
          : 'Facebook scraper returned no results — check APIFY_TOKEN and credits',
        added,
        total: momentsStore.size,
      };
    }),
});
