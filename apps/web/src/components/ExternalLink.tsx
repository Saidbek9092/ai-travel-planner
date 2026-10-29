import { ExternalLinkIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Secondary "View on …" link: new tab, external-link icon, optional source label. */
export function ExternalLink({ href, children, source, className }: { href: string; children: ReactNode; source?: string | null; className?: string }) {
  return (
    <span className={cn('inline-flex flex-wrap items-baseline gap-x-1.5 text-sm', className)}>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        // On touch screens the `after:` box makes the tap area 44 px tall without changing the line height of the text.
        className="relative inline-flex items-center gap-1 text-ink-2 underline-offset-4 hover:text-primary hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none pointer-coarse:after:absolute pointer-coarse:after:-inset-x-1 pointer-coarse:after:-inset-y-3 pointer-coarse:after:content-['']"
      >
        {children}
        <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
        <span className="sr-only">(opens in a new tab)</span>
      </a>
      {source && <span className="text-[13px] text-muted-foreground">{source}</span>}
    </span>
  );
}
