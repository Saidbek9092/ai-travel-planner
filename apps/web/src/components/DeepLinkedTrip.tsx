'use client';

import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { TripDashboard } from '@/components/TripDashboard';
import { PageSkeleton } from '@/components/PageSkeleton';
import { fetchStoredTrip, type StoredTrip } from '@/lib/api';
import { readSession } from '@/lib/auth';

type Props = ComponentProps<typeof TripDashboard>;

/**
 * Next keeps this page's state when you leave it, and the dashboard reads its trip from props only when it mounts.
 * So a link to a trip the dashboard is not showing (it was cleared by "Plan a trip", or shows another trip) must mount
 * a fresh one. A trip the dashboard already shows (a live run you left and came back to) is kept, so it keeps running.
 */
export function DeepLinkedTrip(props: Props) {
  const { initialThreadId } = props;
  const shown = useRef<string | null>(initialThreadId);
  const [mounts, setMounts] = useState(0);
  useEffect(() => {
    if (initialThreadId === null || initialThreadId === shown.current) return;
    shown.current = initialThreadId;
    setMounts((n) => n + 1);
  }, [initialThreadId]);
  return (
    <LinkedTrip
      key={mounts}
      {...props}
      onThreadChange={(id) => {
        shown.current = id;
      }}
    />
  );
}

/**
 * The dashboard for `/?trip=`. The server renders the link without the browser's sign-in, so a trip that belongs to an
 * account looks "not found" there. When that happens and someone is signed in, ask again here with their token.
 */
function LinkedTrip(props: Props) {
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
    return <PageSkeleton />;
  }
  if (stored) {
    return <TripDashboard {...props} initialResult={stored.result} initialMessages={stored.messages} tripLookup="found" />;
  }
  return <TripDashboard {...props} />;
}
