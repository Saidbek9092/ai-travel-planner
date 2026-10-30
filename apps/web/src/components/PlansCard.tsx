'use client';

import type { UsageResponse } from '@ai-travel/contracts';
import { InfoIcon, SparklesIcon, TicketIcon } from 'lucide-react';
import { notify } from '@/components/Notice';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Tone = 'ok' | 'last' | 'none';

const toneOf = ({ remaining }: UsageResponse): Tone => (remaining === 0 ? 'none' : remaining === 1 ? 'last' : 'ok');

const TONES: Record<Tone, { surface: string; text: string; pip: string }> = {
  ok: { surface: 'border-primary/25 bg-primary-soft', text: 'text-primary', pip: 'bg-primary' },
  last: { surface: 'border-live/50 bg-live-soft', text: 'text-live-foreground', pip: 'bg-live' },
  none: { surface: 'border-primary/25 bg-primary-soft', text: 'text-primary', pip: 'bg-primary' },
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

/** Card above the Plan button: what is left, what uses a plan, and what to do at zero. */
export function PlansCard({ usage, className }: { usage: UsageResponse; className?: string }) {
  const kind = toneOf(usage);
  const tone = TONES[kind];
  const Icon = kind === 'none' ? InfoIcon : kind === 'last' ? SparklesIcon : TicketIcon;
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
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border px-4 py-3', tone.surface, className)}>
      <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-full bg-card', tone.text)}>
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <div role="status" className="min-w-0 flex-1 basis-56">
        <p className={cn('text-[15px] leading-5 font-semibold', tone.text)}>{title}</p>
        <p className="mt-0.5 text-[13px] leading-[18px] text-ink-2">{body}</p>
      </div>
      {kind === 'none' ? (
        // Requesting more is not built yet: the button says so instead of leading nowhere.
        <Button
          type="button"
          variant="outline"
          className="h-10 shrink-0 bg-card px-4 pointer-coarse:h-11"
          onClick={() =>
            notify('info', 'Coming soon', {
              id: 'more-plans',
              description: 'Requesting more plans is not available yet. Your saved trips stay in My trips.',
            })
          }
        >
          Request more plans
        </Button>
      ) : (
        <Pips usage={usage} className={cn('shrink-0 max-sm:hidden', tone.text)} />
      )}
    </div>
  );
}
