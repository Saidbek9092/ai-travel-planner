import type { Metadata } from 'next';
import { TripHistoryList } from '@/components/TripHistoryList';

export const metadata: Metadata = { title: 'My trips · AI Travel Planner' };

export default function TripsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <div>
        <p className="label-mono text-muted-foreground">My trips</p>
        <h1 className="mt-1 text-[28px] leading-9 font-semibold tracking-tight">Trips you planned</h1>
        <p className="mt-1 text-[15px] text-ink-2">Saved in this browser only. Open one to see its flights, hotel and days again.</p>
      </div>
      <TripHistoryList />
    </main>
  );
}
