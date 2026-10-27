import { Suspense } from 'react';
import { TripDashboard } from '@/components/TripDashboard';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchTripResult } from '@/lib/api';

async function DeepLinkedDashboard({ searchParams }: Pick<PageProps<'/'>, 'searchParams'>) {
  const { trip } = await searchParams;
  const threadId = typeof trip === 'string' && trip !== '' ? trip : null;
  const initialResult = threadId ? await fetchTripResult(threadId) : null;
  return <TripDashboard initialThreadId={threadId} initialResult={initialResult} />;
}

export default function Page({ searchParams }: PageProps<'/'>) {
  return (
    <Suspense fallback={<Skeleton className="mx-auto m-6 h-96 w-full max-w-7xl rounded-xl" />}>
      <DeepLinkedDashboard searchParams={searchParams} />
    </Suspense>
  );
}
