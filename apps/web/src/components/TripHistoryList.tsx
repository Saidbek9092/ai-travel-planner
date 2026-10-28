'use client';

import Link from 'next/link';
import { ChevronRightIcon, PlaneIcon, Trash2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useTripHistory } from '@/hooks/useTripHistory';
import { env } from '@/lib/env';
import { cn } from '@/lib/utils';

type Availability = 'checking' | 'available' | 'gone';

const created = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** Checks once per trip whether the agent still knows it (`404` → "No longer available"). */
function useAvailability(threadIds: string[]) {
  const [known, setKnown] = useState<Record<string, Availability>>({});
  const key = threadIds.join(',');
  useEffect(() => {
    if (env.agentUrl === null || key === '') return;
    const controller = new AbortController();
    for (const id of key.split(',')) {
      fetch(`${env.agentUrl}/api/trips/${encodeURIComponent(id)}`, { signal: controller.signal })
        .then((response) => {
          if (response.status === 404) setKnown((k) => ({ ...k, [id]: 'gone' }));
          else if (response.ok) setKnown((k) => ({ ...k, [id]: 'available' }));
        })
        .catch(() => undefined);
    }
    return () => controller.abort();
  }, [key]);
  return (id: string): Availability => known[id] ?? 'checking';
}

export function TripHistoryList() {
  const { trips, remove } = useTripHistory();
  const availability = useAvailability(trips.map((t) => t.threadId));

  if (trips.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card/60 p-10 text-center text-ink-2">
        <PlaneIcon className="size-7" aria-hidden="true" />
        <p>No trips yet. Finished trips show up here.</p>
        <Link href="/" className="text-primary underline-offset-4 hover:underline">
          Plan a trip
        </Link>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {trips.map((trip) => {
        const state = availability(trip.threadId);
        const gone = state === 'gone';
        return (
          <li key={trip.threadId} className={cn('flex items-center gap-3 rounded-xl border bg-card px-4 py-3', gone && 'bg-muted')}>
            <div className="min-w-0 flex-1">
              {gone ? (
                <p className="truncate font-semibold text-ink-2">{trip.title}</p>
              ) : (
                <Link
                  href={`/?trip=${encodeURIComponent(trip.threadId)}`}
                  className="flex items-center gap-1 truncate font-semibold outline-none hover:text-primary focus-visible:underline"
                >
                  {trip.title} <ChevronRightIcon className="size-4 shrink-0" aria-hidden="true" />
                </Link>
              )}
              <p className="text-[13px] text-muted-foreground">
                {created.format(trip.createdAt)}
                {gone && ' · No longer available'}
              </p>
            </div>
            {gone && (
              <Button variant="ghost" className="h-11" onClick={() => remove(trip.threadId)} aria-label={`Remove ${trip.title}`}>
                <Trash2Icon aria-hidden="true" /> Remove
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
