import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { PlaneIcon } from 'lucide-react';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import './globals.css';

// shadcn's theme reads --font-sans; the terminal uses --font-geist-mono.
const geistSans = Geist({ variable: '--font-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'AI Travel Planner',
  description:
    'Plan a trip in one sentence: flights, hotels and a day-by-day itinerary within your budget.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <TooltipProvider>
          <header className="border-b">
            <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-2 px-4 sm:px-6">
              <PlaneIcon className="size-5" aria-hidden="true" />
              <span className="font-semibold tracking-tight">AI Travel Planner</span>
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
