'use client';

import { ChevronDownIcon, ShieldCheckIcon } from 'lucide-react';
import { AgentAvatar } from '@/components/AgentAvatar';
import { AGENT_ORDER, agentDisplayNames } from '@/lib/labels';

const AGENT_ROLES: Record<(typeof AGENT_ORDER)[number], string> = {
  Supervisor: 'Reads your sentence and turns it into a plan.',
  FlightAgent: 'Finds flights, layovers and the ride from the airport.',
  HotelAgent: 'Picks a well-rated stay that fits the budget.',
  Planner: 'Builds each day on a map, around the weather.',
  BudgetAuditor: "Checks the total and re-plans up to twice if it's over.",
};

/** Dark band at the top of the start page; the form card overlaps its lower edge. */
export function StartHero() {
  return (
    <section aria-labelledby="plan-title" className="bg-[#0b1726] text-white">
      <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-2 px-4 pt-8 pb-20 sm:px-8 lg:px-8 [@media(min-width:1024px)_and_(max-height:980px)]:pt-5">
        <p className="font-mono text-[11px] tracking-[0.14em] text-white/70 uppercase">Plan a trip</p>
        <h1 id="plan-title" className="text-4xl font-semibold tracking-tight sm:text-[44px] sm:leading-[1.1] [@media(min-width:1024px)_and_(max-height:980px)]:text-[34px]">
          Where do you want to go?
        </h1>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <p className="max-w-[44rem] text-base leading-relaxed text-white/80 [@media(min-width:1024px)_and_(max-height:980px)]:sr-only">
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

/** Extra information, closed by default: who the five agents are and what each does. */
export function HowItWorks({ embedded = false }: { embedded?: boolean }) {
  return (
    <details className={embedded ? 'group border-t' : 'group rounded-2xl border bg-card shadow-sm'}>
      <summary className={`flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl outline-none ${embedded ? 'pt-4' : 'p-5'} focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden`}>
        <span>
          <span className="block text-[15px] font-semibold">How the five agents plan it</span>
          <span className="block text-sm text-ink-2">You watch them talk it through in the Agent Chat.</span>
        </span>
        <ChevronDownIcon className="size-5 shrink-0 text-ink-2 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className={embedded ? 'flex flex-col gap-5 pt-5' : 'flex flex-col gap-5 border-t p-5'}>
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
      </div>
    </details>
  );
}
