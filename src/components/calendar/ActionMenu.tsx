'use client';

import { useState, useRef, useEffect } from 'react';
import { MoreVertical, Trash2, FileEdit } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { useToast } from '@/components/ui/Toast';
import type { CalendarEntry } from '@/types';

interface Props {
  entry: CalendarEntry;
  onViewMoment?: (entry: CalendarEntry) => void;
  onMakePost: (entry: CalendarEntry) => void;
}

export function ActionMenu({ entry, onMakePost }: Props) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const remove = trpc.calendar.removeMoment.useMutation({
    onSuccess: () => { toast('Moment removed from calendar'); utils.calendar.list.invalidate(); },
    onError: e => toast(e.message, 'error'),
  });

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function handleOpen() {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      // Decide whether to open upward or downward
      const spaceBelow = window.innerHeight - rect.bottom;
      const menuHeight = 90; // approx 2 items
      if (spaceBelow < menuHeight) {
        setMenuStyle({ position: 'fixed', top: rect.top - menuHeight - 4, left: rect.right - 176, zIndex: 9999 });
      } else {
        setMenuStyle({ position: 'fixed', top: rect.bottom + 4, left: rect.right - 176, zIndex: 9999 });
      }
    }
    setOpen(v => !v);
  }

  const items = [
    { icon: FileEdit, label: 'Make Post', onClick: () => { onMakePost(entry); setOpen(false); } },
    { icon: Trash2, label: 'Remove Moment', danger: true, onClick: () => {
      if (confirm(`Remove "${entry.moment.name}" from calendar?`)) {
        remove.mutate({ id: entry.id });
      }
      setOpen(false);
    }},
  ];

  return (
    <div ref={ref} className="relative">
      <button
        ref={btnRef}
        onClick={handleOpen}
        className="p-1.5 rounded-lg hover:bg-[var(--card-border)] transition-colors text-[var(--muted)]"
      >
        <MoreVertical className="w-4 h-4" />
      </button>
      {open && (
        <div style={menuStyle} className="w-44 bg-[var(--card)] border border-[var(--card-border)] rounded-xl shadow-xl py-1">
          {items.map(item => (
            <button
              key={item.label}
              onClick={item.onClick}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors ${
                item.danger ? 'text-red-500 hover:bg-red-50' : 'text-[var(--foreground)] hover:bg-[var(--background)]'
              }`}
            >
              <item.icon className="w-3.5 h-3.5" />
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
