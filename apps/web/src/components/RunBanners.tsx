'use client';

import type { LogPayload, ProgressPayload, ResultPayload } from '@ai-travel/contracts';
import { AlertTriangleIcon, CircleStopIcon, CpuIcon, RotateCcwIcon, WifiOffIcon, XCircleIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import type { ReconnectState, StreamStatus } from '@/hooks/useAgentStream';
import { useNow } from '@/hooks/useNow';
import { STATUS_LABELS } from '@/lib/labels';
import { cn, formatUsd } from '@/lib/utils';

type Tone = 'info' | 'warn' | 'danger' | 'neutral';

const TONES: Record<Tone, string> = {
  info: 'border-primary/25 bg-primary-soft [&_[data-icon]]:text-primary',
  warn: 'border-live/45 bg-live-soft [&_[data-icon]]:text-live-foreground',
  danger: 'border-destructive/30 bg-destructive-soft [&_[data-icon]]:text-destructive',
  neutral: 'border-border bg-card [&_[data-icon]]:text-ink-2',
};

function Banner({ tone, icon, title, children, actions }: { tone: Tone; icon: ReactNode; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border px-4 py-3', TONES[tone])}>
      <span data-icon aria-hidden="true" className="shrink-0">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold">{title}</p>
        {children && <div className="text-sm text-ink-2">{children}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2 max-sm:w-full">{actions}</div>}
    </div>
  );
}

interface RunBannersProps {
  status: StreamStatus;
  threadId: string | null;
  logs: LogPayload[];
  result: ResultPayload | null;
  error: string | null;
  reconnect: ReconnectState | null;
  lastProgress: ProgressPayload | null;
  /** Any flight or hotel so far has `source: 'mock'`. */
  estimates: boolean;
  onResume: () => void;
  onStartOver: () => void;
  onReconnect: () => void;
  onRaiseBudget: (budget: number) => void;
  onTryDays: (days: number) => void;
}

const btn = 'h-9';
const outlineBtn = 'h-9 bg-card';

/** Stacked run-state banners: fallback model, estimates, over budget, stopped / failed, reconnecting. */
export function RunBanners(props: RunBannersProps) {
  const { status, threadId, logs, result, error, reconnect, lastProgress, estimates } = props;
  const [keep, setKeep] = useState(false);
  const now = useNow(1000, status === 'reconnecting');
  const banners: ReactNode[] = [];
  const lastStep = logs.reduce((max, l) => Math.max(max, l.step), 0) || 1;

  if (logs.some((l) => l.kind === 'llm-fallback')) {
    banners.push(
      <Banner key="llm" tone="info" icon={<CpuIcon className="size-5" />} title="Running on fallback model">
        The primary model is unavailable; the fallback took over.
      </Banner>,
    );
  }
  if (estimates || logs.some((l) => l.kind === 'search-fallback')) {
    banners.push(
      <Banner key="estimates" tone="warn" icon={<AlertTriangleIcon className="size-5" />} title="Live search down — estimates">
        Live prices are unavailable, so these are estimates. Check before you book.
      </Banner>,
    );
  }
  if (result?.status === 'completed' && result.suggestions && !keep) {
    const { raiseBudgetTo, tryDays } = result.suggestions;
    const over = Math.max(0, result.totalCost - result.budget);
    banners.push(
      <Banner
        key="over"
        tone="danger"
        icon={<AlertTriangleIcon className="size-5" />}
        title={`Over budget after ${result.replans} re-plans`}
        actions={
          <>
            <Button className={btn} onClick={() => props.onRaiseBudget(raiseBudgetTo)}>
              Raise to {formatUsd(raiseBudgetTo)}
            </Button>
            {tryDays < result.durationDays && (
              <Button variant="outline" className={outlineBtn} onClick={() => props.onTryDays(tryDays)}>
                Try {tryDays} days
              </Button>
            )}
            <Button variant="ghost" className={btn} onClick={() => setKeep(true)}>
              Keep these
            </Button>
          </>
        }
      >
        Best options found, {formatUsd(over)} over.
      </Banner>,
    );
  }
  if (result?.status === 'completed') {
    for (const warning of result.warnings) {
      // The over-budget and estimate banners already say these.
      if ((result.suggestions && /over budget/i.test(warning)) || (estimates && /estimate/i.test(warning))) continue;
      banners.push(<Banner key={warning} tone="warn" icon={<AlertTriangleIcon className="size-5" />} title={warning} />);
    }
  }
  if (status === 'failed' && threadId) {
    const lost = error === 'Connection lost';
    banners.push(
      <Banner
        key="failed"
        tone="danger"
        icon={lost ? <WifiOffIcon className="size-5" /> : <XCircleIcon className="size-5" />}
        title={lost ? 'Connection lost' : `Run stopped at step ${lastStep}`}
        actions={
          <>
            <Button className={btn} onClick={props.onResume}>
              <RotateCcwIcon aria-hidden="true" /> Resume from step {lastStep}
            </Button>
            <Button variant="outline" className={outlineBtn} onClick={props.onStartOver}>
              Start over
            </Button>
          </>
        }
      >
        {lastStep > 2 ? `Steps 1–${lastStep - 1} are saved.` : lastStep === 2 ? 'Step 1 is saved.' : 'Nothing was lost.'} {error && !lost ? error : ''}
      </Banner>,
    );
  }
  if (status === 'aborted') {
    banners.push(
      <Banner
        key="aborted"
        tone="neutral"
        icon={<CircleStopIcon className="size-5" />}
        title="You stopped the run"
        actions={
          threadId ? (
            <>
              <Button className={btn} onClick={props.onResume}>
                <RotateCcwIcon aria-hidden="true" /> Resume
              </Button>
              <Button variant="outline" className={outlineBtn} onClick={props.onStartOver}>
                Start over
              </Button>
            </>
          ) : undefined
        }
      >
        {threadId ? `The agents saved their work up to step ${lastStep}. Resume when ready.` : 'Nothing was saved.'}
      </Banner>,
    );
  }
  if (status === 'reconnecting' && reconnect) {
    const wait = reconnect.nextAt && now ? Math.max(0, Math.ceil((reconnect.nextAt - now) / 1000)) : null;
    banners.push(
      <Banner
        key="reconnect"
        tone="warn"
        icon={<WifiOffIcon className="size-5" />}
        title={`Stream dropped — reconnecting · attempt ${reconnect.attempt} of ${reconnect.max}`}
        actions={
          <Button variant="outline" className={outlineBtn} onClick={props.onReconnect} disabled={reconnect.nextAt === null}>
            {reconnect.nextAt === null ? 'Reconnecting…' : `Reconnect now${wait ? ` (${wait}s)` : ''}`}
          </Button>
        }
      >
        {lastProgress && `Last update · ${lastProgress.progressPercent}% ${STATUS_LABELS[lastProgress.currentStatus].toLowerCase()}. `}
        The run keeps going on the server.
      </Banner>,
    );
  }
  if (banners.length === 0) return null;
  return <div className="flex flex-col gap-3">{banners}</div>;
}
