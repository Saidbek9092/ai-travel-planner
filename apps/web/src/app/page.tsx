import { Suspense } from 'react';
import { TripDashboard } from '@/components/TripDashboard';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchStoredTrip } from '@/lib/api';

async function DeepLinkedDashboard({ searchParams }: Pick<PageProps<'/'>, 'searchParams'>) {
  const { trip } = await searchParams;
  const threadId = typeof trip === 'string' && trip !== '' ? trip : null;
  const stored = threadId ? await fetchStoredTrip(threadId) : null;
  return <TripDashboard initialThreadId={threadId} initialResult={stored?.result ?? null} initialMessages={stored?.messages ?? []} />;
}

export default function Page({ searchParams }: PageProps<'/'>) {
  return (
    <Suspense fallback={<Skeleton className="mx-auto m-6 h-96 w-full max-w-7xl rounded-xl" />}>
      <DeepLinkedDashboard searchParams={searchParams} />
    </Suspense>
  );
}
