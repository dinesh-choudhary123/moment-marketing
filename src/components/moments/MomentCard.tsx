'use client';

import { useState } from 'react';
import Image from 'next/image';
import { CalendarPlus, CalendarX, TrendingUp, Zap, Tag, Clock, X } from 'lucide-react';
import type { Moment } from '@/types';
import { TypeBadge, CategoryBadge, PriorityDot } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { PlatformIconList } from './PlatformIcon';
import { trpc } from '@/lib/trpc';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';

interface MomentCardProps {
  moment: Moment;
  onAdded?: () => void;
}

const INSIGHTS: Record<string, string> = {
  Sports: 'Sports moments drive 3-5x higher engagement. Best time to post is 30 min before the event and right after the final result.',
  Entertainment: 'Entertainment trends peak within 24–48 hrs of release. Meme formats and reaction posts perform best.',
  Tech: 'Tech announcements get strong organic reach on Twitter/X and LinkedIn. B2B brands should focus on insights and opinions.',
  Finance: 'Finance content resonates best with working professionals 8–10 AM and 6–8 PM IST. Trust signals matter most.',
  Fashion: 'Fashion trends are highly visual. Reels and Stories drive discovery. Collaborate with nano-influencers for authenticity.',
  Food: 'Food content peaks around meal times (12–2 PM, 7–9 PM). Recipe formats get 2x saves vs regular posts.',
  Travel: 'Travel inspiration content gets high saves. Aspirational visuals with practical tips drive the most shares.',
  Health: 'Health content performs well with before/after storytelling. Credibility and data references boost trust.',
  Education: 'Educational carousels and infographics get the highest saves. "Did you know?" hooks work great.',
  Culture: 'Cultural moments are time-sensitive. Move fast and keep the tone celebratory and inclusive.',
  Business: 'Business moments work well with thought leadership angles. LinkedIn native content outperforms shared links.',
  Politics: 'Political content requires careful positioning. Focus on factual angles and audience safety.',
};

