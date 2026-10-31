import type { CSSProperties } from 'react';
import { Skeleton } from '@/components/ui/skeleton';

/** A grey bar inside a card: `bg-border` stays visible on the white card, where the default `bg-muted` would not. */
const Bar = ({ className, style }: { className: string; style?: CSSProperties }) => <Skeleton className={`bg-border/70 ${className}`} style={style} />;

/**
 * What the page shows while it loads or refreshes. It uses the same width, padding and two-column grid as the real
 * start page, so nothing jumps when the content arrives; the header above it is already the real one.
 */
export function PageSkeleton() {
  return (
    <div role="status" aria-busy="true" className="mx-auto flex w-full max-w-[1360px] flex-1 flex-col gap-6 px-4 pt-8 pb-12 sm:px-8">
      <span className="sr-only">Loading the planner…</span>
      <div aria-hidden="true" className="flex flex-col gap-3">
        <Bar className="h-3 w-24" />
        <Bar className="h-9 w-72 max-w-full" />
        <Bar className="h-4 w-96 max-w-full" />
      </div>
      <div aria-hidden="true" className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
        <div className="flex flex-col gap-6 rounded-2xl border bg-card p-6 shadow-sm">
          <Bar className="h-6 w-40" />
          <Bar className="h-28 w-full rounded-xl" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <Bar key={index} className="h-16 rounded-xl" />
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {[88, 64, 80, 96, 84, 68].map((width) => (
              <Bar key={width} className="h-10 rounded-full" style={{ width }} />
            ))}
          </div>
          <div className="flex items-center justify-between gap-4 border-t pt-5">
            <Bar className="h-4 w-56 max-w-[50%]" />
            <Bar className="h-12 w-36 rounded-lg" />
          </div>
        </div>
        <div className="hidden flex-col gap-4 rounded-2xl border bg-card p-6 shadow-sm lg:flex">
          <Bar className="h-6 w-56" />
          <Bar className="h-4 w-72 max-w-full" />
          <Bar className="h-44 w-full rounded-xl" />
          <Bar className="h-5 w-40" />
          <Bar className="h-4 w-64 max-w-full" />
        </div>
      </div>
    </div>
  );
}
