'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { trpc } from '@/lib/trpc';
import { useToast } from '@/components/ui/Toast';
import { MOMENT_CATEGORIES, MOMENT_TYPES, MOMENT_PRIORITIES, PLATFORMS } from '@/lib/constants';
import type { MomentType, MomentCategory, MomentPriority, Platform } from '@/types';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function CreateMomentModal({ open, onClose }: Props) {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const [form, setForm] = useState({
    name: '', description: '', type: 'Fluid' as MomentType,
    category: 'Entertainment' as MomentCategory, priority: 'Medium' as MomentPriority,
    platforms: ['Instagram'] as Platform[], date: '', imageUrl: '', tags: '',
  });

  const create = trpc.moments.createCustom.useMutation({
    onSuccess: () => {
      toast('Custom moment created!');
      utils.moments.list.invalidate();
      onClose();
      setForm({ name: '', description: '', type: 'Fluid', category: 'Entertainment', priority: 'Medium', platforms: ['Instagram'], date: '', imageUrl: '', tags: '' });
    },
    onError: e => toast(e.message, 'error'),
  });

  function togglePlatform(p: Platform) {
    setForm(f => ({
      ...f,
      platforms: f.platforms.includes(p) ? f.platforms.filter(x => x !== p) : [...f.platforms, p],
    }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.description.trim() || form.platforms.length === 0) {
      toast('Please fill all required fields', 'error'); return;
    }
    create.mutate({
      name: form.name.trim(),
      description: form.description.trim(),
      type: form.type,
      category: form.category,
      priority: form.priority,
      platforms: form.platforms,
      date: form.type === 'Fixed' && form.date ? form.date : undefined,
      imageUrl: form.imageUrl.trim() || undefined,
      tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
    });
  }

  const LabeledRow = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-[var(--foreground)]">{label}</label>
      {children}
    </div>
  );

  return (
    <Modal open={open} onClose={onClose} title="Create Custom Moment" subtitle="Define your own trending moment" size="lg">
      <form onSubmit={submit} className="p-5 space-y-4">
        <LabeledRow label="Name *">
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="e.g., Summer Sale Campaign"
            className="w-full border border-[var(--card-border)] rounded-xl px-3 py-2 text-sm bg-[var(--background)] text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40" />
        </LabeledRow>

        <LabeledRow label="Description *">
          <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            rows={3} placeholder="What's happening and why it matters..."
            className="w-full border border-[var(--card-border)] rounded-xl px-3 py-2 text-sm bg-[var(--background)] text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40 resize-none" />
        </LabeledRow>

        <div className="grid grid-cols-2 gap-4">
          <LabeledRow label="Type *">
            <div className="flex gap-2 flex-wrap">
              {MOMENT_TYPES.map(t => (
                <button key={t} type="button" onClick={() => setForm(f => ({ ...f, type: t }))}
                  className={cn('px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
                    form.type === t ? 'bg-[var(--accent)] text-white border-[var(--accent)]' : 'border-[var(--card-border)] text-[var(--muted)] hover:border-[var(--accent)]')}>
                  {t}
                </button>
              ))}
            </div>
          </LabeledRow>

          <LabeledRow label="Priority *">
            <div className="flex gap-2">
              {MOMENT_PRIORITIES.map(p => {
                const colors = { High: 'bg-red-500 text-white border-red-500', Medium: 'bg-amber-500 text-white border-amber-500', Low: 'bg-emerald-500 text-white border-emerald-500' };
                return (
                  <button key={p} type="button" onClick={() => setForm(f => ({ ...f, priority: p }))}
                    className={cn('px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
                      form.priority === p ? colors[p] : 'border-[var(--card-border)] text-[var(--muted)] hover:border-[var(--accent)]')}>
                    {p}
                  </button>
                );
              })}
            </div>
          </LabeledRow>
        </div>

        <LabeledRow label="Category *">
          <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value as MomentCategory }))}
            className="w-full border border-[var(--card-border)] rounded-xl px-3 py-2 text-sm bg-[var(--background)] text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40">
            {MOMENT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </LabeledRow>

        {form.type === 'Fixed' && (
          <LabeledRow label="Date">
            <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
              className="w-full border border-[var(--card-border)] rounded-xl px-3 py-2 text-sm bg-[var(--background)] text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40" />
          </LabeledRow>
        )}

        <LabeledRow label="Platforms *">
          <div className="flex flex-wrap gap-2">
            {PLATFORMS.map(p => (
              <button key={p} type="button" onClick={() => togglePlatform(p)}
                className={cn('px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
                  form.platforms.includes(p) ? 'bg-[var(--accent)] text-white border-[var(--accent)]' : 'border-[var(--card-border)] text-[var(--muted)] hover:border-[var(--accent)]')}>
                {p}
              </button>
            ))}
          </div>
        </LabeledRow>

        <LabeledRow label="Image URL (optional)">
          <input value={form.imageUrl} onChange={e => setForm(f => ({ ...f, imageUrl: e.target.value }))}
            placeholder="https://images.unsplash.com/..."
            className="w-full border border-[var(--card-border)] rounded-xl px-3 py-2 text-sm bg-[var(--background)] text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40" />
        </LabeledRow>

        <LabeledRow label="Tags (comma separated)">
          <input value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
            placeholder="cricket, sports, ipl"
            className="w-full border border-[var(--card-border)] rounded-xl px-3 py-2 text-sm bg-[var(--background)] text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40" />
        </LabeledRow>

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={create.isPending}>Create Moment</Button>
        </div>
      </form>
    </Modal>
  );
}
