import { Globe, MessageCircle, Video, Users, Search, Hash } from 'lucide-react';
import type { Platform } from '@/types';
import { cn } from '@/lib/utils';

const PLATFORM_META: Record<Platform, { icon: React.ElementType; color: string; bg: string; label: string }> = {
  Twitter: { icon: Hash, color: 'text-sky-500', bg: 'bg-sky-50', label: 'X/Twitter' },
  Instagram: { icon: Users, color: 'text-pink-500', bg: 'bg-pink-50', label: 'Instagram' },
  YouTube: { icon: Video, color: 'text-red-500', bg: 'bg-red-50', label: 'YouTube' },
  Facebook: { icon: Globe, color: 'text-blue-600', bg: 'bg-blue-50', label: 'Facebook' },
  Google: { icon: Search, color: 'text-emerald-500', bg: 'bg-emerald-50', label: 'Google' },
  Reddit: { icon: MessageCircle, color: 'text-orange-500', bg: 'bg-orange-50', label: 'Reddit' },
};

export function PlatformIcon({ platform, size = 'sm' }: { platform: Platform; size?: 'sm' | 'md' }) {
  const meta = PLATFORM_META[platform];
  const Icon = meta.icon;
  return (
    <span
      title={meta.label}
      className={cn(
        'inline-flex items-center justify-center rounded-full flex-shrink-0',
        meta.bg,
        size === 'sm' ? 'w-5 h-5' : 'w-7 h-7',
      )}
    >
      <Icon className={cn(meta.color, size === 'sm' ? 'w-3 h-3' : 'w-4 h-4')} />
    </span>
  );
}

export function PlatformIconList({ platforms }: { platforms: Platform[] }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {platforms.map(p => <PlatformIcon key={p} platform={p} />)}
    </div>
  );
}
