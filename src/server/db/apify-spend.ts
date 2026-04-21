import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

// ─── Daily Apify spend ledger ────────────────────────────────────────────────
// Hard-caps Apify usage at $2/day. Persisted to disk so HMR/restart doesn't
// reset the counter. Resets automatically at UTC midnight.

const LEDGER_PATH = join(process.cwd(), '.apify-spend.json');
export const DAILY_CAP_USD = 2.0;

// Published Apify per-result pricing (pay-per-event actors).
// Update these if Apify changes its rate-card.
export const COST_PER_ITEM: Record<ApifyActor, number> = {
  'apify/instagram-scraper': 0.0023, //  $2.30 / 1K items
  'apify/facebook-posts-scraper': 0.0050, // $5.00 / 1K items
};

export type ApifyActor = 'apify/instagram-scraper' | 'apify/facebook-posts-scraper';

interface Ledger {
  date: string; // YYYY-MM-DD (UTC)
  spentUsd: number;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function readLedger(): Ledger {
  if (!existsSync(LEDGER_PATH)) return { date: todayUtc(), spentUsd: 0 };
  try {
    const raw = readFileSync(LEDGER_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Ledger;
    if (parsed.date !== todayUtc()) return { date: todayUtc(), spentUsd: 0 };
    return { date: parsed.date, spentUsd: Number(parsed.spentUsd) || 0 };
  } catch {
    return { date: todayUtc(), spentUsd: 0 };
  }
}

function writeLedger(l: Ledger): void {
  try {
    writeFileSync(LEDGER_PATH, JSON.stringify(l), 'utf8');
  } catch (e) {
    console.warn('[ApifyBudget] Failed to persist ledger:', e);
  }
}

export function getSpentTodayUsd(): number {
  return readLedger().spentUsd;
}

export function getRemainingBudgetUsd(): number {
  return Math.max(0, DAILY_CAP_USD - getSpentTodayUsd());
}

export function recordSpend(actor: ApifyActor, itemCount: number): void {
  const cost = itemCount * COST_PER_ITEM[actor];
  const l = readLedger();
  l.spentUsd = Math.round((l.spentUsd + cost) * 10000) / 10000; // 4-decimal precision
  writeLedger(l);
  console.log(
    `[ApifyBudget] ${actor} billed $${cost.toFixed(3)} (${itemCount} items). ` +
      `Today: $${l.spentUsd.toFixed(2)} / $${DAILY_CAP_USD.toFixed(2)} ` +
      `(${Math.round((l.spentUsd / DAILY_CAP_USD) * 100)}% used)`,
  );
}

/**
 * Decide if a planned Apify call fits today's remaining budget.
 *
 * @param actor         The Apify actor being invoked
 * @param requestedLimit Intended resultsLimit for the call
 * @param minViableLimit Minimum items that make the call worth running (default 20)
 * @returns The safe resultsLimit (possibly clamped); or `null` if budget is too low
 */
export function planCall(
  actor: ApifyActor,
  requestedLimit: number,
  minViableLimit = 20,
): number | null {
  const remaining = getRemainingBudgetUsd();
  const rate = COST_PER_ITEM[actor];
  const maxAffordable = Math.floor(remaining / rate);
  if (maxAffordable < minViableLimit) {
    console.warn(
      `[ApifyBudget] ${actor} SKIPPED — remaining $${remaining.toFixed(3)} ` +
        `only buys ${maxAffordable} items (< ${minViableLimit} viable).`,
    );
    return null;
  }
  const safeLimit = Math.min(requestedLimit, maxAffordable);
  const estCost = safeLimit * rate;
  console.log(
    `[ApifyBudget] ${actor} planned: limit=${safeLimit} ` +
      `(est $${estCost.toFixed(3)}), remaining $${remaining.toFixed(3)} of $${DAILY_CAP_USD.toFixed(2)}`,
  );
  return safeLimit;
}

export function formatSpendSummary(): string {
  const spent = getSpentTodayUsd();
  const pct = Math.round((spent / DAILY_CAP_USD) * 100);
  return `$${spent.toFixed(2)} / $${DAILY_CAP_USD.toFixed(2)} (${pct}% used)`;
}