export function MomentCard({ moment, onAdded }: MomentCardProps) {
  const { toast } = useToast();
  const [imgError, setImgError] = useState(false);
  const [imgZoomed, setImgZoomed] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const momentDate = moment.date ?? new Date().toISOString().split('T')[0];

  const utils = trpc.useUtils();

  // Check if this moment is already in calendar
  const { data: calendarEntries = [] } = trpc.calendar.list.useQuery({});
  const calendarEntry = calendarEntries.find(e => e.moment.id === moment.id);
  const isInCalendar = !!calendarEntry;

  const addToCalendar = trpc.moments.addToCalendar.useMutation({
    onSuccess: () => {
      toast(`"${moment.name}" added to calendar!`);
      utils.calendar.list.invalidate();
      onAdded?.();
    },
    onError: (e) => toast(e.message, 'error'),
  });

  const removeFromCalendar = trpc.calendar.removeMoment.useMutation({
    onSuccess: () => {
      toast(`"${moment.name}" removed from calendar`);
      utils.calendar.list.invalidate();
    },
    onError: (e) => toast(e.message, 'error'),
  });

  const placeholderColors = [
    'from-indigo-400 to-purple-500',
    'from-pink-400 to-rose-500',
    'from-amber-400 to-orange-500',
    'from-cyan-400 to-blue-500',
    'from-emerald-400 to-teal-500',
  ];
  const colorClass = placeholderColors[moment.name.charCodeAt(0) % placeholderColors.length];
  const insight = INSIGHTS[moment.category] ?? 'Track this moment early to get ahead of the trend curve. Authentic, timely content wins.';

  return (
    <>
      <div className="group bg-[var(--card)] border border-[var(--card-border)] rounded-2xl overflow-hidden hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200">
        {/* Image */}
        <div className="relative aspect-video bg-gradient-to-br overflow-hidden">
          {moment.imageUrl && !imgError ? (
            <Image
              src={moment.imageUrl}
              alt={moment.name}
              fill
              className="object-cover group-hover:scale-105 transition-transform duration-300 cursor-zoom-in"
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
              unoptimized
              onError={() => setImgError(true)}
              onClick={() => setImgZoomed(true)}
            />
          ) : (
            <div className={cn('absolute inset-0 bg-gradient-to-br', colorClass, 'flex items-center justify-center')}>
              <TrendingUp className="w-10 h-10 text-white/60" />
            </div>
          )}
          {/* Overlays */}
          <div className="absolute top-2 left-2">
            <TypeBadge type={moment.type} />
          </div>
          <div className="absolute top-2 right-2 flex items-center gap-1.5">
            <PriorityDot priority={moment.priority} />
            <span className="text-xs font-semibold text-white drop-shadow bg-black/40 px-1.5 py-0.5 rounded-full">
              {moment.trendingScore}
            </span>
          </div>
          {moment.isCustom && (
            <div className="absolute bottom-2 left-2">
              <span className="text-[10px] font-semibold bg-white/90 text-gray-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                <Zap className="w-2.5 h-2.5" /> Custom
              </span>
            </div>
          )}
        </div>

        {/* Body — click to open detail popup */}
        <div
          className="p-4 flex flex-col gap-3 cursor-pointer"
          onClick={() => setDetailOpen(true)}
        >
          <div>
            <h3 className="font-semibold text-sm text-[var(--foreground)] line-clamp-2 leading-snug mb-1">
              {moment.name}
            </h3>
            <p className="text-xs text-[var(--muted)] line-clamp-2 leading-relaxed">
              {moment.description}
            </p>
          </div>

          {moment.date && (
            <p className="text-[11px] text-[var(--muted)] font-medium flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {new Date(moment.date + 'T00:00:00').toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric',
              })}
            </p>
          )}

          <div className="flex items-center justify-between">
            <CategoryBadge category={moment.category} />
            <PlatformIconList platforms={moment.platforms} />
          </div>

          {moment.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {moment.tags.slice(0, 3).map(tag => (
                <span key={tag} className="inline-flex items-center gap-0.5 text-[10px] text-[var(--muted)] bg-[var(--card-border)] px-1.5 py-0.5 rounded-full">
                  <Tag className="w-2 h-2" />{tag}
                </span>
              ))}
            </div>
          )}

          {/* Calendar button — stop propagation so clicking button doesn't open detail */}
          <div onClick={e => e.stopPropagation()}>
            {isInCalendar ? (
              <Button
                size="sm"
                variant="secondary"
                className="w-full mt-1 border-red-300 text-red-600 hover:bg-red-50"
                loading={removeFromCalendar.isPending}
                onClick={() => removeFromCalendar.mutate({ id: calendarEntry!.id })}
              >
                <CalendarX className="w-3.5 h-3.5" />
                Remove from Calendar
              </Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                className="w-full mt-1"
                loading={addToCalendar.isPending}
                onClick={() => addToCalendar.mutate({ momentId: moment.id, date: momentDate })}
              >
                <CalendarPlus className="w-3.5 h-3.5" />
                Add to Calendar
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Image Lightbox */}
      {imgZoomed && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4"
          onClick={() => setImgZoomed(false)}
        >
          <button
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white"
            onClick={() => setImgZoomed(false)}
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={moment.imageUrl}
            alt={moment.name}
            className="max-w-full max-h-[90vh] object-contain rounded-xl"
          />
        </div>
      )}

      {/* Detail Popup */}
      {detailOpen && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setDetailOpen(false)}
        >
          <div
            className="relative w-full max-w-md bg-[var(--card)] rounded-2xl shadow-2xl border border-[var(--card-border)] overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header image strip */}
            {moment.imageUrl && !imgError && (
              <div className="relative h-32 w-full overflow-hidden">
                <img src={moment.imageUrl} alt={moment.name} className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
              </div>
            )}

            <button
              className="absolute top-3 right-3 p-1.5 rounded-full bg-black/30 hover:bg-black/50 text-white"
              onClick={() => setDetailOpen(false)}
            >
              <X className="w-4 h-4" />
            </button>

            <div className="p-5 space-y-4">
              {/* Name + badges */}
              <div>
                <h2 className="text-base font-bold text-[var(--foreground)] leading-snug mb-2">{moment.name}</h2>
                <div className="flex flex-wrap items-center gap-2">
                  <TypeBadge type={moment.type} />
                  <CategoryBadge category={moment.category} />
                  <span className={cn(
                    'text-[10px] font-semibold px-2 py-0.5 rounded-full',
                    moment.priority === 'High' ? 'bg-red-100 text-red-600' :
                    moment.priority === 'Medium' ? 'bg-amber-100 text-amber-600' :
                    'bg-gray-100 text-gray-500'
                  )}>
                    {moment.priority} Priority
                  </span>
                </div>
              </div>

              {/* Trending on */}
              <div>
                <p className="text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wide mb-1.5">Trending On</p>
                <div className="flex items-center gap-2">
                  <PlatformIconList platforms={moment.platforms} />
                  <span className="text-xs text-[var(--muted)]">{moment.platforms.join(', ')}</span>
                </div>
              </div>

              {/* When */}
              {moment.date && (
                <div>
                  <p className="text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wide mb-1">When Trending</p>
                  <p className="text-sm text-[var(--foreground)] flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-[var(--muted)]" />
                    {new Date(moment.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                  </p>
                </div>
              )}

              {/* Context */}
              <div>
                <p className="text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wide mb-1">Context</p>
                <p className="text-xs text-[var(--foreground)] leading-relaxed">{moment.description}</p>
              </div>

              {/* Tags */}
              {moment.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {moment.tags.map(tag => (
                    <span key={tag} className="inline-flex items-center gap-0.5 text-[10px] text-[var(--muted)] bg-[var(--card-border)] px-1.5 py-0.5 rounded-full">
                      <Tag className="w-2 h-2" />{tag}
                    </span>
                  ))}
                </div>
              )}

              {/* Insight */}
              <div className="bg-[var(--accent-light)] rounded-xl p-3">
                <p className="text-[11px] font-semibold text-[var(--accent)] uppercase tracking-wide mb-1">💡 Marketing Insight</p>
                <p className="text-xs text-[var(--foreground)] leading-relaxed">{insight}</p>
              </div>

              {/* Trending score */}
              <div className="flex items-center justify-between text-xs text-[var(--muted)]">
                <span>Trending Score: <strong className="text-[var(--foreground)]">{moment.trendingScore}</strong></span>
                </div>

              {/* Action */}
              <div onClick={e => e.stopPropagation()}>
                {isInCalendar ? (
                  <Button
                    variant="secondary"
                    className="w-full border-red-300 text-red-600 hover:bg-red-50"
                    loading={removeFromCalendar.isPending}
                    onClick={() => { removeFromCalendar.mutate({ id: calendarEntry!.id }); setDetailOpen(false); }}
                  >
                    <CalendarX className="w-4 h-4" />
                    Remove from Calendar
                  </Button>
                ) : (
                  <Button
                    className="w-full"
                    loading={addToCalendar.isPending}
                    onClick={() => { addToCalendar.mutate({ momentId: moment.id, date: momentDate }); setDetailOpen(false); }}
                  >
                    <CalendarPlus className="w-4 h-4" />
                    Add to Calendar
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
