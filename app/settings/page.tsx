'use client';

import { Settings, Key, RefreshCw, Database } from 'lucide-react';

const API_KEYS = [
  { label: 'Twitter Bearer Token', env: 'TWITTER_BEARER_TOKEN', placeholder: 'Bearer xxx...', live: true },
  { label: 'YouTube API Key', env: 'YOUTUBE_API_KEY', placeholder: 'AIza...', live: true },
  { label: 'Reddit Client ID', env: 'REDDIT_CLIENT_ID', placeholder: 'xxx...', live: true },
  { label: 'Reddit Client Secret', env: 'REDDIT_CLIENT_SECRET', placeholder: 'xxx...', live: true },
  { label: 'Instagram Access Token', env: 'INSTAGRAM_ACCESS_TOKEN', placeholder: 'EAAx...', live: false },
  { label: 'Facebook Access Token', env: 'FACEBOOK_ACCESS_TOKEN', placeholder: 'EAAx...', live: false },
];

export default function SettingsPage() {
  return (
    <div className="min-h-screen bg-[var(--background)] p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-bold text-[var(--foreground)] flex items-center gap-2">
            <Settings className="w-5 h-5 text-[var(--accent)]" />
            Settings
          </h1>
          <p className="text-sm text-[var(--muted)] mt-1">Configure API keys and workspace preferences.</p>
        </div>

        {/* API Keys */}
        <div className="bg-[var(--card)] border border-[var(--card-border)] rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-[var(--accent)]" />
            <h2 className="text-sm font-semibold text-[var(--foreground)]">API Keys</h2>
          </div>
          <p className="text-xs text-[var(--muted)]">
            Add your API keys to <code className="bg-[var(--background)] px-1 py-0.5 rounded text-xs font-mono">.env.local</code> in the project root.
          </p>
          <div className="space-y-3">
            {API_KEYS.map(key => (
              <div key={key.env} className="flex items-center gap-3 p-3 bg-[var(--background)] rounded-xl">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold text-[var(--foreground)]">{key.label}</p>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${key.live ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-orange-700'}`}>
                      {key.live ? 'Live API' : 'Mock data'}
                    </span>
                  </div>
                  <code className="text-[10px] text-[var(--muted)] font-mono">{key.env}={key.placeholder}</code>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Scraper Info */}
        <div className="bg-[var(--card)] border border-[var(--card-border)] rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-[var(--accent)]" />
            <h2 className="text-sm font-semibold text-[var(--foreground)]">Scraper Settings</h2>
          </div>
          <div className="space-y-2 text-xs text-[var(--muted)]">
            <p>• Scraper runs with a <strong className="text-[var(--foreground)]">1-hour cooldown</strong> between refreshes.</p>
            <p>• Without API keys, the app uses <strong className="text-[var(--foreground)]">realistic mock data</strong> so the UI is always populated.</p>
            <p>• <strong className="text-[var(--foreground)]">Instagram & Facebook</strong> require an approved Meta app — mock data is used until configured.</p>
          </div>
        </div>

        {/* Data Storage */}
        <div className="bg-[var(--card)] border border-[var(--card-border)] rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-[var(--accent)]" />
            <h2 className="text-sm font-semibold text-[var(--foreground)]">Data Storage</h2>
          </div>
          <p className="text-xs text-[var(--muted)]">
            Currently using <strong className="text-[var(--foreground)]">in-memory storage</strong>. Data persists per server process and resets on restart.
            Future: swap to <strong className="text-[var(--foreground)]">Cloudflare D1</strong> for persistent storage.
          </p>
        </div>
      </div>
    </div>
  );
}
