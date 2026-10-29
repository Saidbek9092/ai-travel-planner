import type { Metadata } from 'next';
import Link from 'next/link';
import { PlaneIcon } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { MAIN_ID } from '@/lib/dom';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Page not found · AI Travel Planner' };

export default function NotFound() {
  return (
    <main id={MAIN_ID} tabIndex={-1} className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-3 p-6 text-center outline-none">
      <PlaneIcon className="size-8 text-muted-foreground" aria-hidden="true" />
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="text-muted-foreground">That page doesn&apos;t exist. Plan a new trip instead.</p>
      <Link href="/" className={cn(buttonVariants())}>
        Plan a trip
      </Link>
    </main>
  );
}
