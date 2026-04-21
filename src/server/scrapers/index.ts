import type { Moment, Platform } from '@/types';
import { momentsStore, scraperStatus } from '@/server/db/store';
import { formatSpendSummary } from '@/server/db/apify-spend';
import { fetchTwitterTrends } from './twitter';
import { fetchYouTubeTrends } from './youtube';
import { fetchRedditTrends } from './reddit';
import { fetchInstagramTrends } from './instagram';
import { fetchFacebookTrends } from './facebook';
import { fetchGoogleTrends } from './google';

// 6-hour cooldown between scraper runs — caps to ≤ 4 runs/day
const COOLDOWN_MS = 6 * 60 * 60 * 1000;

export function canScrape(): boolean {
  if (scraperStatus.isRunning) return false;
  if (!scraperStatus.lastScrapedAt) return true;
  return Date.now() - new Date(scraperStatus.lastScrapedAt).getTime() > COOLDOWN_MS;
}

export async function runAllScrapers(): Promise<{ added: number; total: number; byPlatform: Partial<Record<Platform, number>> }> {
  if (scraperStatus.isRunning) return { added: 0, total: momentsStore.size, byPlatform: {} };
  scraperStatus.isRunning = true;

  try {
    const results = await Promise.allSettled([
      fetchTwitterTrends(),
      fetchYouTubeTrends(),
      fetchRedditTrends(),
      fetchInstagramTrends(),
      fetchFacebookTrends(),
      fetchGoogleTrends(),
    ]);

    const allMoments: Moment[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        allMoments.push(...result.value);
      } else {
        console.error('Scraper failed:', result.reason);
      }
    }

    // Remove previously scraped (non-custom) moments before re-inserting fresh ones
    for (const [id, m] of momentsStore.entries()) {
      if (!m.isCustom && !id.startsWith('hist_') && !id.startsWith('pred_')) momentsStore.delete(id);
    }

    // Dedupe by name and insert
    const seen = new Set<string>();
    let added = 0;
    const byPlatform: Partial<Record<Platform, number>> = {};

    for (const moment of allMoments) {
      const key = moment.name.toLowerCase().trim();
      if (seen.has(key)) continue;
      seen.add(key);
      momentsStore.set(moment.id, moment);
      added++;
      for (const p of moment.platforms) {
        byPlatform[p] = (byPlatform[p] ?? 0) + 1;
      }
    }

    scraperStatus.lastScrapedAt = new Date().toISOString();
    scraperStatus.byPlatform = byPlatform;
    console.log(`[Scraper] Run finished. Apify spend today: ${formatSpendSummary()}`);
    return { added, total: momentsStore.size, byPlatform };
  } finally {
    scraperStatus.isRunning = false;
  }
}

// Auto-run once when module loads (server startup)
let startupDone = false;
export function runOnStartup() {
  if (startupDone) return;
  startupDone = true;
  runAllScrapers()
    .then(r => console.log(`[Scraper] Startup: fetched ${r.added} moments from live APIs`))
    .catch(e => console.error('[Scraper] Startup failed:', e));
}
