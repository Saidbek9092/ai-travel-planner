'use client';

import type { UsageResponse } from '@ai-travel/contracts';
import { CircleAlertIcon, SparklesIcon, TicketIcon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useUsage } from '@/hooks/useUsage';
import { cn } from '@/lib/utils';

type Tone = 'ok' | 'last' | 'none';

const toneOf = ({ remaining }: UsageResponse): Tone => (remaining === 0 ? 'none' : remaining === 1 ? 'last' : 'ok');

const TONES: Record<Tone, { surface: string; text: string; pip: string }> = {
  ok: { surface: 'border-primary/25 bg-primary-soft', text: 'text-primary', pip: 'bg-primary' },
  last: { surface: 'border-live/50 bg-live-soft', text: 'text-live-foreground', pip: 'bg-live' },
  none: { surface: 'border-destructive/30 bg-destructive-soft', text: 'text-destructive', pip: 'bg-destructive' },
};

/** One segment per plan: filled while it is still available, an empty outline once used. */
function Pips({ usage, className }: { usage: UsageResponse; className?: string }) {
  const tone = TONES[toneOf(usage)];
  return (
    <span aria-hidden="true" className={cn('flex items-center gap-1', className)}>
      {Array.from({ length: usage.max }, (_, index) => (
        <span key={index} className={cn('h-2 w-5 rounded-full border transition-colors', index < usage.remaining ? `${tone.pip} border-transparent` : 'border-current/40 bg-transparent')} />
      ))}
    </span>
  );
}

const word = (count: number) => (count === 1 ? 'plan' : 'plans');

/** Header pill, on every page while signed in: always shows what is left, and says what counts on hover or focus. */
export function PlansMeter() {
  const usage = useUsage();
  if (!usage) return null;
  const tone = TONES[toneOf(usage)];
  const label = usage.remaining === 0 ? 'No plans left' : `${usage.remaining} of ${usage.max} ${word(usage.max)} left`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span tabIndex={0} role="status" aria-label={label} />}
        className={cn('inline-flex h-10 shrink-0 cursor-default items-center gap-2 rounded-full border px-3 text-[13px] font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:h-11', tone.surface, tone.text)}
      >
        <TicketIcon className="size-4 max-sm:hidden" aria-hidden="true" />
        <Pips usage={usage} />
        <span className="whitespace-nowrap max-md:sr-only">{usage.remaining === 0 ? 'No plans left' : `${usage.remaining} left`}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64 text-balance">
        {label}. A new trip or a re-plan uses one. Resuming a stopped trip is free, and your saved trips stay available.
      </TooltipContent>
    </Tooltip>
  );
}

/** Card above the Plan button: what is left, what uses a plan, and what to do at zero. */
export function PlansCard({ usage, className }: { usage: UsageResponse; className?: string }) {
  const kind = toneOf(usage);
  const tone = TONES[kind];
  const Icon = kind === 'none' ? CircleAlertIcon : kind === 'last' ? SparklesIcon : TicketIcon;
  const title =
    kind === 'none'
      ? 'No plans left'
      : kind === 'last'
        ? 'Last plan, make it count'
        : `${usage.remaining} of ${usage.max} ${word(usage.max)} left`;
  const body =
    kind === 'none'
      ? `You've used all ${usage.max} plans included with your account. Your saved trips are still in My trips.`
      : kind === 'last'
        ? 'This is the last plan included with your account. If it stops, resuming it is free.'
        : 'A new trip or a re-plan uses one. Resuming a stopped trip is free.';
  return (
    <div role="status" className={cn('flex items-center gap-4 rounded-xl border px-4 py-3', tone.surface, className)}>
      <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-full bg-card', tone.text)}>
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn('text-[15px] leading-5 font-semibold', tone.text)}>{title}</p>
        <p className="mt-0.5 text-[13px] leading-[18px] text-ink-2">{body}</p>
      </div>
      <Pips usage={usage} className={cn('shrink-0 max-sm:hidden', tone.text)} />
    </div>
  );
}
