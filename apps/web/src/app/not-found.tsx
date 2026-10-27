import Link from 'next/link';
import { PlaneIcon } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <PlaneIcon className="size-8 text-muted-foreground" aria-hidden="true" />
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="text-muted-foreground">That page doesn&apos;t exist. Plan a new trip instead.</p>
      <Link href="/" className={cn(buttonVariants())}>
        Plan a trip
      </Link>
    </main>
  );
}
