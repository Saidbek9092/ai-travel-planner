'use client';

import type { TripSummary } from '@ai-travel/contracts';
import Link from 'next/link';
import { ChevronRightIcon, LaptopIcon, PlaneIcon, Trash2Icon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { notify } from '@/components/Notice';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/hooks/useSession';
import { useTripHistory, type TripHistoryEntry } from '@/hooks/useTripHistory';
import { fetchMyTrips } from '@/lib/api';
import { authHeaders } from '@/lib/auth';
import { env } from '@/lib/env';
import { adoptOwnerId, ownerId } from '@/lib/owner';
import { tripTitle } from '@/lib/trip';
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
      fetch(`${env.agentUrl}/api/trips/${encodeURIComponent(id)}`, { headers: authHeaders(), signal: controller.signal })
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

/**
 * Adopts the owner id from an "Open on another device" link (`/trips?owner=…`), then loads this owner's trips from
 * the agent. `trips` is `null` while loading, or when the agent cannot be asked (the list then falls back to this browser's).
 */
function useServerTrips(account: string | null) {
  const [trips, setTrips] = useState<TripSummary[] | null>(null);
  const [loading, setLoading] = useState(env.agentUrl !== null);
  useEffect(() => {
    // Signing in or out switches whose trips are shown.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reload state when the account changes
    setLoading(env.agentUrl !== null);
    const url = new URL(window.location.href);
    const shared = url.searchParams.get('owner');
    if (shared !== null) {
      if (adoptOwnerId(shared)) notify('success', 'Trips linked', { description: 'This browser now shows the same trips as the device you came from.' });
      else notify('error', 'That link is not valid');
      url.searchParams.delete('owner');
      window.history.replaceState(null, '', url);
    }
    const controller = new AbortController();
    void fetchMyTrips(controller.signal).then((list) => {
      if (controller.signal.aborted) return;
      setTrips(list);
      setLoading(false);
    });
    return () => controller.abort();
  }, [account]);
  return { trips, loading };
}

interface Row extends TripHistoryEntry {
  /** Known to the agent's trip store, so no availability check is needed. */
  stored: boolean;
}

/** Server trips first (they hold the real outcome), plus local entries the server does not know (older or unfinished trips). */
function mergeTrips(server: TripSummary[] | null, local: TripHistoryEntry[]): Row[] {
  const fromServer: Row[] = (server ?? []).map((trip) => ({
    threadId: trip.threadId,
    title: tripTitle({ destination: trip.destination, durationDays: trip.durationDays }),
    createdAt: Date.parse(trip.createdAt),
    status: trip.status === 'completed' ? 'done' : 'paused',
    stored: true,
  }));
  const known = new Set(fromServer.map((trip) => trip.threadId));
  const localOnly: Row[] = local.filter((trip) => !known.has(trip.threadId)).map((trip) => ({ ...trip, stored: false }));
  return [...fromServer, ...localOnly].sort((a, b) => b.createdAt - a.createdAt);
}

export function TripHistoryList() {
  const { trips: local, remove } = useTripHistory();
  const session = useSession();
  const { trips: server, loading } = useServerTrips(session?.user.id ?? null);
  // A signed-in account sees only its own trips: this browser's local list may hold a guest's or another account's.
  const trips = useMemo(() => mergeTrips(server, session ? [] : local), [server, local, session]);
  const availability = useAvailability(trips.filter((t) => !t.stored).map((t) => t.threadId));

  return (
    <div className="flex flex-col gap-6" aria-busy={loading}>
      {trips.length === 0 && loading ? (
        // Not "No trips yet" before the agent has answered.
        <div className="flex flex-col gap-3" role="status">
          <span className="sr-only">Loading your trips…</span>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[70px] rounded-xl border bg-card" />
          ))}
        </div>
      ) : trips.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card/60 p-10 text-center text-ink-2">
          <PlaneIcon className="size-7" aria-hidden="true" />
          <p>No trips yet. Finished trips show up here.</p>
          <Link href="/" className="text-primary underline-offset-4 hover:underline">
            Plan a trip
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Trips">
          {trips.map((trip) => {
            const gone = !trip.stored && availability(trip.threadId) === 'gone';
            return (
              <li key={trip.threadId} className={cn('flex items-center gap-3 rounded-xl border bg-card px-4 py-3', gone && 'bg-muted')}>
                <div className="min-w-0 flex-1">
                  {gone ? (
                    <p className="truncate font-semibold text-ink-2">{trip.title}</p>
                  ) : (
                    <Link
                      href={`/?trip=${encodeURIComponent(trip.threadId)}`}
                      className="flex min-h-11 items-center gap-1 truncate font-semibold outline-none hover:text-primary focus-visible:underline"
                    >
                      <span className="truncate">{trip.title}</span> <ChevronRightIcon className="size-4 shrink-0" aria-hidden="true" />
                    </Link>
                  )}
                  <p className="text-[13px] text-muted-foreground">
                    {created.format(trip.createdAt)}
                    {trip.status === 'paused' && !gone && " · Didn't finish"}
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
      )}
      {server !== null && (session ? <AccountNote email={session.user.email} /> : <OtherDeviceLink />)}
    </div>
  );
}

/** Signed in: the same trips follow the account to any device. */
function AccountNote({ email }: { email: string }) {
  return (
    <p className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3 text-[14px] text-ink-2">
      <LaptopIcon className="size-5 shrink-0 text-muted-foreground max-sm:hidden" aria-hidden="true" />
      <span>
        Showing the trips of <span className="font-medium text-foreground">{email}</span>. Sign in with the same Google account on another device to see them there.
      </span>
    </p>
  );
}

/** Copies a link that shows these trips on another device (it carries the owner id, so it is shared on purpose only). */
function OtherDeviceLink() {
  const copy = async () => {
    const url = `${window.location.origin}/trips?owner=${encodeURIComponent(ownerId())}`;
    try {
      await navigator.clipboard.writeText(url);
      notify('success', 'Link copied', { description: 'Open it on your other device. Anyone with this link sees these trips.' });
    } catch {
      notify('error', "Couldn't copy the link", { description: url });
    }
  };
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card px-4 py-3 sm:flex-row sm:items-center">
      <LaptopIcon className="size-5 shrink-0 text-muted-foreground max-sm:hidden" aria-hidden="true" />
      <p className="flex-1 text-[14px] text-ink-2">See these trips on your phone or another computer, without an account.</p>
      <Button variant="outline" className="h-11" onClick={copy}>
        Copy link for another device
      </Button>
    </div>
  );
}
