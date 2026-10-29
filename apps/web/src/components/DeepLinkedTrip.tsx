'use client';

import { useEffect, useState, type ComponentProps } from 'react';
import { TripDashboard } from '@/components/TripDashboard';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchStoredTrip, type StoredTrip } from '@/lib/api';
import { readSession } from '@/lib/auth';

type Props = ComponentProps<typeof TripDashboard>;

/**
 * The dashboard for `/?trip=`. The server renders the link without the browser's sign-in, so a trip that belongs to an
 * account looks "not found" there. When that happens and someone is signed in, ask again here with their token.
 */
export function DeepLinkedTrip(props: Props) {
  const { initialThreadId, tripLookup } = props;
  const mustRecheck = tripLookup === 'not-found' && initialThreadId !== null;
  // 'checking' until the browser has looked, so a signed-in owner never sees a "not found" flash.
  const [recheck, setRecheck] = useState<'checking' | 'done'>(mustRecheck ? 'checking' : 'done');
  const [stored, setStored] = useState<StoredTrip | null>(null);

  useEffect(() => {
    if (!mustRecheck) return;
    if (!readSession()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the session is only readable in the browser
      setRecheck('done');
      return;
    }
    let cancelled = false;
    void fetchStoredTrip(initialThreadId).then((lookup) => {
      if (cancelled) return;
      if (lookup !== null && lookup !== 'not-found') setStored(lookup);
      setRecheck('done');
    });
    return () => {
      cancelled = true;
    };
  }, [mustRecheck, initialThreadId]);

  if (recheck === 'checking') {
    return (
      <Skeleton role="status" className="mx-auto m-6 h-96 w-full max-w-7xl rounded-xl border bg-card">
        <span className="sr-only">Loading…</span>
      </Skeleton>
    );
  }
  if (stored) {
    return <TripDashboard {...props} initialResult={stored.result} initialMessages={stored.messages} tripLookup="found" />;
  }
  return <TripDashboard {...props} />;
}
