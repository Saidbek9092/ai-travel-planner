import { Suspense } from 'react';
import { DeepLinkedTrip } from '@/components/DeepLinkedTrip';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchStoredTrip } from '@/lib/api';

async function DeepLinkedDashboard({ searchParams }: Pick<PageProps<'/'>, 'searchParams'>) {
  const { trip } = await searchParams;
  const threadId = typeof trip === 'string' && trip !== '' ? trip : null;
  const lookup = threadId ? await fetchStoredTrip(threadId) : null;
  const stored = lookup === 'not-found' ? null : lookup;
  return (
    <DeepLinkedTrip
      initialThreadId={threadId}
      initialResult={stored?.result ?? null}
      initialMessages={stored?.messages ?? []}
      tripLookup={!threadId ? null : lookup === 'not-found' ? 'not-found' : stored ? 'found' : 'unavailable'}
    />
  );
}

export default function Page({ searchParams }: PageProps<'/'>) {
  return (
    // `bg-card`: the skeleton's default `bg-muted` is the page ground, so a loading trip link would look blank.
    <Suspense
      fallback={
        <Skeleton role="status" className="mx-auto m-6 h-96 w-full max-w-7xl rounded-xl border bg-card">
          <span className="sr-only">Loading…</span>
        </Skeleton>
      }
    >
      <DeepLinkedDashboard searchParams={searchParams} />
    </Suspense>
  );
}
