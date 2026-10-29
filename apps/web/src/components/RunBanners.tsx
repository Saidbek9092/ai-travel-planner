'use client';

import type { ProgressPayload, ResultPayload } from '@ai-travel/contracts';
import { RotateCcwIcon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Notice, dismissNotice, notify } from '@/components/Notice';
import { Button } from '@/components/ui/button';
import type { ReconnectState, StreamStatus } from '@/hooks/useAgentStream';
import { STATUS_LABELS } from '@/lib/labels';
import { formatUsd } from '@/lib/utils';

interface RunBannersProps {
  status: StreamStatus;
  threadId: string | null;
  result: ResultPayload | null;
  reconnect: ReconnectState | null;
  lastProgress: ProgressPayload | null;
  onResume: () => void;
  onStartOver: () => void;
  onRaiseBudget: (budget: number) => void;
  onTryDays: (days: number) => void;
  /** "Keep it" removes the banner (and the focused button with it): move focus somewhere sensible. */
  onKeep: () => void;
}

const btn = 'h-9 pointer-coarse:h-11';
const outlineBtn = 'h-9 bg-card pointer-coarse:h-11';
const RECONNECT_TOAST = 'stream-reconnecting';

/** Where a stopped run was, in traveller words ("the budget check"). */
function stopPoint(progress: ProgressPayload | null): string | null {
  return progress ? STATUS_LABELS[progress.currentStatus].toLowerCase() : null;
}

/**
 * Trip-level outcomes only, and never more than one banner at a time (most urgent first).
 * Model fallback shows nothing, estimated prices carry an inline "Estimated" badge, and a dropped stream is a toast.
 */
export function RunBanners(props: RunBannersProps) {
  const { status, threadId, result, reconnect, lastProgress } = props;
  const [keep, setKeep] = useState(false);
  const reconnecting = status === 'reconnecting' && !!reconnect;

  useEffect(() => {
    if (reconnecting) notify('info', 'Reconnecting… your plan keeps going', { id: RECONNECT_TOAST, duration: Infinity });
    else dismissNotice(RECONNECT_TOAST);
    return () => dismissNotice(RECONNECT_TOAST);
  }, [reconnecting]);

  let banner: ReactNode = null;

  if (status === 'failed' && threadId) {
    const point = stopPoint(lastProgress);
    banner = (
      <Notice
        tone="error"
        title={point ? `Planning paused at ${point}` : 'Planning paused'}
        actions={
          <>
            <Button className={btn} onClick={props.onResume}>
              <RotateCcwIcon aria-hidden="true" /> Resume
            </Button>
            <Button variant="outline" className={outlineBtn} onClick={props.onStartOver}>
              Start over
            </Button>
          </>
        }
      >
        Your progress is saved. Resume where the agents left off?
      </Notice>
    );
  } else if (status === 'aborted') {
    banner = (
      <Notice
        tone="info"
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
        {threadId ? 'Your progress is saved. Resume when ready.' : 'Nothing was saved.'}
      </Notice>
    );
  } else if (result?.status === 'completed' && result.suggestions && !keep) {
    const { raiseBudgetTo, tryDays } = result.suggestions;
    const over = Math.max(0, result.totalCost - result.budget);
    banner = (
      <Notice
        tone="warning"
        title={`The best we found is ${formatUsd(result.totalCost)}, ${formatUsd(over)} over`}
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
            <Button
              variant="ghost"
              className={btn}
              onClick={() => {
                setKeep(true);
                props.onKeep();
              }}
            >
              Keep it
            </Button>
          </>
        }
      >
        Raise the budget, try fewer days, or keep this plan.
      </Notice>
    );
  }

  return banner ? <div className="flex flex-col gap-3">{banner}</div> : null;
}
