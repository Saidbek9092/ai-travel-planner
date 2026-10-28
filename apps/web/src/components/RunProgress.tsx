'use client';

import type { DecisionTopic, ProgressPayload } from '@ai-travel/contracts';
import { CheckIcon } from 'lucide-react';
import { Fragment } from 'react';
import type { StreamStatus } from '@/hooks/useAgentStream';
import { useNow } from '@/hooks/useNow';
import { STATUS_LABELS } from '@/lib/labels';
import { etaSeconds, formatEta, type PhaseState } from '@/lib/trip';
import { cn } from '@/lib/utils';

interface RunProgressProps {
  status: StreamStatus;
  progress: ProgressPayload | null;
  phases: { topic: DecisionTopic; label: string; state: PhaseState }[];
  startedAt: number | null;
  /** One-line brief, e.g. "Tashkent → Paris · 5 days · $1,000". */
  brief: string | null;
}

function PhaseDot({ state }: { state: PhaseState }) {
  if (state === 'done') {
    return (
      <span className="flex size-6 items-center justify-center rounded-full bg-success text-white">
        <CheckIcon className="size-3.5" strokeWidth={3} aria-hidden="true" />
      </span>
    );
  }
  return (
    <span
      className={cn(
        'flex size-6 items-center justify-center rounded-full border-2 bg-card',
        state === 'current' ? 'border-live' : 'border-border',
      )}
    >
      {state === 'current' && <span className="size-2.5 rounded-full bg-live motion-safe:animate-pulse" />}
    </span>
  );
}

/** "Planning your trip · 82% · about 20 s left" and the six phase steps (Brief … Budget check). */
export function RunProgress({ status, progress, phases, startedAt, brief }: RunProgressProps) {
  const live = status === 'connecting' || status === 'streaming' || status === 'reconnecting';
  const now = useNow(1000, live);
  const percent = status === 'completed' ? 100 : (progress?.progressPercent ?? 0);
  const eta = live ? etaSeconds(percent, startedAt, now) : null;
  const label = progress ? STATUS_LABELS[progress.currentStatus] : 'Connecting to the agents';

  return (
    <section
      aria-label="Planning progress"
      className={cn('rounded-xl border bg-card p-5 sm:px-6', status !== 'completed' && !live && 'opacity-70')}
    >
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:gap-10">
        <div className="shrink-0">
          <h2 className="text-xl leading-7 font-semibold">{live ? 'Planning your trip' : status === 'completed' ? 'Trip planned' : 'Planning stopped'}</h2>
          {brief && <p className="text-[13px] leading-[18px] text-muted-foreground lg:hidden">{brief}</p>}
          <p className="flex items-baseline gap-2">
            <span className="text-[32px] leading-10 font-semibold tracking-tight">{percent}%</span>
            <span className="text-[13px] text-muted-foreground">{eta !== null ? formatEta(eta) : label}</span>
          </p>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-valuetext={`${percent}% · ${label}${progress?.detail ? ` · ${progress.detail}` : ''}`}
            aria-label="Planning progress"
            className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary lg:hidden"
          >
            <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${percent}%` }} />
          </div>
        </div>

        <ol className="hidden flex-1 items-start lg:flex" aria-label="Planning steps">
          {phases.map((phase, i) => (
            <Fragment key={phase.topic}>
              <li className="flex w-24 shrink-0 flex-col items-start gap-2" aria-current={phase.state === 'current' ? 'step' : undefined}>
                <PhaseDot state={phase.state} />
                <span
                  className={cn(
                    'text-[13px] leading-[18px] font-medium',
                    phase.state === 'current' && 'text-live-foreground',
                    phase.state === 'pending' && 'text-ink-2',
                  )}
                >
                  {phase.label}
                  <span className="sr-only"> · {phase.state === 'done' ? 'done' : phase.state === 'current' ? 'in progress' : 'not started'}</span>
                </span>
                {phase.state === 'current' && phase.topic === 'itinerary' && progress?.currentStatus === 'planning' && progress.detail && live && (
                  <span className="-mt-1.5 text-xs text-muted-foreground">{progress.detail}</span>
                )}
              </li>
              {i < phases.length - 1 && (
                <li aria-hidden="true" className="mt-[11px] -ml-[68px] h-0.5 flex-1">
                  <span className={cn('block h-full', phase.state === 'done' ? 'bg-success' : 'bg-border')} />
                </li>
              )}
            </Fragment>
          ))}
        </ol>
        {/* Below lg: the current step as text, the bar above carries the percent. */}
        <p className="text-[13px] text-ink-2 lg:hidden">
          {phases.find((p) => p.state === 'current')?.label ?? 'Done'}
          {progress?.detail && live ? ` · ${progress.detail}` : ''}
        </p>
      </div>
    </section>
  );
}
