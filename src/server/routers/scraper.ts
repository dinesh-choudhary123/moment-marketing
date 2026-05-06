import { z } from 'zod';
import type { Moment, Platform } from '@/types';
import { router, publicProcedure } from '@/server/trpc';
import { runAllScrapers, canScrape } from '@/server/scrapers/index';
import { fetchRedditTrends } from '@/server/scrapers/reddit';
import { fetchInstagramTrends } from '@/server/scrapers/instagram';
import { fetchFacebookTrends } from '@/server/scrapers/facebook';
import { fetchYouTubeTrends } from '@/server/scrapers/youtube';
import { scraperStatus, momentsStore } from '@/server/db/store';

// Per-platform cooldown: 30 min between individual scraper calls
const PLATFORM_COOLDOWN_MS = 30 * 60 * 1000;
const platformLastRun: Partial<Record<string, number>> = {};
function platformCooledDown(key: string): boolean {
  const last = platformLastRun[key];
  return !last || Date.now() - last > PLATFORM_COOLDOWN_MS;
}
function markPlatformRun(key: string) { platformLastRun[key] = Date.now(); }

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
      const moments = await fetchRedditTrends();
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
      if (!platformCooledDown('Instagram')) {
        return { success: false, message: 'Instagram refreshed recently — try again in 30 min', added: 0, total: momentsStore.size };
      }
      markPlatformRun('Instagram');
      const moments = await fetchInstagramTrends();
      const added = replacePlatformMoments('Instagram', moments);
      return {
        success: true,
        message: added > 0
          ? `Fetched ${added} Instagram moments`
          : 'Instagram scraper returned no results',
        added,
        total: momentsStore.size,
      };
    }),

  scrapeFacebook: publicProcedure
    .input(z.object({}).optional())
    .mutation(async () => {
      if (!platformCooledDown('Facebook')) {
        return { success: false, message: 'Facebook refreshed recently — try again in 30 min', added: 0, total: momentsStore.size };
      }
      markPlatformRun('Facebook');
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

  scrapeYouTube: publicProcedure
    .input(z.object({}).optional())
    .mutation(async () => {
      if (!platformCooledDown('YouTube')) {
        return { success: false, message: 'YouTube refreshed recently — try again in 30 min', added: 0, total: momentsStore.size };
      }
      markPlatformRun('YouTube');
      const moments = await fetchYouTubeTrends();
      if (moments.length === 0) {
        return {
          success: false,
          message: 'YouTube: both API keys quota exceeded — serving cached trends (resets midnight PT / ~12:30 AM IST)',
          added: 0,
          total: momentsStore.size,
        };
      }
      const added = replacePlatformMoments('YouTube', moments);
      return {
        success: true,
        message: `Fetched ${added} YouTube trending videos`,
        added,
        total: momentsStore.size,
      };
    }),
});
