'use client';

import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { TypeBadge } from '@/components/ui/Badge';
import { ActionMenu } from './ActionMenu';
import type { CalendarEntry, Ownership, Currency } from '@/types';
import { OWNERSHIPS } from '@/lib/constants';

function formatCompact(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, '') + 'K';
  return n.toLocaleString();
}

interface Props {
  entry: CalendarEntry;
  currency: Currency;
  onBenchmark: (entry: CalendarEntry) => void;
  onView: (entry: CalendarEntry) => void;
  onMakePost: (entry: CalendarEntry) => void;
}

export function CalendarTableRow({ entry, currency, onBenchmark, onView, onMakePost }: Props) {
  const [ownership, setOwnership] = useState<Ownership>(entry.ownership);
  const [creative, setCreative] = useState(String(entry.creativeBudget));
  const [media, setMedia] = useState(String(entry.mediaBudget));

  const utils = trpc.useUtils();
  const update = trpc.calendar.updateEntry.useMutation({
    onSuccess: () => utils.calendar.list.invalidate(),
  });

  function save(patch: Omit<Parameters<typeof update.mutate>[0], 'id'>) {
    update.mutate({ id: entry.id, ...patch });
  }

  const dateObj = new Date(entry.date);
  const month = dateObj.toLocaleString('en-US', { month: 'short' });
  const monthLong = dateObj.toLocaleString('en-US', { month: 'long' });
  const day = dateObj.getDate();
  const year = dateObj.getFullYear();

  const currencySymbols: Record<Currency, string> = {
    INR: '₹', USD: '$', EUR: '€', GBP: '£', JPY: '¥',
  };
  const sym = currencySymbols[currency];

  return (
    <tr className="border-b border-[var(--card-border)] hover:bg-[var(--background)] transition-colors group">
      {/* Date */}
      <td className="py-3 pl-4 pr-3">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-[var(--accent-light)] flex flex-col items-center justify-center flex-shrink-0">
            <span className="text-[9px] font-bold text-[var(--accent)] uppercase leading-none">{month}</span>
            <span className="text-sm font-bold text-[var(--accent)] leading-tight">{day}</span>
          </div>
          <div>
            <p className="text-xs font-medium text-[var(--foreground)]">{month} {day}, {year}</p>
            <p className="text-[10px] text-[var(--muted)] mt-0.5">{entry.day}</p>
          </div>
        </div>
      </td>

      {/* Month */}
      <td className="py-3 px-3 text-sm text-[var(--muted)]">{monthLong}</td>

      {/* Event Name */}
      <td className="py-3 px-3">
        <div>
          <p className="text-sm font-medium text-[var(--foreground)] line-clamp-1">{entry.moment.name}</p>
          <p className="text-xs text-[var(--muted)] line-clamp-1 mt-0.5">{entry.moment.description.slice(0, 50)}…</p>
        </div>
      </td>

      {/* Classification */}
      <td className="py-3 px-3">
        <TypeBadge type={entry.moment.type} />
      </td>

      {/* Ownership */}
      <td className="py-3 px-3">
        <select
          value={ownership}
          onChange={e => { const v = e.target.value as Ownership; setOwnership(v); save({ ownership: v }); }}
          className="border border-[var(--card-border)] rounded-lg px-2 py-1 text-xs bg-[var(--background)] text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
        >
          {OWNERSHIPS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </td>

      {/* Creative Budget */}
      <td className="py-3 px-3">
        <div className="flex items-center gap-1">
          <span className="text-xs text-[var(--muted)]">{sym}</span>
          <input
            type="number" min={0} value={creative}
            onChange={e => setCreative(e.target.value)}
            onBlur={() => save({ creativeBudget: parseFloat(creative) || 0 })}
            className="w-20 border border-[var(--card-border)] rounded-lg px-2 py-1 text-xs bg-[var(--background)] text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
          />
        </div>
      </td>

      {/* Media Budget */}
      <td className="py-3 px-3">
        <div className="flex items-center gap-1">
          <span className="text-xs text-[var(--muted)]">{sym}</span>
          <input
            type="number" min={0} value={media}
            onChange={e => setMedia(e.target.value)}
            onBlur={() => save({ mediaBudget: parseFloat(media) || 0 })}
            className="w-20 border border-[var(--card-border)] rounded-lg px-2 py-1 text-xs bg-[var(--background)] text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
          />
        </div>
      </td>

      {/* Benchmarking */}
      <td className="py-3 px-3">
        {entry.benchmarks.length > 0 ? (() => {
          const totalViews = entry.benchmarks.reduce((s, b) => s + (b.views ?? 0), 0);
          const top = entry.benchmarks.reduce((a, b) => (b.views ?? 0) > (a.views ?? 0) ? b : a);
          return (
            <div className="flex flex-col gap-0.5">
              <button
                onClick={() => onBenchmark(entry)}
                className="text-xs font-semibold text-[var(--accent)] hover:underline text-left"
              >
                {entry.benchmarks.length} added · {formatCompact(totalViews)} views
              </button>
              <div className="flex items-center gap-1 text-[10px] text-[var(--muted)]">
                <span>Top: {formatCompact(top.views ?? 0)}</span>
                {top.url && (
                  <a
                    href={top.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    title={`Open top post: ${top.brandName}`}
                    className="text-[var(--accent)] hover:opacity-70"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>
          );
        })() : (
          <button
            onClick={() => onBenchmark(entry)}
            className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 transition-colors"
          >
            Add
          </button>
        )}
      </td>

      {/* Actions */}
      <td className="py-3 pr-4 pl-3">
        <ActionMenu entry={entry} onViewMoment={onView} onMakePost={onMakePost} />
      </td>
    </tr>
  );
}
