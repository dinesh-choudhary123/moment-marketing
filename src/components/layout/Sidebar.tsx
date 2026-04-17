'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Sparkles,
  Calendar,
  Settings,
  Menu,
  X,
  Sun,
  Moon,
  Monitor,
  ChevronDown,
  ChevronRight,
  Users,
  Building2,
  Package,
  UserCircle,
  Megaphone,
  List,
  DollarSign,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState, useEffect } from 'react';

type Theme = 'light' | 'dark' | 'system';

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => {
    try {
      const saved = (localStorage.getItem('mm-theme') as Theme) || 'system';
      setTheme(saved);
    } catch {}
  }, []);

  function applyTheme(t: Theme) {
    setTheme(t);
    try { localStorage.setItem('mm-theme', t); } catch {}
    if (t === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else if (t === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }

  return (
    <div className="px-3 pb-2">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)] px-1 mb-1.5">Theme</p>
      <div className="flex gap-1 bg-[var(--card-border)] rounded-xl p-1">
        {([
          { value: 'light' as Theme, icon: Sun, label: 'Light' },
          { value: 'system' as Theme, icon: Monitor, label: 'Auto' },
          { value: 'dark' as Theme, icon: Moon, label: 'Dark' },
        ]).map(({ value, icon: Icon, label }) => (
          <button
            key={value}
            onClick={() => applyTheme(value)}
            title={label}
            className={cn(
              'flex-1 flex flex-col items-center gap-0.5 py-1.5 rounded-lg text-[10px] font-medium transition-all',
              theme === value
                ? 'bg-[var(--card)] text-[var(--accent)] shadow-sm'
                : 'text-[var(--muted)] hover:text-[var(--foreground)]',
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

const COCTM_ITEMS = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/company', label: 'Company', icon: Building2 },
  { href: '/offerings', label: 'Offerings', icon: Package },
  { href: '/consumer', label: 'Consumer', icon: UserCircle },
  { href: '/topical', label: 'Topical Marketing', icon: Megaphone },
  { href: '/moments', label: 'Moment Marketing', icon: Sparkles, badge: 'Live' },
];

const CALENDAR_ITEMS = [
  { href: '/calendar', label: 'Calendar View', icon: Calendar },
  { href: '/calendar?view=list', label: 'List View', icon: List },
  { href: '/calendar?view=budget', label: 'Budgeting', icon: DollarSign },
];

export function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [coctmOpen, setCoctmOpen] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  // On mount: read localStorage and apply sidebar width CSS var
  useEffect(() => {
    try {
      const saved = localStorage.getItem('mm-sidebar-collapsed');
      const isCollapsed = saved === 'true';
      setCollapsed(isCollapsed);
      document.documentElement.style.setProperty(
        '--sidebar-width',
        isCollapsed ? '4rem' : '16rem',
      );
    } catch {}
  }, []);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem('mm-sidebar-collapsed', String(next)); } catch {}
    document.documentElement.style.setProperty(
      '--sidebar-width',
      next ? '4rem' : '16rem',
    );
  }

  const isActive = (href: string) => {
    if (href.includes('?')) {
      return pathname + (typeof window !== 'undefined' ? window.location.search : '') === href;
    }
    return pathname === href;
  };

  const NavLink = ({
    href,
    label,
    icon: Icon,
    badge,
  }: {
    href: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: string;
  }) => {
    const active = isActive(href);
    return (
      <Link
        href={href}
        onClick={() => setMobileOpen(false)}
        title={collapsed ? label : undefined}
        className={cn(
          'flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all',
          collapsed ? 'justify-center px-0' : '',
          active
            ? 'bg-[var(--accent-light)] text-[var(--accent)]'
            : 'text-[var(--muted)] hover:bg-[var(--card-border)] hover:text-[var(--foreground)]',
        )}
      >
        <Icon className={cn('w-4 h-4 shrink-0', active ? 'text-[var(--accent)]' : '')} />
        {!collapsed && (
          <>
            <span className="flex-1">{label}</span>
            {badge && (
              <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded-md bg-emerald-500/15 text-emerald-600">
                {badge}
              </span>
            )}
          </>
        )}
      </Link>
    );
  };

  const NavContent = ({ isMobile = false }: { isMobile?: boolean }) => (
    <div className="flex flex-col h-full">
      {/* Logo / Header */}
      <div
        className={cn(
          'py-5 border-b border-[var(--sidebar-border)] flex items-center',
          collapsed && !isMobile ? 'px-0 justify-center' : 'px-6',
        )}
      >
        {/* Logo mark + wordmark */}
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <div className="w-8 h-8 shrink-0 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-md">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          {(!collapsed || isMobile) && (
            <div className="min-w-0">
              <p className="font-bold text-sm text-[var(--foreground)] leading-tight">Moment</p>
              <p className="text-xs text-[var(--muted)] leading-tight">Marketing</p>
            </div>
          )}
        </div>

        {/* Collapse toggle — desktop only */}
        {!isMobile && (
          <button
            onClick={toggleCollapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cn(
              'shrink-0 p-1 rounded-lg text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--card-border)] transition-all',
              collapsed ? 'mt-0' : '',
            )}
          >
            {collapsed
              ? <PanelLeftOpen className="w-4 h-4" />
              : <PanelLeftClose className="w-4 h-4" />
            }
          </button>
        )}
      </div>

      <div
        className={cn(
          'flex-1 overflow-y-auto py-4 space-y-5',
          collapsed && !isMobile ? 'px-1' : 'px-3',
        )}
      >
        {/* Social Accounts */}
        <div>
          {(!collapsed || isMobile) && (
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)] px-3 mb-2 flex items-center gap-2">
              <Users className="w-3.5 h-3.5" />
              Social Accounts
            </p>
          )}
          {collapsed && !isMobile ? (
            <div className="flex justify-center py-1">
              <span title="Social Accounts"><Users className="w-4 h-4 text-[var(--muted)]" /></span>
            </div>
          ) : (
            <p className="px-3 text-xs text-[var(--muted)]">Connect accounts</p>
          )}
        </div>

        {/* CO:CTM Collapsible */}
        <div>
          {(!collapsed || isMobile) && (
            <button
              onClick={() => setCoctmOpen(!coctmOpen)}
              className="w-full flex items-center gap-2 px-3 mb-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
            >
              {coctmOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              CO:CTM
            </button>
          )}
          {(coctmOpen || (collapsed && !isMobile)) && (
            <div className="space-y-0.5">
              {COCTM_ITEMS.map((item) => (
                <NavLink key={item.href} {...item} />
              ))}
            </div>
          )}
        </div>

        {/* Social Calendar */}
        <div>
          {(!collapsed || isMobile) && (
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)] px-3 mb-2">
              Social Calendar
            </p>
          )}
          <div className="space-y-0.5">
            {CALENDAR_ITEMS.map((item) => (
              <NavLink key={item.href} {...item} />
            ))}
          </div>
        </div>
      </div>

      {/* Theme Toggle — hidden when collapsed on desktop */}
      {(!collapsed || isMobile) && <ThemeToggle />}

      {/* Settings */}
      <div
        className={cn(
          'pb-4 border-t border-[var(--sidebar-border)] pt-3',
          collapsed && !isMobile ? 'px-1' : 'px-3',
        )}
      >
        <Link
          href="/settings"
          onClick={() => setMobileOpen(false)}
          title={collapsed && !isMobile ? 'Settings' : undefined}
          className={cn(
            'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all',
            collapsed && !isMobile ? 'justify-center px-0' : '',
            pathname === '/settings'
              ? 'bg-[var(--accent-light)] text-[var(--accent)]'
              : 'text-[var(--muted)] hover:bg-[var(--card-border)] hover:text-[var(--foreground)]',
          )}
        >
          <Settings className="w-4 h-4 shrink-0" />
          {(!collapsed || isMobile) && 'Settings'}
        </Link>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside
        className={cn(
          'hidden md:flex flex-col fixed inset-y-0 left-0 z-30 bg-[var(--sidebar)] border-r border-[var(--sidebar-border)] transition-all duration-300 overflow-hidden',
          collapsed ? 'w-16' : 'w-64',
        )}
      >
        <NavContent />
      </aside>

      {/* Mobile Toggle */}
      <button
        className="md:hidden fixed top-4 left-4 z-50 p-2 rounded-xl bg-[var(--card)] border border-[var(--card-border)] shadow-sm"
        onClick={() => setMobileOpen(!mobileOpen)}
      >
        {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      {/* Mobile Sidebar — always full width, no collapse */}
      {mobileOpen && (
        <>
          <div className="md:hidden fixed inset-0 bg-black/40 z-40" onClick={() => setMobileOpen(false)} />
          <aside className="md:hidden fixed inset-y-0 left-0 w-64 z-50 bg-[var(--sidebar)] border-r border-[var(--sidebar-border)]">
            <NavContent isMobile />
          </aside>
        </>
      )}
    </>
  );
}
