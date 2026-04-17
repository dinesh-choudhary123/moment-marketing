import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { TRPCProvider } from '@/lib/trpc-provider';
import { Sidebar } from '@/components/layout/Sidebar';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Moment Marketing',
  description: 'Discover trends, plan campaigns, and create moments that matter.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        {/* Apply saved theme before first paint — prevents white flash */}
        <script dangerouslySetInnerHTML={{ __html: `
          try {
            var t = localStorage.getItem('mm-theme') || 'system';
            if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
            else if (t === 'light') document.documentElement.setAttribute('data-theme', 'light');
          } catch(e) {}
        `}} />
        {/* Apply saved sidebar width before first paint — prevents layout shift */}
        <script dangerouslySetInnerHTML={{ __html: `
          try {
            var sc = localStorage.getItem('mm-sidebar-collapsed');
            document.documentElement.style.setProperty(
              '--sidebar-width',
              sc === 'true' ? '4rem' : '16rem'
            );
          } catch(e) {
            document.documentElement.style.setProperty('--sidebar-width', '16rem');
          }
        `}} />
      </head>
      <body className="min-h-full bg-[var(--background)] text-[var(--foreground)]">
        <TRPCProvider>
          <div className="flex h-screen overflow-hidden">
            <Sidebar />
            <main className="flex-1 overflow-y-auto md:pl-[var(--sidebar-width,16rem)] transition-all duration-300">
              {children}
            </main>
          </div>
        </TRPCProvider>
      </body>
    </html>
  );
}
