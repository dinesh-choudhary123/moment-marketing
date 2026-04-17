'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus, RefreshCw, TrendingUp, Loader2, Calendar } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { ToastProvider, useToast } from '@/components/ui/Toast';
import { Button } from '@/components/ui/Button';
import { MomentCard } from '@/components/moments/MomentCard';
import { MomentsFilters } from '@/components/moments/MomentsFilters';
import { CreateMomentModal } from '@/components/moments/CreateMomentModal';
import { cn } from '@/lib/utils';
import type { MomentsFilterState } from '@/types';

const defaultFilters: MomentsFilterState = {
  search: '',
  types: [],
  categories: [],
  priorities: [],
  platforms: [],
  month: null,
};

function MomentsPageInner() {
  const { toast } = useToast();
  const [filters, setFilters] = useState<MomentsFilterState>(defaultFilters);
  const [createOpen, setCreateOpen] = useState(false);

  const { data: moments, isLoading } = trpc.moments.list.useQuery(
    {
      search: filters.search || undefined,
      types: filters.types.length ? filters.types : undefined,
      categories: filters.categories.length ? filters.categories : undefined,
      priorities: filters.priorities.length ? filters.priorities : undefined,
      platforms: filters.platforms.length ? filters.platforms : undefined,
      month: filters.month,
    },
    { refetchInterval: 8000 },
  );

  const { data: scraperStatus, refetch: refetchStatus } = trpc.scraper.getStatus.useQuery(undefined, {
    refetchInterval: 4000,
  });

  const utils = trpc.useUtils();

  function onSuccess(msg?: string) {
    toast(msg ?? 'Trends refreshed!');
    utils.moments.list.invalidate();
    refetchStatus();
  }

  const scrapeAll = trpc.scraper.scrapeAll.useMutation({
    onSuccess: d => onSuccess(d.message),
    onError: e => toast(e.message, 'error'),
  });

  const scrapeReddit = trpc.scraper.scrapeReddit.useMutation({
    onSuccess: d => onSuccess(d.message),
    onError: e => toast(e.message, 'error'),
  });

  const scrapeInstagram = trpc.scraper.scrapeInstagram.useMutation({
    onSuccess: d => onSuccess(d.message),
    onError: e => toast(e.message, 'error'),
  });

  const scrapeFacebook = trpc.scraper.scrapeFacebook.useMutation({
    onSuccess: d => onSuccess(d.message),
    onError: e => toast(e.message, 'error'),
  });

  const isRunning = scraperStatus?.isRunning || scrapeAll.isPending;
  const skeletons = Array(12).fill(0);

  return (
    <div className="min-h-screen bg-[var(--background)]">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[var(--background)]/95 backdrop-blur-sm border-b border-[var(--card-border)] px-6 py-4">
        <div className="max-w-screen-xl mx-auto">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-xl font-bold text-[var(--foreground)] flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-[var(--accent)]" />
                Trending Moments
                {isRunning && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                    <Loader2 className="w-3 h-3 animate-spin" /> Fetching live trends…
                  </span>
                )}
              </h1>
              <p className="text-xs text-[var(--muted)] mt-0.5">
                {scraperStatus?.totalMoments ?? 0} moments live
                {scraperStatus?.lastScrapedAt && (
                  <> · Updated {new Date(scraperStatus.lastScrapedAt).toLocaleTimeString()}</>
                )}
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Platform refresh buttons */}
              <Button
                variant="secondary"
                size="sm"
                loading={scrapeReddit.isPending}
                onClick={() => scrapeReddit.mutate({ sort: 'top' })}
                title="Fetch viral Reddit posts"
              >
                <RefreshCw className={cn('w-3.5 h-3.5', scrapeReddit.isPending && 'animate-spin')} />
                Reddit
              </Button>

              <Button
                variant="secondary"
                size="sm"
                loading={scrapeInstagram.isPending}
                onClick={() => scrapeInstagram.mutate()}
                title="Fetch trending Instagram posts"
              >
                <RefreshCw className={cn('w-3.5 h-3.5', scrapeInstagram.isPending && 'animate-spin')} />
                Instagram
              </Button>

              <Button
                variant="secondary"
                size="sm"
                loading={scrapeFacebook.isPending}
                onClick={() => scrapeFacebook.mutate()}
                title="Fetch trending Facebook posts"
              >
                <RefreshCw className={cn('w-3.5 h-3.5', scrapeFacebook.isPending && 'animate-spin')} />
                Facebook
              </Button>

              {/* Refresh all */}
              <Button
                variant="secondary"
                size="sm"
                loading={isRunning}
                onClick={() => scrapeAll.mutate()}
                title="Fetch latest trends from all platforms"
              >
                <RefreshCw className={cn('w-3.5 h-3.5', isRunning && 'animate-spin')} />
                Refresh All
              </Button>

              {/* ── Calendar button — right next to refresh buttons ── */}
              <Link href="/calendar">
                <Button size="sm" variant="secondary" title="Go to Marketing Calendar">
                  <Calendar className="w-3.5 h-3.5" />
                  Calendar
                </Button>
              </Link>

              {/* Custom Moment */}
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="w-3.5 h-3.5" />
                Custom
              </Button>
            </div>
          </div>

          {/* Filters */}
          <div className="mt-3">
            <MomentsFilters filters={filters} onChange={setFilters} />
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="px-6 py-6 max-w-screen-xl mx-auto">
        {isRunning && (scraperStatus?.totalMoments ?? 0) === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <Loader2 className="w-10 h-10 text-[var(--accent)] animate-spin" />
            <p className="text-sm font-semibold text-[var(--foreground)]">Fetching live trends…</p>
            <p className="text-xs text-[var(--muted)]">Pulling from YouTube, Reddit, Instagram & more. Takes ~60 seconds.</p>
          </div>
        ) : isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {skeletons.map((_, i) => (
              <div key={i} className="bg-[var(--card)] border border-[var(--card-border)] rounded-2xl overflow-hidden">
                <div className="skeleton aspect-video" />
                <div className="p-4 space-y-2">
                  <div className="skeleton h-4 w-3/4 rounded" />
                  <div className="skeleton h-3 w-full rounded" />
                  <div className="skeleton h-3 w-2/3 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : moments?.length === 0 ? (
          <div className="text-center py-24">
            <TrendingUp className="w-12 h-12 text-[var(--muted)] mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-[var(--foreground)]">No moments found</h3>
            <p className="text-sm text-[var(--muted)] mt-1">
              Try adjusting filters or click <strong>Refresh All</strong> to fetch live data.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {moments?.map(moment => (
              <MomentCard key={moment.id} moment={moment} />
            ))}
          </div>
        )}
      </div>

      <CreateMomentModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

export default function MomentsPage() {
  return (
    <ToastProvider>
      <MomentsPageInner />
    </ToastProvider>
  );
}
