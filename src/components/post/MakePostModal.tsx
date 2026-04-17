'use client';

import { useState, useRef } from 'react';
import { X, Globe, Video, BookOpen, LayoutGrid, Link2, Upload, Sparkles, Save, Hash, RefreshCw, Image as ImageIcon } from 'lucide-react';
import type { CalendarEntry, PostPlatform, MediaTab } from '@/types';
import { trpc } from '@/lib/trpc';
import { useToast } from '@/components/ui/Toast';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { PLATFORM_CHAR_LIMITS } from '@/lib/constants';

interface Props {
  entry: CalendarEntry | null;
  onClose: () => void;
}

// Lucide v1 removed brand icons — using generic stand-ins
const PLATFORM_ICONS: Record<PostPlatform, { emoji: string; color: string; bg: string }> = {
  Instagram: { emoji: '📸', color: 'text-pink-600', bg: 'bg-pink-50 border-pink-200' },
  Facebook: { emoji: '🔵', color: 'text-blue-600', bg: 'bg-blue-50 border-blue-200' },
  YouTube: { emoji: '▶️', color: 'text-red-500', bg: 'bg-red-50 border-red-200' },
  LinkedIn: { emoji: '💼', color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' },
  Twitter: { emoji: '𝕏', color: 'text-sky-500', bg: 'bg-sky-50 border-sky-200' },
  Pinterest: { emoji: '📌', color: 'text-red-600', bg: 'bg-red-50 border-red-200' },
  Snapchat: { emoji: '👻', color: 'text-yellow-500', bg: 'bg-yellow-50 border-yellow-200' },
};

const MEDIA_TABS: { id: MediaTab; icon: React.ElementType; label: string }[] = [
  { id: 'Static', icon: ImageIcon, label: 'Static' },
  { id: 'Video', icon: Video, label: 'Video' },
  { id: 'Story', icon: BookOpen, label: 'Story' },
  { id: 'Carousel', icon: LayoutGrid, label: 'Carousel' },
];

const CONTENT_BUCKETS = ['Brand', 'Product', 'Campaign', 'Educational', 'Engagement', 'Seasonal'];

export function MakePostModal({ entry, onClose }: Props) {
  const { toast } = useToast();
  const [activePlatforms, setActivePlatforms] = useState<PostPlatform[]>(['Instagram']);
  const [mediaTab, setMediaTab] = useState<MediaTab>('Static');
  const [mediaInputTab, setMediaInputTab] = useState<'Enter URL' | 'Upload Creative' | 'Generate with AI'>('Upload Creative');
  const [mediaUrl, setMediaUrl] = useState('');
  const [uploadedMedia, setUploadedMedia] = useState<string | null>(null);
  const [title, setTitle] = useState(entry?.moment.name ?? '');
  const [contentBucket, setContentBucket] = useState('Brand');
  const [subBucket, setSubBucket] = useState('');
  const [campaign, setCampaign] = useState('');
  const [tags, setTags] = useState<string[]>(entry?.moment.tags ?? []);
  const [tagInput, setTagInput] = useState('');
  const [caption, setCaption] = useState(`Discover ${entry?.moment.name ?? 'our latest moment'}! ✨ #${entry?.moment.category ?? 'Marketing'}`);
  const [hashtags, setHashtags] = useState<string[]>(entry?.moment.tags.map(t => `#${t}`) ?? ['#Trending']);
  const [hashtagInput, setHashtagInput] = useState('');
  const [syncAll, setSyncAll] = useState(true);
  const [previewTab, setPreviewTab] = useState<'post' | 'feed'>('post');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const activePlatform = activePlatforms[0] ?? 'Instagram';
  const charLimit = PLATFORM_CHAR_LIMITS[activePlatform] ?? 2200;

  const saveDraft = trpc.post.saveDraft.useMutation({
    onSuccess: () => { toast('Draft saved!'); onClose(); },
    onError: e => toast(e.message, 'error'),
  });

  function handleSave(_status: 'draft' | 'approval') {
    if (activePlatforms.length === 0) { toast('Select at least one platform', 'error'); return; }
    saveDraft.mutate({
      calendarEntryId: entry?.id,
      momentId: entry?.momentId,
      platforms: activePlatforms,
      title, contentBucket, subBucket, campaign, tags,
      mediaTab, mediaInputTab, mediaUrl: uploadedMedia ?? mediaUrl,
      caption, hashtags, syncToAllPlatforms: syncAll,
      expectedLikes: entry?.benchmarks.length
        ? Math.round(entry.benchmarks.reduce((s, b) => s + b.likes, 0) / entry.benchmarks.length)
        : undefined,
      expectedComments: entry?.benchmarks.length
        ? Math.round(entry.benchmarks.reduce((s, b) => s + b.comments, 0) / entry.benchmarks.length)
        : undefined,
      expectedShares: entry?.benchmarks.length
        ? Math.round(entry.benchmarks.reduce((s, b) => s + b.shares, 0) / entry.benchmarks.length)
        : undefined,
    });
  }

  function handleFileChange(file: File) {
    const url = URL.createObjectURL(file);
    setUploadedMedia(url);
  }

  function togglePlatform(p: PostPlatform) {
    setActivePlatforms(prev =>
      prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p],
    );
  }

  if (!entry) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-6xl mx-auto my-4 bg-[var(--card)] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--card-border)]">
          <div>
            <h2 className="text-base font-bold text-[var(--foreground)]">Create New Post</h2>
            <p className="text-xs text-[var(--muted)] mt-0.5">Social Media › Posts › Create</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => handleSave('draft')} loading={saveDraft.isPending}>
              <Save className="w-3.5 h-3.5" /> Save Draft
            </Button>
            <Button variant="secondary" size="sm" onClick={() => handleSave('approval')}>
              Send for Approval
            </Button>
            <Button size="sm" onClick={() => handleSave('draft')}>
              <Globe className="w-3.5 h-3.5" /> Publish Post
            </Button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--card-border)] ml-2">
              <X className="w-4 h-4 text-[var(--muted)]" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left: Form */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {/* Platform Selector */}
            <div className="bg-[var(--background)] border border-[var(--card-border)] rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-[var(--foreground)]">Select Platforms</p>
                <p className="text-xs text-[var(--muted)]">Post will be published to {activePlatforms.join(', ') || 'no platform'}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {(Object.entries(PLATFORM_ICONS) as [PostPlatform, typeof PLATFORM_ICONS[PostPlatform]][]).map(([platform, meta]) => {
                  const active = activePlatforms.includes(platform);
                  return (
                    <button
                      key={platform}
                      onClick={() => togglePlatform(platform)}
                      className={cn(
                        'flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium border transition-all',
                        active ? `${meta.bg} ${meta.color}` : 'border-[var(--card-border)] text-[var(--muted)] hover:border-[var(--accent)]',
                      )}
                    >
                      <span className="text-sm leading-none">{meta.emoji}</span>
                      {platform}
                      <div className={cn(
                        'w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all',
                        active ? 'border-[var(--accent)] bg-[var(--accent)]' : 'border-gray-300',
                      )}>
                        {active && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Post Content */}
            <div className="bg-[var(--background)] border border-[var(--card-border)] rounded-2xl p-4 space-y-3">
              <p className="text-xs font-semibold text-[var(--foreground)]">Post Content</p>
              <div>
                <label className="text-xs text-[var(--muted)]">Post Title *</label>
                <input value={title} onChange={e => setTitle(e.target.value)}
                  placeholder="e.g., Summer Campaign Launch"
                  className="w-full mt-1 border border-[var(--card-border)] rounded-xl px-3 py-2 text-sm bg-[var(--card)] text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-[var(--muted)]">Content Bucket</label>
                  <select value={contentBucket} onChange={e => setContentBucket(e.target.value)}
                    className="w-full mt-1 border border-[var(--card-border)] rounded-xl px-3 py-2 text-sm bg-[var(--card)] text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40">
                    {CONTENT_BUCKETS.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-[var(--muted)]">Sub-Bucket</label>
                  <input value={subBucket} onChange={e => setSubBucket(e.target.value)}
                    placeholder="Select sub-bucket"
                    className="w-full mt-1 border border-[var(--card-border)] rounded-xl px-3 py-2 text-sm bg-[var(--card)] text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40" />
                </div>
                <div>
                  <label className="text-xs text-[var(--muted)]">Campaign</label>
                  <input value={campaign} onChange={e => setCampaign(e.target.value)}
                    placeholder="Select campaign"
                    className="w-full mt-1 border border-[var(--card-border)] rounded-xl px-3 py-2 text-sm bg-[var(--card)] text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40" />
                </div>
              </div>
              <div>
                <label className="text-xs text-[var(--muted)]">Tags</label>
                <div className="mt-1 flex flex-wrap gap-1.5 p-2 border border-[var(--card-border)] rounded-xl bg-[var(--card)] min-h-[36px]">
                  {tags.map(t => (
                    <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 bg-[var(--accent-light)] text-[var(--accent)] rounded-full text-xs">
                      {t} <button onClick={() => setTags(prev => prev.filter(x => x !== t))} className="hover:opacity-60"><X className="w-2.5 h-2.5" /></button>
                    </span>
                  ))}
                  <input
                    value={tagInput}
                    onChange={e => setTagInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && tagInput.trim()) { setTags(p => [...p, tagInput.trim()]); setTagInput(''); e.preventDefault(); } }}
                    placeholder="Add tag..."
                    className="flex-1 min-w-[80px] outline-none text-xs bg-transparent text-[var(--foreground)]"
                  />
                </div>
              </div>
            </div>

            {/* Media Upload */}
            <div className="bg-[var(--background)] border border-[var(--card-border)] rounded-2xl p-4 space-y-3">
              <p className="text-xs font-semibold text-[var(--foreground)]">Media Upload</p>
              <div className="flex gap-1 border-b border-[var(--card-border)] pb-2">
                {MEDIA_TABS.map(tab => (
                  <button key={tab.id} onClick={() => setMediaTab(tab.id)}
                    className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                      mediaTab === tab.id ? 'bg-[var(--card)] shadow-sm text-[var(--foreground)]' : 'text-[var(--muted)] hover:text-[var(--foreground)]')}>
                    <tab.icon className="w-3.5 h-3.5" />{tab.label}
                  </button>
                ))}
              </div>
              <div className="flex gap-1">
                {(['Enter URL', 'Upload Creative', 'Generate with AI'] as const).map(t => (
                  <button key={t} onClick={() => setMediaInputTab(t)}
                    className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                      mediaInputTab === t ? 'bg-[var(--accent)] text-white' : 'text-[var(--muted)] hover:text-[var(--foreground)]')}>
                    {t}
                  </button>
                ))}
              </div>
              {mediaInputTab === 'Enter URL' && (
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--muted)]" />
                    <input value={mediaUrl} onChange={e => setMediaUrl(e.target.value)}
                      placeholder="Paste media URL..."
                      className="w-full pl-8 border border-[var(--card-border)] rounded-xl px-3 py-2 text-sm bg-[var(--card)] text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40" />
                  </div>
                </div>
              )}
              {mediaInputTab === 'Upload Creative' && (
                <div
                  onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={e => { e.preventDefault(); setIsDragging(false); const file = e.dataTransfer.files[0]; if (file) handleFileChange(file); }}
                  className={cn(
                    'border-2 border-dashed rounded-xl p-6 text-center transition-colors cursor-pointer',
                    isDragging ? 'border-[var(--accent)] bg-[var(--accent-light)]' : 'border-[var(--card-border)] hover:border-[var(--accent)]',
                  )}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploadedMedia ? (
                    <div className="space-y-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={uploadedMedia} alt="Uploaded media" className="max-h-32 mx-auto rounded-lg object-cover" />
                      <Button variant="ghost" size="sm" onClick={e => { e.stopPropagation(); setUploadedMedia(null); }}>Remove</Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Upload className="w-8 h-8 text-[var(--muted)] mx-auto" />
                      <p className="text-xs text-[var(--muted)]">Drop files here or click to upload</p>
                    </div>
                  )}
                  <input ref={fileInputRef} type="file" accept="image/*,video/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFileChange(f); }} />
                </div>
              )}
              {mediaInputTab === 'Generate with AI' && (
                <div className="border-2 border-dashed border-[var(--card-border)] rounded-xl p-6 text-center">
                  <Sparkles className="w-8 h-8 text-[var(--accent)] mx-auto mb-2" />
                  <p className="text-xs text-[var(--muted)]">AI image generation coming soon</p>
                </div>
              )}
            </div>

            {/* Caption & Hashtags */}
            <div className="bg-[var(--background)] border border-[var(--card-border)] rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Hash className="w-4 h-4 text-[var(--accent)]" />
                  <p className="text-xs font-semibold text-[var(--foreground)]">Caption & Hashtags</p>
                  {activePlatforms[0] && (
                    <span className="text-xs bg-[var(--accent-light)] text-[var(--accent)] px-2 py-0.5 rounded-full">{activePlatforms[0]}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--muted)]">Sync to all</span>
                  <button onClick={() => setSyncAll(s => !s)}
                    className={cn('w-8 h-4 rounded-full transition-colors relative', syncAll ? 'bg-[var(--accent)]' : 'bg-gray-300')}>
                    <div className={cn('absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all', syncAll ? 'left-4' : 'left-0.5')} />
                  </button>
                </div>
              </div>
              <div className="relative">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-[var(--muted)]">Caption</label>
                  <button className="text-xs text-[var(--accent)] flex items-center gap-1 hover:underline">
                    <Sparkles className="w-3 h-3" /> AI Generate
                  </button>
                </div>
                <textarea
                  value={caption}
                  onChange={e => setCaption(e.target.value)}
                  rows={4}
                  maxLength={charLimit}
                  className="w-full border border-[var(--card-border)] rounded-xl px-3 py-2 text-sm bg-[var(--card)] text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40 resize-none"
                />
                <p className="text-xs text-[var(--muted)] mt-1">{caption.length} / {charLimit.toLocaleString()} characters</p>
              </div>
              <div>
                <label className="text-xs text-[var(--muted)]">Hashtags</label>
                <div className="mt-1 flex flex-wrap gap-1.5 p-2 border border-[var(--card-border)] rounded-xl bg-[var(--card)] min-h-[36px]">
                  {hashtags.map(h => (
                    <span key={h} className="inline-flex items-center gap-1 px-2 py-0.5 bg-[var(--accent-light)] text-[var(--accent)] rounded-full text-xs">
                      {h} <button onClick={() => setHashtags(p => p.filter(x => x !== h))}><X className="w-2.5 h-2.5" /></button>
                    </span>
                  ))}
                  <input
                    value={hashtagInput}
                    onChange={e => setHashtagInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && hashtagInput.trim()) {
                        const tag = hashtagInput.trim().startsWith('#') ? hashtagInput.trim() : `#${hashtagInput.trim()}`;
                        setHashtags(p => [...p, tag]); setHashtagInput(''); e.preventDefault();
                      }
                    }}
                    placeholder="#hashtag"
                    className="flex-1 min-w-[80px] outline-none text-xs bg-transparent text-[var(--foreground)]"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Right: Preview */}
          <div className="w-72 flex-shrink-0 border-l border-[var(--card-border)] bg-[var(--background)] overflow-y-auto">
            <div className="p-4 space-y-4">
              {/* Live Preview */}
              <div className="bg-[var(--card)] border border-[var(--card-border)] rounded-xl overflow-hidden">
                <div className="p-3 border-b border-[var(--card-border)]">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <div className="w-5 h-5 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                        <Globe className="w-3 h-3 text-white" />
                      </div>
                      <span className="text-xs font-semibold text-[var(--foreground)]">Live Preview</span>
                    </div>
                    {activePlatforms[0] && (
                      <span className="text-xs text-[var(--muted)]">{activePlatforms[0]}</span>
                    )}
                  </div>
                  <div className="flex gap-1">
                    {(['post', 'feed'] as const).map(t => (
                      <button key={t} onClick={() => setPreviewTab(t)}
                        className={cn('flex-1 py-1 text-xs rounded-lg font-medium transition-colors',
                          previewTab === t ? 'bg-[var(--accent)] text-white' : 'text-[var(--muted)] hover:bg-[var(--card-border)]')}>
                        {t === 'post' ? '📄 Post Preview' : '📋 Feed Preview'}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Mock post preview */}
                <div className="p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500" />
                    <div>
                      <p className="text-xs font-semibold text-[var(--foreground)]">your_brand</p>
                      <p className="text-[10px] text-[var(--muted)]">Sponsored</p>
                    </div>
                  </div>
                  <div className="aspect-square bg-[var(--card-border)] rounded-lg overflow-hidden">
                    {(uploadedMedia || mediaUrl || entry.moment.imageUrl) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={uploadedMedia || mediaUrl || entry.moment.imageUrl}
                        alt="Preview"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <ImageIcon className="w-8 h-8 text-[var(--muted)]" />
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-[var(--foreground)] line-clamp-2">
                    <span className="font-semibold">your_brand</span> {caption}
                  </p>
                  <p className="text-xs text-[var(--accent)] line-clamp-1">{hashtags.join(' ')}</p>
                  <p className="text-[10px] text-[var(--muted)] text-center border-t border-[var(--card-border)] pt-2">
                    Live preview • Updates as you type
                  </p>
                </div>
              </div>

              {/* Expected Engagement */}
              {entry.benchmarks.length > 0 && (
                <div className="bg-[var(--card)] border border-[var(--card-border)] rounded-xl p-3">
                  <div className="flex items-center gap-1.5 mb-3">
                    <RefreshCw className="w-3.5 h-3.5 text-[var(--accent)]" />
                    <span className="text-xs font-semibold text-[var(--foreground)]">Expected Engagement</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: 'Likes', value: Math.round(entry.benchmarks.reduce((s, b) => s + b.likes, 0) / entry.benchmarks.length), color: 'text-blue-600' },
                      { label: 'Comments', value: Math.round(entry.benchmarks.reduce((s, b) => s + b.comments, 0) / entry.benchmarks.length), color: 'text-emerald-600' },
                      { label: 'Shares', value: Math.round(entry.benchmarks.reduce((s, b) => s + b.shares, 0) / entry.benchmarks.length), color: 'text-purple-600' },
                    ].map(m => (
                      <div key={m.label} className="text-center">
                        <p className={cn('text-sm font-bold', m.color)}>
                          {m.value >= 1000 ? `${(m.value / 1000).toFixed(1)}K` : m.value}
                        </p>
                        <p className="text-[10px] text-[var(--muted)]">Expected {m.label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
