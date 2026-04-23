import { readFileSync, writeFileSync, existsSync, renameSync } from 'fs';
import { join } from 'path';

// ─── Daily Apify spend ledger ────────────────────────────────────────────────
// HARD-CAPS Apify usage at $2/day. Uses pre-reservation: every call reserves
// its estimated MAX cost before running, so concurrent refreshes cannot
// double-spend. Reservation is then reconciled against actual item count.
// Persisted atomically to disk so HMR/restart doesn't reset the counter.
// Resets automatically at UTC midnight.

const LEDGER_PATH = join(process.cwd(), '.apify-spend.json');
const LEDGER_TMP = LEDGER_PATH + '.tmp';
export const DAILY_CAP_USD = 2.0;

// Published Apify per-result pricing (pay-per-event actors).
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

// ─── In-process mutex so concurrent callers serialize ───────────────────────
let chain: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => T): Promise<T> {
  const next = chain.then(() => fn());
  chain = next.catch(() => undefined);
  return next;
}

function readLedgerSync(): Ledger {
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

function writeLedgerSync(l: Ledger): void {
  try {
    // Atomic write: tmp file then rename so a crash can't corrupt the ledger
    writeFileSync(LEDGER_TMP, JSON.stringify(l), 'utf8');
    renameSync(LEDGER_TMP, LEDGER_PATH);
  } catch (e) {
    console.warn('[ApifyBudget] Failed to persist ledger:', e);
  }
}

export function getSpentTodayUsd(): number {
  return readLedgerSync().spentUsd;
}

export function getRemainingBudgetUsd(): number {
  return Math.max(0, DAILY_CAP_USD - getSpentTodayUsd());
}

export function formatSpendSummary(): string {
  const spent = getSpentTodayUsd();
  const pct = Math.round((spent / DAILY_CAP_USD) * 100);
  return `$${spent.toFixed(2)} / $${DAILY_CAP_USD.toFixed(2)} (${pct}% used)`;
}

// ─── Reservation API ────────────────────────────────────────────────────────
// 1. `reserveCall()` atomically checks + debits the estimated MAX cost.
// 2. Caller runs the Apify request.
// 3. Caller MUST call `commitActual()` (success) OR `releaseReservation()`
//    (failure) to reconcile. If neither is called, the reservation stays
//    debited — conservative, but never over-spends.

export interface Reservation {
  actor: ApifyActor;
  reservedUsd: number;
  safeLimit: number;
}

/**
 * Atomically reserve budget for an Apify call.
 * @returns reservation + safe item limit, or `null` if not enough budget
 */
export async function reserveCall(
  actor: ApifyActor,
  requestedLimit: number,
  minViableLimit = 20,
): Promise<Reservation | null> {
  return withLock(() => {
    const l = readLedgerSync();
    const remaining = Math.max(0, DAILY_CAP_USD - l.spentUsd);
    const rate = COST_PER_ITEM[actor];
    const maxAffordable = Math.floor(remaining / rate);

    if (maxAffordable < minViableLimit) {
      console.warn(
        `[ApifyBudget] ${actor} BLOCKED — remaining $${remaining.toFixed(3)} buys only ${maxAffordable} items (need ≥${minViableLimit}). Today: ${formatSpendSummary()}`,
      );
      return null;
    }

    const safeLimit = Math.min(requestedLimit, maxAffordable);
    const reservedUsd = Math.round(safeLimit * rate * 10000) / 10000;

    // Pre-debit the reservation so concurrent callers see it immediately
    l.spentUsd = Math.round((l.spentUsd + reservedUsd) * 10000) / 10000;
    writeLedgerSync(l);

    console.log(
      `[ApifyBudget] ${actor} RESERVED $${reservedUsd.toFixed(3)} (limit=${safeLimit}). Today: $${l.spentUsd.toFixed(2)} / $${DAILY_CAP_USD.toFixed(2)}`,
    );
    return { actor, reservedUsd, safeLimit };
  });
}

/** Reconcile a reservation with the actual item count returned. */
export async function commitActual(
  reservation: Reservation,
  actualItemCount: number,
): Promise<void> {
  return withLock(() => {
    const rate = COST_PER_ITEM[reservation.actor];
    const actualUsd = Math.round(actualItemCount * rate * 10000) / 10000;
    const delta = Math.round((actualUsd - reservation.reservedUsd) * 10000) / 10000;
    const l = readLedgerSync();
    l.spentUsd = Math.max(0, Math.round((l.spentUsd + delta) * 10000) / 10000);
    // Clamp so we never exceed cap even if actor over-delivers
    if (l.spentUsd > DAILY_CAP_USD) l.spentUsd = DAILY_CAP_USD;
    writeLedgerSync(l);
    console.log(
      `[ApifyBudget] ${reservation.actor} COMMIT $${actualUsd.toFixed(3)} (${actualItemCount} items, Δ ${delta >= 0 ? '+' : ''}$${delta.toFixed(3)}). Today: ${formatSpendSummary()}`,
    );
  });
}

/** Release a reservation (actor failed or returned 0 items). */
export async function releaseReservation(reservation: Reservation): Promise<void> {
  return withLock(() => {
    const l = readLedgerSync();
    l.spentUsd = Math.max(0, Math.round((l.spentUsd - reservation.reservedUsd) * 10000) / 10000);
    writeLedgerSync(l);
    console.log(
      `[ApifyBudget] ${reservation.actor} RELEASED $${reservation.reservedUsd.toFixed(3)}. Today: ${formatSpendSummary()}`,
    );
  });
}

// ─── Legacy shims (kept so callers don't break mid-refactor) ────────────────
// New code should use reserveCall/commitActual/releaseReservation instead.

/** @deprecated use reserveCall + commitActual */
export function planCall(
  actor: ApifyActor,
  requestedLimit: number,
  minViableLimit = 20,
): number | null {
  const l = readLedgerSync();
  const remaining = Math.max(0, DAILY_CAP_USD - l.spentUsd);
  const rate = COST_PER_ITEM[actor];
  const maxAffordable = Math.floor(remaining / rate);
  if (maxAffordable < minViableLimit) return null;
  return Math.min(requestedLimit, maxAffordable);
}

/** @deprecated use reserveCall + commitActual */
export function recordSpend(actor: ApifyActor, itemCount: number): void {
  const cost = itemCount * COST_PER_ITEM[actor];
  const l = readLedgerSync();
  l.spentUsd = Math.round((l.spentUsd + cost) * 10000) / 10000;
  if (l.spentUsd > DAILY_CAP_USD) l.spentUsd = DAILY_CAP_USD;
  writeLedgerSync(l);
  console.log(
    `[ApifyBudget] ${actor} billed $${cost.toFixed(3)} (${itemCount} items). Today: ${formatSpendSummary()}`,
  );
}
