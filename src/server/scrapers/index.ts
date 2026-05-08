import fs from 'fs';
import path from 'path';
import type { Moment, Platform } from '@/types';
import { momentsStore, scraperStatus } from '@/server/db/store';
import { formatSpendSummary } from '@/server/db/apify-spend';
import { resetImageDedup } from './image-utils';
import { fetchTwitterTrends } from './twitter';
import { fetchRedditTrends } from './reddit';
import { fetchInstagramTrends } from './instagram';
import { fetchFacebookTrends } from './facebook';
import { fetchGoogleTrends } from './google';
import { fetchYouTubeTrends } from './youtube';

// 3-hour cooldown — 4 full Apify runs/day = $1.88 max spend (within $2 cap)
const COOLDOWN_MS = 3 * 60 * 60 * 1000;

export function canScrape(): boolean {
  if (scraperStatus.isRunning) return false;
  if (!scraperStatus.lastScrapedAt) return true;
  return Date.now() - new Date(scraperStatus.lastScrapedAt).getTime() > COOLDOWN_MS;
}

export async function runAllScrapers(): Promise<{ added: number; total: number; byPlatform: Partial<Record<Platform, number>> }> {
  if (scraperStatus.isRunning) return { added: 0, total: momentsStore.size, byPlatform: {} };
  scraperStatus.isRunning = true;

  // Clear per-run image dedup set so each run starts fresh
  resetImageDedup();

  try {
    // YouTube uses the web-client API (quota-free) first, so it's safe to run automatically.
    // API keys are only used when the web client returns 0 results.
    const results = await Promise.allSettled([
      fetchTwitterTrends(),
      fetchRedditTrends(),
      fetchInstagramTrends(),
      fetchFacebookTrends(),
      fetchGoogleTrends(),
      fetchYouTubeTrends(),
    ]);

    const platformResults: Map<Platform, Moment[]> = new Map();
    const scraperPlatforms: Platform[] = ['Twitter', 'Reddit', 'Instagram', 'Facebook', 'Google', 'YouTube'];

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled' && result.value.length > 0) {
        platformResults.set(scraperPlatforms[i], result.value);
      } else if (result.status === 'rejected') {
        console.error('Scraper failed:', result.reason);
      }
      // If fulfilled but empty (e.g. quota exceeded), keep existing moments for that platform
    }

    // Only remove moments for platforms that returned fresh data
    for (const [id, m] of momentsStore.entries()) {
      if (m.isCustom || id.startsWith('hist_') || id.startsWith('pred_')) continue;
      if (m.platforms.some(p => platformResults.has(p))) momentsStore.delete(id);
    }

    // Dedupe by name and insert fresh results
    const allMoments: Moment[] = [];
    for (const moments of platformResults.values()) allMoments.push(...moments);

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

// Disk-based startup lock — persists across process restarts so server restarts
// don't re-burn Apify budget. Resets after COOLDOWN_MS (3 hours).
const STARTUP_LOCK_FILE = path.join(process.cwd(), '.scraper-startup.json');

function lastStartupMs(): number {
  try {
    const raw = fs.readFileSync(STARTUP_LOCK_FILE, 'utf8');
    return (JSON.parse(raw) as { ts: number }).ts ?? 0;
  } catch { return 0; }
}

function markStartupRan(): void {
  try { fs.writeFileSync(STARTUP_LOCK_FILE, JSON.stringify({ ts: Date.now() }), 'utf8'); } catch {}
}

// Auto-run once per 3-hour window — survives HMR reloads AND process restarts
const _g = global as typeof globalThis & { _mmStartupDone?: boolean };
export function runOnStartup() {
  if (_g._mmStartupDone) return;
  _g._mmStartupDone = true;

  const elapsed = Date.now() - lastStartupMs();
  if (elapsed < COOLDOWN_MS) {
    console.log(`[Scraper] Startup skipped — last run ${Math.round(elapsed / 60000)}m ago (cooldown: ${Math.round(COOLDOWN_MS / 60000)}m)`);
    return;
  }

  markStartupRan();
  runAllScrapers()
    .then(r => console.log(`[Scraper] Startup: fetched ${r.added} moments from live APIs`))
    .catch(e => console.error('[Scraper] Startup failed:', e));
}
