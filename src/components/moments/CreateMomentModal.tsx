'use client';

import { useState } from 'react';
import { Plus, Trash2, ExternalLink } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { trpc } from '@/lib/trpc';
import { useToast } from '@/components/ui/Toast';
import { MOMENT_CATEGORIES, MOMENT_TYPES, MOMENT_PRIORITIES, PLATFORMS } from '@/lib/constants';
import type { MomentType, MomentCategory, MomentPriority, Platform, ReferenceUrl } from '@/types';
import { cn } from '@/lib/utils';

const URL_LABELS = ['Post', 'Reel', 'Story', 'Video', 'Image', 'Profile', 'Short', 'Tweet', 'Article', 'Other'];

const emptyForm = {
  name: '', description: '', type: 'Fluid' as MomentType,
  category: 'Entertainment' as MomentCategory, priority: 'Medium' as MomentPriority,
  platforms: ['Instagram'] as Platform[], date: '', imageUrl: '', tags: '',
};

function openLink(url: string) {
  const a = document.createElement('a');
  a.href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function CreateMomentModal({ open, onClose }: Props) {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const [form, setForm] = useState({ ...emptyForm });
  const [refUrls, setRefUrls] = useState<ReferenceUrl[]>([]);

  const create = trpc.moments.createCustom.useMutation({
    onSuccess: () => {
      toast('Custom moment created!');
      utils.moments.list.invalidate();
      onClose();
      setForm({ ...emptyForm });
      setRefUrls([]);
    },
    onError: e => toast(e.message, 'error'),
  });

  function togglePlatform(p: Platform) {
    setForm(f => ({
      ...f,
      platforms: f.platforms.includes(p) ? f.platforms.filter(x => x !== p) : [...f.platforms, p],
    }));
  }

  function addUrl() {
    setRefUrls(u => [...u, { url: '', label: 'Post' }]);
  }

  function updateUrl(i: number, patch: Partial<ReferenceUrl>) {
    setRefUrls(u => u.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  }

  function removeUrl(i: number) {
    setRefUrls(u => u.filter((_, idx) => idx !== i));
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
      referenceUrls: refUrls.filter(r => r.url.trim()),
      tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
    });
  }

  const inputCls = 'w-full border border-[var(--card-border)] rounded-xl px-3 py-2 text-sm bg-[var(--background)] text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40';

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
            placeholder="e.g., Summer Sale Campaign" className={inputCls} />
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
            className={inputCls}>
            {MOMENT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </LabeledRow>

        {form.type === 'Fixed' && (
          <LabeledRow label="Date">
            <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
              className={inputCls} />
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

        <LabeledRow label="Cover Image URL (optional)">
          <input value={form.imageUrl} onChange={e => setForm(f => ({ ...f, imageUrl: e.target.value }))}
            placeholder="https://images.unsplash.com/..."
            className={inputCls} />
        </LabeledRow>

        {/* Reference URLs */}
        <LabeledRow label="Reference Links (optional)">
          <div className="space-y-2">
            {refUrls.map((ref, i) => (
              <div key={i} className="flex gap-2 items-center">
                <select
                  value={ref.label}
                  onChange={e => updateUrl(i, { label: e.target.value })}
                  className="border border-[var(--card-border)] rounded-xl px-2 py-2 text-xs bg-[var(--background)] text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40 flex-shrink-0"
                >
                  {URL_LABELS.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
                <input
                  value={ref.url}
                  onChange={e => updateUrl(i, { url: e.target.value })}
                  placeholder="Paste any URL — reel, post, profile, image…"
                  className="flex-1 border border-[var(--card-border)] rounded-xl px-3 py-2 text-sm bg-[var(--background)] text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
                />
                {ref.url && (
                  <button type="button" onClick={() => openLink(ref.url)}
                    className="p-2 rounded-xl border border-[var(--card-border)] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition-colors flex-shrink-0">
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                )}
                <button type="button" onClick={() => removeUrl(i)}
                  className="p-2 rounded-xl border border-[var(--card-border)] text-[var(--muted)] hover:text-red-500 hover:border-red-300 transition-colors flex-shrink-0">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <button type="button" onClick={addUrl}
              className="flex items-center gap-1.5 text-xs font-medium text-[var(--accent)] hover:text-[var(--accent)]/80 transition-colors">
              <Plus className="w-3.5 h-3.5" />
              Add URL
            </button>
          </div>
        </LabeledRow>

        <LabeledRow label="Tags (comma separated)">
          <input value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
            placeholder="cricket, sports, ipl"
            className={inputCls} />
        </LabeledRow>

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={create.isPending}>Create Moment</Button>
        </div>
      </form>
    </Modal>
  );
}
