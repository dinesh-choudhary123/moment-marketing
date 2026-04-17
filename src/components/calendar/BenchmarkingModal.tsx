'use client';

import { useState } from 'react';
import { Plus, Trash2, Link2, Pencil, Check, X, ExternalLink } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { trpc } from '@/lib/trpc';
import { useToast } from '@/components/ui/Toast';
import type { CalendarEntry, BenchmarkEntry } from '@/types';

interface Props {
  entry: CalendarEntry | null;
  onClose: () => void;
}

const POST_TYPES = ['Post', 'Reel', 'Story', 'Video', 'Tweet', 'Short'];

const emptyForm = { type: 'Post', brandName: '', url: '', likes: 0, comments: 0, shares: 0, views: 0 };

export function BenchmarkingModal({ entry, onClose }: Props) {
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const [form, setForm] = useState({ ...emptyForm });
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<BenchmarkEntry>>({});
  const [fetchingUrl, setFetchingUrl] = useState(false);
  const [fetchingEditUrl, setFetchingEditUrl] = useState(false);

  const addBenchmark = trpc.calendar.addBenchmark.useMutation({
    onSuccess: () => {
      toast('Benchmark added!');
      utils.calendar.list.invalidate();
      setForm({ ...emptyForm });
    },
    onError: e => toast(e.message, 'error'),
  });

  const updateBenchmark = trpc.calendar.updateBenchmark.useMutation({
    onSuccess: () => {
      toast('Benchmark updated!');
      utils.calendar.list.invalidate();
      setEditId(null);
      setEditForm({});
    },
    onError: e => toast(e.message, 'error'),
  });

  const removeBenchmark = trpc.calendar.removeBenchmark.useMutation({
    onSuccess: () => { toast('Benchmark removed'); utils.calendar.list.invalidate(); },
  });

  const fetchUrlMeta = trpc.calendar.fetchUrlMeta.useMutation();

  async function handleAutoFetch() {
    if (!form.url) { toast('Enter a URL first', 'error'); return; }
    setFetchingUrl(true);
    toast('Scraping metrics… this takes ~30-60s');
    try {
      const result = await fetchUrlMeta.mutateAsync({ url: form.url });
      setForm(f => ({
        ...f,
        likes: result.likes, views: result.views, comments: result.comments, shares: result.shares,
        ...(result.brandName && !f.brandName ? { brandName: result.brandName } : {}),
      }));
      if (result.fetched) toast('✅ Metrics fetched successfully!');
      else toast('Could not extract metrics automatically — enter manually', 'error');
    } catch (e) {
      console.error('[BenchmarkingModal] fetchUrlMeta error:', e);
      toast('Scraping failed — check server logs or enter manually', 'error');
    } finally {
      setFetchingUrl(false);
    }
  }

  async function handleEditAutoFetch() {
    if (!editForm.url) { toast('Enter a URL first', 'error'); return; }
    setFetchingEditUrl(true);
    toast('Scraping metrics… this takes ~30-60s');
    try {
      const result = await fetchUrlMeta.mutateAsync({ url: editForm.url });
      setEditForm(f => ({ ...f, likes: result.likes, views: result.views, comments: result.comments, shares: result.shares }));
      if (result.fetched) toast('✅ Metrics fetched successfully!');
      else toast('Could not extract metrics — enter manually', 'error');
    } catch (e) {
      console.error('[BenchmarkingModal] fetchUrlMeta edit error:', e);
      toast('Scraping failed — enter metrics manually', 'error');
    } finally {
      setFetchingEditUrl(false);
    }
  }

  function startEdit(b: BenchmarkEntry) {
    setEditId(b.id);
    setEditForm({ type: b.type, brandName: b.brandName, url: b.url, likes: b.likes, comments: b.comments, shares: b.shares, views: b.views });
  }

  function saveEdit() {
    if (!entry || !editId) return;
    updateBenchmark.mutate({ calendarEntryId: entry.id, benchmarkId: editId, ...editForm });
  }

  if (!entry) return null;

  return (
    <Modal open={!!entry} onClose={onClose} title="Benchmarking" subtitle={entry.moment.name} size="lg">
      <div className="p-5 space-y-5">
        {/* Existing benchmarks */}
        {entry.benchmarks.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">Saved Benchmarks</p>
            {entry.benchmarks.map(b => (
              <div key={b.id} className="p-3 bg-[var(--background)] rounded-xl border border-[var(--card-border)]">
                {editId === b.id ? (
                  /* Edit mode */
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <select value={editForm.type} onChange={e => setEditForm(f => ({ ...f, type: e.target.value }))}
                        className="border border-[var(--card-border)] rounded-lg px-2 py-1.5 text-xs bg-[var(--background)] text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40">
                        {POST_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <input value={editForm.brandName ?? ''} onChange={e => setEditForm(f => ({ ...f, brandName: e.target.value }))}
                        placeholder="Brand name"
                        className="border border-[var(--card-border)] rounded-lg px-2 py-1.5 text-xs bg-[var(--background)] text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40" />
                    </div>
                    <div className="flex gap-2">
                      <div className="flex-1 relative">
                        <Link2 className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-[var(--muted)]" />
                        <input value={editForm.url ?? ''} onChange={e => setEditForm(f => ({ ...f, url: e.target.value }))}
                          placeholder="URL"
                          className="w-full border border-[var(--card-border)] rounded-lg pl-7 pr-2 py-1.5 text-xs bg-[var(--background)] text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40" />
                      </div>
                      {editForm.url && (
                        <a href={editForm.url} target="_blank" rel="noopener noreferrer"
                          className="p-1.5 rounded-lg border border-[var(--card-border)] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition-colors flex items-center">
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                      <button onClick={handleEditAutoFetch} disabled={fetchingEditUrl}
                        className="px-2 py-1 rounded-lg bg-[var(--accent)] text-white text-xs font-medium disabled:opacity-50">
                        {fetchingEditUrl ? '…' : 'Fetch'}
                      </button>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      {(['likes', 'comments', 'shares', 'views'] as const).map(field => (
                        <div key={field}>
                          <p className="text-[10px] text-[var(--muted)] capitalize mb-0.5">{field}</p>
                          <input type="number" min={0} value={(editForm as Record<string, number>)[field] ?? 0}
                            onChange={e => setEditForm(f => ({ ...f, [field]: parseInt(e.target.value) || 0 }))}
                            className="w-full border border-[var(--card-border)] rounded-lg px-2 py-1 text-xs bg-[var(--background)] text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40" />
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-end gap-2">
                      <button onClick={() => { setEditId(null); setEditForm({}); }}
                        className="p-1.5 rounded-lg hover:bg-[var(--card-border)] text-[var(--muted)] transition-colors">
                        <X className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={saveEdit} disabled={updateBenchmark.isPending}
                        className="p-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white transition-colors disabled:opacity-50">
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ) : (
                  /* View mode */
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium text-[var(--foreground)]">{b.brandName}</span>
                        <span className="text-xs bg-[var(--accent-light)] text-[var(--accent)] px-1.5 py-0.5 rounded-full">{b.type}</span>
                        {b.url && (
                          <a href={b.url} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 text-[10px] text-[var(--accent)] hover:underline">
                            <ExternalLink className="w-2.5 h-2.5" /> Open
                          </a>
                        )}
                      </div>
                      <div className="flex gap-3 text-xs text-[var(--muted)] mt-1">
                        <span>👍 {b.likes.toLocaleString()}</span>
                        <span>💬 {b.comments.toLocaleString()}</span>
                        <span>↗️ {b.shares.toLocaleString()}</span>
                        <span>👁️ {b.views.toLocaleString()}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => startEdit(b)}
                        className="p-1.5 rounded-lg hover:bg-[var(--card-border)] text-[var(--muted)] hover:text-[var(--accent)] transition-colors">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => removeBenchmark.mutate({ calendarEntryId: entry.id, benchmarkId: b.id })}
                        className="p-1.5 rounded-lg hover:bg-red-50 text-[var(--muted)] hover:text-red-500 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Add new benchmark */}
        <div className="space-y-4">
          <p className="text-sm font-semibold text-[var(--foreground)]">Add Social Media Post</p>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--muted)]">Type</label>
            <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
              className="w-full border border-[var(--card-border)] rounded-xl px-3 py-2 text-sm bg-[var(--background)] text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40">
              {POST_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--muted)]">Name of the brand</label>
            <input value={form.brandName} onChange={e => setForm(f => ({ ...f, brandName: e.target.value }))}
              placeholder="Enter brand name"
              className="w-full border border-[var(--card-border)] rounded-xl px-3 py-2 text-sm bg-[var(--background)] text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40" />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--muted)]">Post URL</label>
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--muted)]" />
                <input value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                  placeholder="Paste Instagram, Twitter, YouTube, Facebook URL"
                  className="w-full border border-[var(--card-border)] rounded-xl pl-8 pr-3 py-2 text-sm bg-[var(--background)] text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40" />
              </div>
              {form.url && (
                <a href={form.url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center px-3 py-2 rounded-xl border border-[var(--card-border)] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition-colors">
                  <ExternalLink className="w-4 h-4" />
                </a>
              )}
              <Button variant="secondary" size="sm" loading={fetchingUrl} onClick={handleAutoFetch}>
                Auto-Fetch
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {(['likes', 'comments', 'shares', 'views'] as const).map(field => (
              <div key={field} className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--muted)] capitalize">{field}</label>
                <input type="number" min={0} value={form[field]}
                  onChange={e => setForm(f => ({ ...f, [field]: parseInt(e.target.value) || 0 }))}
                  className="w-full border border-[var(--card-border)] rounded-xl px-3 py-2 text-sm bg-[var(--background)] text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40" />
              </div>
            ))}
          </div>

          <Button
            variant="success"
            className="w-full"
            loading={addBenchmark.isPending}
            onClick={() => {
              if (!form.brandName.trim()) { toast('Brand name required', 'error'); return; }
              addBenchmark.mutate({ calendarEntryId: entry.id, ...form });
            }}
          >
            <Plus className="w-4 h-4" />
            Add Benchmark
          </Button>
        </div>

        <div className="flex justify-end pt-2 border-t border-[var(--card-border)]">
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}
