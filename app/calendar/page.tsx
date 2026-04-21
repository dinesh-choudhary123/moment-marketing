'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { Search, Plus, ChevronDown } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { ToastProvider } from '@/components/ui/Toast';
import { CalendarTableRow } from '@/components/calendar/CalendarTableRow';
import { BenchmarkingModal } from '@/components/calendar/BenchmarkingModal';
import { MakePostModal } from '@/components/post/MakePostModal';
import { CreateMomentModal } from '@/components/moments/CreateMomentModal';
import type { CalendarEntry, Currency, MomentType } from '@/types';
import { CURRENCIES, CURRENCY_SYMBOLS } from '@/lib/constants';
import { cn } from '@/lib/utils';

type TypeTab = 'All' | MomentType;

const TYPE_TABS: Array<{ key: TypeTab; label: string }> = [
  { key: 'All', label: 'All' },
  { key: 'Fixed', label: 'Fixed Moments' },
  { key: 'Fluid', label: 'Fluid Moments' },
  { key: 'Brand', label: 'Brand Moments' },
];

function CalendarContent() {
  const [tab, setTab] = useState<'available' | 'my-calendar'>('my-calendar');
  const [typeTab, setTypeTab] = useState<TypeTab>('All');
  const [search, setSearch] = useState('');
  const [currency, setCurrency] = useState<Currency>('INR');
  const [benchmarkEntry, setBenchmarkEntry] = useState<CalendarEntry | null>(null);
  const [makePostEntry, setMakePostEntry] = useState<CalendarEntry | null>(null);
  const [viewEntry, setViewEntry] = useState<CalendarEntry | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const { data: allEntries = [], isLoading } = trpc.calendar.list.useQuery({});

  const sym = CURRENCY_SYMBOLS[currency];

  // Filter by type tab and search
  const entries = useMemo(() => {
    let result = allEntries;
    if (typeTab !== 'All') result = result.filter(e => e.moment.type === typeTab);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(e =>
        e.moment.name.toLowerCase().includes(q) ||
        e.moment.description.toLowerCase().includes(q),
      );
    }
    return result;
  }, [allEntries, typeTab, search]);

  const totalCreative = allEntries.reduce((s, e) => s + e.creativeBudget, 0);
  const totalMedia = allEntries.reduce((s, e) => s + e.mediaBudget, 0);

  function countForType(t: MomentType) {
    return allEntries.filter(e => e.moment.type === t).length;
  }

  const skeletons = Array(4).fill(0);

  return (
    <div className="min-h-screen bg-[var(--background)]">
      {/* Tabs + Search + Custom Moment */}
      <div className="bg-[var(--card)] border-b border-[var(--card-border)] px-6 pt-4 pb-0">
        <div className="max-w-screen-xl mx-auto flex items-center justify-between mb-4">
          {/* Tabs */}
          <div className="flex items-center gap-1 bg-[var(--background)] border border-[var(--card-border)] rounded-xl p-1">
            <Link
              href="/moments"
              className={cn(
                'px-4 py-2 text-sm font-medium rounded-lg transition-all',
                'text-[var(--muted)] hover:text-[var(--foreground)]',
              )}
            >
              Moment Marketing
            </Link>
            <button
              onClick={() => setTab('my-calendar')}
              className={cn(
                'px-4 py-2 text-sm font-medium rounded-lg transition-all',
                tab === 'my-calendar'
                  ? 'bg-[var(--card)] text-[var(--foreground)] shadow-sm border border-[var(--card-border)]'
                  : 'text-[var(--muted)] hover:text-[var(--foreground)]',
              )}
            >
              My Calendar ({allEntries.length})
            </button>
          </div>

          <div className="flex items-center gap-3">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--muted)]" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search moments..."
                className="pl-10 pr-4 py-2 text-sm border border-[var(--card-border)] rounded-xl bg-[var(--background)] text-[var(--foreground)] w-56 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
              />
            </div>

            {/* Add Moments */}
            <button
              onClick={() => setCreateOpen(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--accent)] text-white text-sm font-semibold hover:bg-[var(--accent)]/90 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Custom Moment
            </button>
          </div>
        </div>

        {/* Type tabs row + budget summary */}
        <div className="flex items-center justify-between">
          {/* Type sub-tabs */}
          <div className="flex items-center gap-0">
            {TYPE_TABS.map(({ key, label }) => {
              const count = key === 'All' ? allEntries.length : countForType(key as MomentType);
              return (
                <button
                  key={key}
                  onClick={() => setTypeTab(key)}
                  className={cn(
                    'px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                    typeTab === key
                      ? 'border-[var(--accent)] text-[var(--accent)]'
                      : 'border-transparent text-[var(--muted)] hover:text-[var(--foreground)]',
                  )}
                >
                  {label} ({count})
                </button>
              );
            })}
          </div>

          {/* Budget summary + currency */}
          <div className="flex items-center gap-3 pb-3">
            {/* Currency Selector */}
            <div className="relative">
              <select
                value={currency}
                onChange={e => setCurrency(e.target.value as Currency)}
                className="appearance-none border border-[var(--card-border)] rounded-xl pl-3 pr-7 py-1.5 text-xs font-medium bg-[var(--card)] text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40 cursor-pointer"
              >
                {CURRENCIES.map(c => <option key={c} value={c}>{CURRENCY_SYMBOLS[c]} {c}</option>)}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-[var(--muted)] pointer-events-none" />
            </div>

            <div title={`Exact: ${sym}${totalCreative.toFixed(0)}`} className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-50 border border-purple-200 rounded-full text-xs font-semibold text-purple-700 cursor-help">
              <span>🎨</span>
              Total Creative: <strong>{sym}{totalCreative >= 1000 ? `${(totalCreative / 1000).toFixed(1)}K` : totalCreative.toFixed(0)}</strong>
            </div>
            <div title={`Exact: ${sym}${totalMedia.toFixed(0)}`} className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded-full text-xs font-semibold text-emerald-700 cursor-help">
              <span>📢</span>
              Total Media: <strong>{sym}{totalMedia >= 1000 ? `${(totalMedia / 1000).toFixed(1)}K` : totalMedia.toFixed(0)}</strong>
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="px-6 py-4 max-w-screen-xl mx-auto">
        <div className="bg-[var(--card)] border border-[var(--card-border)] rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--card-border)] bg-[var(--background)]">
                  {['DATE', 'MONTH', 'MOMENT NAME', 'TYPE', 'OWNERSHIP', 'CREATIVE BUDGET', 'MEDIA BUDGET', 'BENCHMARKING', 'ACTIONS'].map(h => (
                    <th key={h} className="py-3 px-3 text-left text-[10px] font-bold uppercase tracking-widest text-[var(--muted)] first:pl-4 last:pr-4">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  skeletons.map((_, i) => (
                    <tr key={i} className="border-b border-[var(--card-border)]">
                      {Array(9).fill(0).map((_, j) => (
                        <td key={j} className="py-4 px-3">
                          <div className="skeleton h-4 rounded w-full max-w-[120px]" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : entries.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-16 text-center">
                      <div className="text-4xl mb-3">📅</div>
                      <p className="text-sm font-medium text-[var(--foreground)]">No moments in calendar</p>
                      <p className="text-xs text-[var(--muted)] mt-1">
                        Go to <Link href="/moments" className="text-[var(--accent)] underline">Moments</Link> and add some to your calendar
                      </p>
                    </td>
                  </tr>
                ) : (
                  entries.map(entry => (
                    <CalendarTableRow
                      key={entry.id}
                      entry={entry}
                      currency={currency}
                      onBenchmark={setBenchmarkEntry}
                      onView={setViewEntry}
                      onMakePost={setMakePostEntry}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <BenchmarkingModal entry={benchmarkEntry} onClose={() => setBenchmarkEntry(null)} />
      {makePostEntry && <MakePostModal entry={makePostEntry} onClose={() => setMakePostEntry(null)} />}
      {createOpen && <CreateMomentModal open={createOpen} onClose={() => setCreateOpen(false)} />}

      {/* View Modal */}
      {viewEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setViewEntry(null)} />
          <div className="relative w-full max-w-lg bg-[var(--card)] rounded-2xl shadow-2xl border border-[var(--card-border)] p-6">
            <h2 className="text-lg font-bold text-[var(--foreground)] mb-1">{viewEntry.moment.name}</h2>
            <p className="text-sm text-[var(--muted)] mb-4">{viewEntry.moment.description}</p>
            <div className="grid grid-cols-2 gap-3 text-xs">
              {[
                ['Date', `${viewEntry.date} (${viewEntry.day})`],
                ['Type', viewEntry.moment.type],
                ['Category', viewEntry.moment.category],
                ['Priority', viewEntry.moment.priority],
                ['Ownership', viewEntry.ownership],
                ['Creative Budget', `${CURRENCY_SYMBOLS[viewEntry.currency]}${viewEntry.creativeBudget}`],
                ['Media Budget', `${CURRENCY_SYMBOLS[viewEntry.currency]}${viewEntry.mediaBudget}`],
                ['Benchmarks', String(viewEntry.benchmarks.length)],
              ].map(([k, v]) => (
                <div key={k} className="bg-[var(--background)] rounded-xl p-3">
                  <p className="text-[var(--muted)]">{k}</p>
                  <p className="font-semibold text-[var(--foreground)] mt-0.5">{v}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => { setMakePostEntry(viewEntry); setViewEntry(null); }}
                className="flex-1 py-2 rounded-xl bg-[var(--accent)] text-white text-sm font-semibold"
              >
                Make Post
              </button>
              <button
                onClick={() => { setBenchmarkEntry(viewEntry); setViewEntry(null); }}
                className="flex-1 py-2 rounded-xl border border-[var(--card-border)] text-sm font-medium text-[var(--muted)] hover:bg-[var(--background)]"
              >
                Benchmark
              </button>
              <button
                onClick={() => setViewEntry(null)}
                className="py-2 px-4 rounded-xl border border-[var(--card-border)] text-sm font-medium text-[var(--muted)] hover:bg-[var(--background)]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CalendarPage() {
  return (
    <ToastProvider>
      <CalendarContent />
    </ToastProvider>
  );
}
