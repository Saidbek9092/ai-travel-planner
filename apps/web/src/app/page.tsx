import { Suspense } from 'react';
import { DeepLinkedTrip } from '@/components/DeepLinkedTrip';
import { PageSkeleton } from '@/components/PageSkeleton';
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
    <Suspense fallback={<PageSkeleton />}>
      <DeepLinkedDashboard searchParams={searchParams} />
    </Suspense>
  );
}
