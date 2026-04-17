'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
}

const sizeClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
  full: 'max-w-5xl',
};

export function Modal({ open, onClose, title, subtitle, children, className, size = 'md' }: ModalProps) {
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className={cn(
        'relative w-full bg-[var(--card)] rounded-2xl shadow-2xl border border-[var(--card-border)] max-h-[90vh] flex flex-col',
        sizeClasses[size],
        className,
      )}>
        {(title || subtitle) && (
          <div className="flex items-start justify-between p-5 border-b border-[var(--card-border)]">
            <div>
              {title && <h2 className="text-lg font-semibold text-[var(--foreground)]">{title}</h2>}
              {subtitle && <p className="text-sm text-[var(--muted)] mt-0.5">{subtitle}</p>}
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-[var(--card-border)] transition-colors ml-4 flex-shrink-0"
            >
              <X className="w-4 h-4 text-[var(--muted)]" />
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
}
