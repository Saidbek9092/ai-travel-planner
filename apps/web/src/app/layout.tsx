import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import Link from 'next/link';
import { RouteIcon } from 'lucide-react';
import { SiteNav } from '@/components/SiteNav';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { HEADER_ACTIONS_ID } from '@/lib/dom';
import './globals.css';

// shadcn's theme reads --font-sans; the terminal uses --font-geist-mono.
const geistSans = Geist({ variable: '--font-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'AI Travel Planner',
  description:
    'Plan a trip in one sentence: flights, hotels and a day-by-day itinerary within your budget.',
  openGraph: {
    title: 'AI Travel Planner',
    description: 'Flights, hotels and a day-by-day itinerary within your budget, planned by AI agents.',
    type: 'website',
  },
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-background text-[15px] leading-[22px] text-foreground">
        <TooltipProvider>
          <header className="border-b bg-card">
            <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center gap-3 px-4 sm:gap-6 sm:px-6 lg:px-[72px]">
              <Link href="/" className="flex shrink-0 items-center gap-2.5 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                <span className="flex size-8 items-center justify-center rounded-lg bg-foreground text-white">
                  <RouteIcon className="size-4" aria-hidden="true" />
                </span>
                <span className="text-[17px] font-semibold tracking-tight max-sm:sr-only">AI Travel Planner</span>
              </Link>
              <SiteNav />
              <div id={HEADER_ACTIONS_ID} className="ml-auto flex items-center gap-2" />
            </div>
          </header>
          {children}
        </TooltipProvider>
        {/* Light theme only (no ThemeProvider), so pin sonner instead of following the OS. */}
        <Toaster theme="light" />
      </body>
    </html>
  );
}
