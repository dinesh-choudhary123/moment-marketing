import { Building2 } from 'lucide-react';

export default function CompanyPage() {
  return (
    <div className="min-h-screen bg-[var(--background)] flex items-center justify-center">
      <div className="text-center">
        <div className="w-16 h-16 rounded-2xl bg-[var(--accent-light)] flex items-center justify-center mx-auto mb-4">
          <Building2 className="w-8 h-8 text-[var(--accent)]" />
        </div>
        <h1 className="text-2xl font-bold text-[var(--foreground)]">Company</h1>
        <p className="text-sm text-[var(--muted)] mt-2">Manage your brand identity, team, and company settings.</p>
        <span className="inline-block mt-4 px-4 py-1.5 bg-amber-100 text-amber-700 text-xs font-semibold rounded-full">Coming Soon</span>
      </div>
    </div>
  );
}
