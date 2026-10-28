'use client';

import { AlertTriangleIcon, CircleCheckIcon, InfoIcon, XCircleIcon, XIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export type NoticeTone = 'info' | 'success' | 'warning' | 'error';
export type NoticePlacement = 'inline' | 'banner' | 'toast';

const TONES: Record<NoticeTone, { box: string; icon: string; Icon: typeof InfoIcon }> = {
  info: { box: 'border-border bg-card', icon: 'text-primary', Icon: InfoIcon },
  success: { box: 'border-success/30 bg-success-soft', icon: 'text-success', Icon: CircleCheckIcon },
  warning: { box: 'border-live/45 bg-live-soft', icon: 'text-live-foreground', Icon: AlertTriangleIcon },
  error: { box: 'border-destructive/30 bg-destructive-soft', icon: 'text-destructive', Icon: XCircleIcon },
};

interface NoticeProps {
  tone?: NoticeTone;
  /** inline: next to the thing it is about · banner: trip-level outcome · toast: temporary system event. */
  placement?: NoticePlacement;
  /** What happened, in plain words. Never an error code or a model name. */
  title: string;
  /** What it means for the traveller. */
  children?: ReactNode;
  /** One clear next step. */
  actions?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}

/**
 * The one notice component: info, success, warning, error × inline, banner, toast.
 * Copy: say what happened, what it means for you, and one action. Icon + text, never colour alone.
 * Only `error` is announced assertively (`role="alert"`); everything else is a polite status.
 */
export function Notice({ tone = 'info', placement = 'banner', title, children, actions, onDismiss, className }: NoticeProps) {
  const { box, icon, Icon } = TONES[tone];
  const compact = placement !== 'banner';
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border',
        compact ? 'px-3 py-2.5' : 'gap-x-4 gap-y-3 px-4 py-3',
        placement === 'toast' && 'w-full bg-card shadow-lg',
        box,
        className,
      )}
    >
      <Icon aria-hidden="true" className={cn('shrink-0', compact ? 'size-4' : 'size-5', icon)} />
      <div className="min-w-0 flex-1">
        <p className={cn('font-semibold', compact ? 'text-sm' : 'text-[15px]')}>{title}</p>
        {children && <div className="text-sm text-ink-2">{children}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2 max-sm:w-full">{actions}</div>}
      {onDismiss && (
        <button type="button" aria-label="Dismiss" onClick={onDismiss} className="shrink-0 rounded-md p-1 text-ink-2 hover:bg-black/5">
          <XIcon className="size-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/** Show a toast-placement notice. A fixed `id` keeps repeats from stacking and updates it in place. */
export function notify(tone: NoticeTone, title: string, options: { description?: string; id?: string; duration?: number } = {}) {
  return toast.custom(
    (id) => (
      <Notice tone={tone} placement="toast" title={title} onDismiss={() => toast.dismiss(id)}>
        {options.description}
      </Notice>
    ),
    { id: options.id, duration: options.duration },
  );
}

export function dismissNotice(id: string) {
  toast.dismiss(id);
}
