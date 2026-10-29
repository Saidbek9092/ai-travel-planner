'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NEW_TRIP_EVENT } from '@/lib/dom';
import { cn } from '@/lib/utils';

const LINKS = [
  { href: '/', label: 'Plan a trip' },
  { href: '/trips', label: 'My trips' },
] as const;

export function SiteNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex items-center gap-1">
      {LINKS.map(({ href, label }) => {
        const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            onClick={() => href === '/' && window.dispatchEvent(new Event(NEW_TRIP_EVENT))}
            className={cn(
              'inline-flex h-10 items-center rounded-lg px-3 text-[15px] whitespace-nowrap text-ink-2 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 max-sm:px-2 max-sm:text-sm pointer-coarse:h-11',
              active && 'bg-muted font-medium text-foreground',
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
