import { cn } from '@/lib/utils';
import type { MomentType, MomentCategory, MomentPriority } from '@/types';
import { TYPE_COLORS, CATEGORY_COLORS, PRIORITY_COLORS } from '@/lib/constants';

interface BadgeProps {
  children: React.ReactNode;
  className?: string;
  variant?: 'default' | 'outline';
}

export function Badge({ children, className, variant = 'default' }: BadgeProps) {
  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
      variant === 'outline' && 'border border-current bg-transparent',
      className,
    )}>
      {children}
    </span>
  );
}

export function TypeBadge({ type }: { type: MomentType }) {
  return <Badge className={TYPE_COLORS[type]}>{type}</Badge>;
}

export function CategoryBadge({ category }: { category: MomentCategory }) {
  return <Badge className={CATEGORY_COLORS[category]}>{category}</Badge>;
}

export function PriorityDot({ priority }: { priority: MomentPriority }) {
  return (
    <span className={cn('inline-block w-2 h-2 rounded-full', PRIORITY_COLORS[priority])} title={priority} />
  );
}

export function PriorityBadge({ priority }: { priority: MomentPriority }) {
  const colors: Record<MomentPriority, string> = {
    High: 'bg-red-100 text-red-700',
    Medium: 'bg-amber-100 text-amber-700',
    Low: 'bg-emerald-100 text-emerald-700',
  };
  return <Badge className={colors[priority]}>{priority}</Badge>;
}
