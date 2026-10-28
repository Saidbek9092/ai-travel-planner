import { CheckIcon, CircleAlertIcon, CircleCheckIcon, CircleXIcon, ClockIcon, LoaderCircleIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { AgentRunStatus } from '@/lib/trip';
import { cn } from '@/lib/utils';

/** "✓ Confirmed": a section's decision message has arrived. Icon + word, never colour alone. */
export function ConfirmedTag({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex h-6 items-center gap-1 rounded-full bg-success-soft px-2.5 text-xs font-medium text-success', className)}>
      <CheckIcon className="size-3.5" aria-hidden="true" /> Confirmed
    </span>
  );
}

/** Amber "live" pill with a dot, e.g. "Final check pending". */
export function PendingTag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex h-6 items-center gap-1.5 rounded-full bg-live-soft px-2.5 text-xs font-medium text-live-foreground', className)}>
      <span className="size-1.5 rounded-full bg-live" aria-hidden="true" />
      {children}
    </span>
  );
}

const STATUS_CHIPS: Record<AgentRunStatus, { label: string; icon: typeof CheckIcon; className: string }> = {
  waiting: { label: 'Waiting', icon: ClockIcon, className: 'bg-secondary text-muted-foreground' },
  running: { label: 'Running', icon: LoaderCircleIcon, className: 'bg-live-soft text-live-foreground' },
  done: { label: 'Done', icon: CircleCheckIcon, className: 'bg-success-soft text-success' },
  failed: { label: 'Failed', icon: CircleXIcon, className: 'bg-destructive-soft text-destructive' },
};

/** Agent status chip: one shape per state; the word and the icon carry the meaning. */
export function AgentStatusChip({ status }: { status: AgentRunStatus }) {
  const chip = STATUS_CHIPS[status];
  const Icon = chip.icon;
  return (
    <span className={cn('inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-xs font-medium', chip.className)}>
      <Icon className={cn('size-3.5', status === 'running' && 'motion-safe:animate-spin')} aria-hidden="true" />
      {chip.label}
    </span>
  );
}

/** Muted "Estimated" tag for `source: 'mock'` options. */
export function EstimateTag({ className }: { className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span tabIndex={0} />}
        className={cn('inline-flex h-6 items-center gap-1 rounded-full bg-secondary px-2.5 text-xs font-medium text-muted-foreground', className)}
      >
        <CircleAlertIcon className="size-3.5" aria-hidden="true" /> Estimated
      </TooltipTrigger>
      <TooltipContent>Live prices unavailable, check before booking</TooltipContent>
    </Tooltip>
  );
}
