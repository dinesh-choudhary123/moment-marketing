'use client';

import { useRef, useState, useEffect } from 'react';
import { Filter, ChevronDown, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MOMENT_TYPES, MOMENT_CATEGORIES, MOMENT_PRIORITIES, PLATFORMS } from '@/lib/constants';
import type { MomentsFilterState, MomentType, MomentCategory, MomentPriority, Platform } from '@/types';

const YEARS = ['2025', '2026', '2027'];
const MONTHS = [
  { value: '2026-01', label: 'January 2026' },
  { value: '2026-02', label: 'February 2026' },
  { value: '2026-03', label: 'March 2026' },
  { value: '2026-04', label: 'April 2026' },
  { value: '2026-05', label: 'May 2026' },
  { value: '2026-06', label: 'June 2026' },
  { value: '2026-07', label: 'July 2026' },
  { value: '2026-08', label: 'August 2026' },
  { value: '2026-09', label: 'September 2026' },
  { value: '2026-10', label: 'October 2026' },
  { value: '2026-11', label: 'November 2026' },
  { value: '2026-12', label: 'December 2026' },
];

// ─── Generic multi-select dropdown ───────────────────────────────────────────
interface MultiDropdownProps {
  label: string;
  allLabel: string;
  options: string[];
  selected: string[];
  onChange: (vals: string[]) => void;
}

function MultiDropdown({ label, allLabel, options, selected, onChange }: MultiDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function toggle(val: string) {
    onChange(selected.includes(val) ? selected.filter(v => v !== val) : [...selected, val]);
  }

  const displayLabel = selected.length === 0
    ? allLabel
    : selected.length === 1
      ? selected[0]
      : `${selected.length} selected`;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium transition-colors bg-[var(--card)] whitespace-nowrap',
          selected.length > 0
            ? 'border-[var(--accent)] text-[var(--accent)]'
            : 'border-[var(--card-border)] text-[var(--foreground)]',
        )}
      >
        <span>{displayLabel}</span>
        <ChevronDown className={cn('w-4 h-4 transition-transform text-[var(--muted)]', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-[var(--card)] border border-[var(--card-border)] rounded-xl shadow-xl min-w-[180px] py-1 overflow-hidden">
          {/* All option */}
          <button
            onClick={() => { onChange([]); setOpen(false); }}
            className={cn(
              'w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-[var(--background)] transition-colors',
              selected.length === 0 ? 'text-[var(--accent)] font-semibold' : 'text-[var(--foreground)]',
            )}
          >
            {allLabel}
            {selected.length === 0 && <Check className="w-3.5 h-3.5" />}
          </button>
          <div className="border-t border-[var(--card-border)] my-1" />
          {options.map(opt => (
            <button
              key={opt}
              onClick={() => toggle(opt)}
              className="w-full flex items-center justify-between px-4 py-2 text-sm hover:bg-[var(--background)] transition-colors text-[var(--foreground)]"
            >
              <span>{opt}</span>
              {selected.includes(opt) && <Check className="w-3.5 h-3.5 text-[var(--accent)]" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Single-select month dropdown ─────────────────────────────────────────────
interface MonthDropdownProps {
  selected: string | null;
  onChange: (val: string | null) => void;
}

function MonthDropdown({ selected, onChange }: MonthDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const displayLabel = selected
    ? MONTHS.find(m => m.value === selected)?.label ?? 'All Months'
    : 'All Months';

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium transition-colors bg-[var(--card)] whitespace-nowrap',
          selected
            ? 'border-[var(--accent)] text-[var(--accent)]'
            : 'border-[var(--card-border)] text-[var(--foreground)]',
        )}
      >
        <span>{displayLabel}</span>
        <ChevronDown className={cn('w-4 h-4 transition-transform text-[var(--muted)]', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-[var(--card)] border border-[var(--card-border)] rounded-xl shadow-xl min-w-[180px] py-1 max-h-64 overflow-y-auto">
          <button
            onClick={() => { onChange(null); setOpen(false); }}
            className={cn(
              'w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-[var(--background)] transition-colors',
              !selected ? 'text-[var(--accent)] font-semibold' : 'text-[var(--foreground)]',
            )}
          >
            All Months
            {!selected && <Check className="w-3.5 h-3.5" />}
          </button>
          <div className="border-t border-[var(--card-border)] my-1" />
          {MONTHS.map(m => (
            <button
              key={m.value}
              onClick={() => { onChange(selected === m.value ? null : m.value); setOpen(false); }}
              className="w-full flex items-center justify-between px-4 py-2 text-sm hover:bg-[var(--background)] transition-colors text-[var(--foreground)]"
            >
              <span>{m.label}</span>
              {selected === m.value && <Check className="w-3.5 h-3.5 text-[var(--accent)]" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
interface MomentsFiltersProps {
  filters: MomentsFilterState;
  onChange: (f: MomentsFilterState) => void;
}

export function MomentsFilters({ filters, onChange }: MomentsFiltersProps) {
  const hasActive =
    filters.types.length > 0 ||
    filters.categories.length > 0 ||
    filters.priorities.length > 0 ||
    filters.platforms.length > 0 ||
    filters.month !== null ||
    filters.search.trim() !== '';

  function clearAll() {
    onChange({ search: '', types: [], categories: [], priorities: [], platforms: [], month: null });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Filters icon label */}
      <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[var(--card-border)] bg-[var(--card)] text-sm font-medium text-[var(--accent)]">
        <Filter className="w-4 h-4" />
        <span>Filters</span>
      </div>

      {/* Month */}
      <MonthDropdown selected={filters.month} onChange={val => onChange({ ...filters, month: val })} />

      {/* Categories */}
      <MultiDropdown
        label="Category"
        allLabel="All Categories"
        options={[...MOMENT_CATEGORIES]}
        selected={filters.categories}
        onChange={vals => onChange({ ...filters, categories: vals as MomentCategory[] })}
      />

      {/* Types */}
      <MultiDropdown
        label="Type"
        allLabel="All Types"
        options={[...MOMENT_TYPES]}
        selected={filters.types}
        onChange={vals => onChange({ ...filters, types: vals as MomentType[] })}
      />

      {/* Priorities */}
      <MultiDropdown
        label="Priority"
        allLabel="All Priorities"
        options={[...MOMENT_PRIORITIES]}
        selected={filters.priorities}
        onChange={vals => onChange({ ...filters, priorities: vals as MomentPriority[] })}
      />

      {/* Platforms */}
      <MultiDropdown
        label="Platform"
        allLabel="All Platforms"
        options={[...PLATFORMS]}
        selected={filters.platforms}
        onChange={vals => onChange({ ...filters, platforms: vals as Platform[] })}
      />

      {/* Clear all */}
      {hasActive && (
        <button
          onClick={clearAll}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-red-200 bg-red-50 text-red-600 text-sm font-medium hover:bg-red-100 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
          Clear
        </button>
      )}
    </div>
  );
}
