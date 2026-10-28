'use client';

import { CheckIcon, PauseIcon, ShieldCheckIcon } from 'lucide-react';
import Link from 'next/link';
import { AgentAvatar } from '@/components/AgentAvatar';
import { Button, buttonVariants } from '@/components/ui/button';
import { useTripHistory } from '@/hooks/useTripHistory';
import { AGENT_ORDER, agentDisplayNames } from '@/lib/labels';

const AGENT_ROLES: Record<(typeof AGENT_ORDER)[number], string> = {
  Supervisor: 'Reads your sentence and turns it into a plan.',
  FlightAgent: 'Finds flights, layovers and the ride from the airport.',
  HotelAgent: 'Picks a well-rated stay that fits the budget.',
  Planner: 'Builds each day on a map, around the weather.',
  BudgetAuditor: "Checks the total and re-plans up to twice if it's over.",
};

const created = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

/** Dark band at the top of the start page; the form card overlaps its lower edge. */
export function StartHero() {
  return (
    <section aria-labelledby="plan-title" className="bg-[#0b1726] text-white">
      <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-3 px-4 pt-10 pb-[104px] sm:px-8 lg:px-8">
        <p className="font-mono text-[11px] tracking-[0.14em] text-white/70 uppercase">Plan a trip</p>
        <h1 id="plan-title" className="text-4xl font-semibold tracking-tight sm:text-[44px] sm:leading-[1.1]">
          Where do you want to go?
        </h1>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <p className="max-w-[44rem] text-[17px] leading-relaxed text-white/80">
            Describe the trip in one sentence. Five agents find the flights, a hotel and a day-by-day plan — and keep it all under your budget.
          </p>
          <p className="flex items-center gap-3 text-sm text-white/80">
            <span className="flex -space-x-2" aria-hidden="true">
              {AGENT_ORDER.map((agent) => (
                <AgentAvatar key={agent} agent={agent} size="sm" className="ring-[#0b1726] first:bg-[#3a4a5f]!" />
              ))}
            </span>
            <span className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-[#2fd4a0]" aria-hidden="true" /> 5 agents ready
            </span>
          </p>
        </div>
      </div>
    </section>
  );
}

export function HowItWorks() {
  return (
    <section aria-labelledby="how-it-works" className="flex flex-col gap-5 rounded-2xl border bg-card p-6 shadow-sm">
      <div>
        <h2 id="how-it-works" className="text-lg font-semibold">
          What happens after you press Plan
        </h2>
        <p className="text-sm text-ink-2">You watch five agents talk it through in the Agent Chat.</p>
      </div>
      <ol className="flex flex-col">
        {AGENT_ORDER.map((agent, index) => (
          <li key={agent} className="relative flex gap-4 pb-5 last:pb-0">
            {index < AGENT_ORDER.length - 1 && <span className="absolute top-9 bottom-0 left-[17px] w-px bg-border" aria-hidden="true" />}
            <AgentAvatar agent={agent} />
            <div>
              <p className="font-semibold">{agentDisplayNames[agent]}</p>
              <p className="text-sm text-ink-2">{AGENT_ROLES[agent]}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="flex items-start gap-3 rounded-xl border border-success/30 bg-success-soft p-4 text-sm text-success">
        <ShieldCheckIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          <strong>Safe to step away.</strong> Progress is saved after every step, so a paused plan picks up where it stopped.
        </span>
      </p>
    </section>
  );
}

/** Latest finished and paused trips from this browser. Hidden when there are none. */
export function PickUp({ disabled, onResume }: { disabled: boolean; onResume: (threadId: string) => void }) {
  const { trips } = useTripHistory();
  const latestDone = trips.find((t) => t.status !== 'paused');
  const latestPaused = trips.find((t) => t.status === 'paused');
  const items = [latestDone, latestPaused].filter((t): t is NonNullable<typeof t> => !!t);
  if (items.length === 0) return null;

  return (
    <section aria-labelledby="pick-up" className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <header className="flex items-baseline justify-between gap-3 px-5 py-4">
        <h2 id="pick-up" className="text-lg font-semibold">
          Pick up where you left off
        </h2>
        <Link href="/trips" className="text-[13px] text-primary underline underline-offset-2">
          All trips
        </Link>
      </header>
      <ul>
        {items.map((trip) => {
          const paused = trip.status === 'paused';
          return (
            <li key={trip.threadId} className="flex items-center gap-4 border-t px-5 py-4">
              <span
                className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${paused ? 'bg-live-soft text-live-foreground' : 'bg-success-soft text-success'}`}
                aria-hidden="true"
              >
                {paused ? <PauseIcon className="size-4" /> : <CheckIcon className="size-5" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{trip.title}</p>
                <p className="truncate text-[13px] text-ink-2">
                  {paused ? 'Paused' : 'Ready'} · {created.format(trip.createdAt)}
                </p>
              </div>
              {paused ? (
                <Button className="h-10 px-4" disabled={disabled} onClick={() => onResume(trip.threadId)} aria-label={`Resume ${trip.title}`}>
                  Resume
                </Button>
              ) : (
                <Link
                  href={`/?trip=${encodeURIComponent(trip.threadId)}`}
                  aria-label={`Open ${trip.title}`}
                  className={buttonVariants({ variant: 'outline', className: 'h-10 px-4' })}
                >
                  Open
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
