'use client';

import Link from 'next/link';
import { TrendingUp, Calendar, Sparkles, ArrowRight, Zap, Target, BarChart3 } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { ToastProvider } from '@/components/ui/Toast';
import { TypeBadge, PriorityBadge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';

export default function DashboardPage() {
  const { data: moments } = trpc.moments.list.useQuery({});
  const { data: calendarEntries } = trpc.calendar.list.useQuery({});
  const { data: scraperStatus } = trpc.scraper.getStatus.useQuery();

  const highPriority = moments?.filter(m => m.priority === 'High').length ?? 0;
  const upcoming = calendarEntries?.filter(e => new Date(e.date) >= new Date()).length ?? 0;

  const stats = [
    { label: 'Total Moments', value: scraperStatus?.totalMoments ?? 0, icon: TrendingUp, color: 'text-indigo-500', bg: 'bg-indigo-50' },
    { label: 'In My Calendar', value: calendarEntries?.length ?? 0, icon: Calendar, color: 'text-emerald-500', bg: 'bg-emerald-50' },
    { label: 'High Priority', value: highPriority, icon: Zap, color: 'text-red-500', bg: 'bg-red-50' },
    { label: 'Upcoming Events', value: upcoming, icon: Target, color: 'text-amber-500', bg: 'bg-amber-50' },
  ];

  const recentMoments = moments?.slice(0, 6) ?? [];

  return (
    <ToastProvider>
      <div className="min-h-screen bg-[var(--background)] p-6">
        <div className="max-w-screen-xl mx-auto space-y-8">
          {/* Hero */}
          <div className="bg-gradient-to-br from-indigo-600 to-purple-700 rounded-2xl p-8 text-white relative overflow-hidden">
            <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23ffffff\' fill-opacity=\'0.05\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E')] opacity-30" />
            <div className="relative z-10">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-5 h-5 text-indigo-200" />
                <span className="text-sm text-indigo-200 font-medium">Welcome to Moment Marketing</span>
              </div>
              <h1 className="text-2xl font-bold mb-2">Capture Every Trending Moment</h1>
              <p className="text-indigo-200 text-sm max-w-lg">
                Track Fixed, Fluid, and Brand moments across all platforms. Add them to your calendar, benchmark competitors, and create posts — all in one place.
              </p>
              <div className="flex gap-3 mt-6">
                <Link href="/moments" className="inline-flex items-center gap-2 px-4 py-2 bg-white text-indigo-700 rounded-xl text-sm font-semibold hover:bg-indigo-50 transition-colors">
                  <TrendingUp className="w-4 h-4" /> Browse Moments
                </Link>
                <Link href="/calendar" className="inline-flex items-center gap-2 px-4 py-2 bg-white/20 text-white rounded-xl text-sm font-semibold hover:bg-white/30 transition-colors">
                  <Calendar className="w-4 h-4" /> View Calendar
                </Link>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {stats.map(stat => (
              <div key={stat.label} className="bg-[var(--card)] border border-[var(--card-border)] rounded-2xl p-5">
                <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center mb-3', stat.bg)}>
                  <stat.icon className={cn('w-5 h-5', stat.color)} />
                </div>
                <p className="text-2xl font-bold text-[var(--foreground)]">{stat.value}</p>
                <p className="text-xs text-[var(--muted)] mt-0.5">{stat.label}</p>
              </div>
            ))}
          </div>

          {/* Recent Moments */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-[var(--foreground)] flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-[var(--accent)]" />
                Trending Now
              </h2>
              <Link href="/moments" className="text-xs text-[var(--accent)] flex items-center gap-1 font-medium hover:underline">
                View all <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {recentMoments.map(moment => (
                <div key={moment.id} className="bg-[var(--card)] border border-[var(--card-border)] rounded-xl p-4 flex items-start gap-3 hover:shadow-sm transition-shadow">
                  <div className={cn(
                    'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-lg',
                    moment.priority === 'High' ? 'bg-red-50' : moment.priority === 'Medium' ? 'bg-amber-50' : 'bg-emerald-50',
                  )}>
                    {moment.category === 'Sports' ? '🏏' : moment.category === 'Movies' ? '🎬' : moment.category === 'Music' ? '🎵' : moment.category === 'Tech' ? '💻' : moment.category === 'Food' ? '🍜' : moment.category === 'Gaming' ? '🎮' : '✨'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[var(--foreground)] line-clamp-1">{moment.name}</p>
                    <p className="text-xs text-[var(--muted)] line-clamp-1 mt-0.5">{moment.description.slice(0, 60)}…</p>
                    <div className="flex items-center gap-2 mt-2">
                      <TypeBadge type={moment.type} />
                      <PriorityBadge priority={moment.priority} />
                    </div>
                  </div>
                  <div className="text-xs font-bold text-[var(--accent)] flex-shrink-0">{moment.trendingScore}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Calendar Preview */}
          {calendarEntries && calendarEntries.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-[var(--foreground)] flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-[var(--accent)]" />
                  Upcoming in Calendar
                </h2>
                <Link href="/calendar" className="text-xs text-[var(--accent)] flex items-center gap-1 font-medium hover:underline">
                  View all <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
              <div className="bg-[var(--card)] border border-[var(--card-border)] rounded-2xl overflow-hidden">
                {calendarEntries.slice(0, 3).map((entry, i) => (
                  <div key={entry.id} className={cn('flex items-center gap-4 p-4', i !== 0 && 'border-t border-[var(--card-border)]')}>
                    <div className="w-10 h-10 rounded-xl bg-[var(--accent-light)] flex flex-col items-center justify-center flex-shrink-0">
                      <span className="text-[9px] font-bold text-[var(--accent)] uppercase">
                        {new Date(entry.date).toLocaleString('en-US', { month: 'short' })}
                      </span>
                      <span className="text-sm font-bold text-[var(--accent)] leading-tight">
                        {new Date(entry.date).getDate()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[var(--foreground)] line-clamp-1">{entry.moment.name}</p>
                      <p className="text-xs text-[var(--muted)]">{entry.day} • {entry.ownership}</p>
                    </div>
                    <TypeBadge type={entry.moment.type} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </ToastProvider>
  );
}
