'use client';

import { PlusIcon, RefreshCwIcon, ShareIcon, SquareIcon } from 'lucide-react';
import { useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { notify } from '@/components/Notice';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import type { StreamStatus } from '@/hooks/useAgentStream';
import { HEADER_ACTIONS_ID, keepTabInside } from '@/lib/dom';

const noop = () => () => undefined;
const findSlot = () => document.getElementById(HEADER_ACTIONS_ID);

/** Copies the `?trip=` link; the link reopens the finished trip. */
async function shareTrip(threadId: string) {
  const url = `${window.location.origin}/?trip=${encodeURIComponent(threadId)}`;
  try {
    await navigator.clipboard.writeText(url);
    notify('success', 'Link copied', { description: 'Anyone with the link can open this trip.' });
  } catch {
    notify('error', "Couldn't copy the link", { description: url });
  }
}

interface TripActionsProps {
  status: StreamStatus;
  threadId: string | null;
  canReplan: boolean;
  onStop: () => void;
  onReplan: () => void;
  onNewTrip: () => void;
}

/** Header actions: "Stop planning" while a run is live; "New trip", "Re-plan" and "Share trip" on a finished trip. */
export function TripActions({ status, threadId, canReplan, onStop, onReplan, onNewTrip }: TripActionsProps) {
  const slot = useSyncExternalStore(noop, findSlot, () => null);
  const [confirming, setConfirming] = useState(false);
  const keepRef = useRef<HTMLButtonElement>(null);
  if (!slot) return null;
  const live = status === 'connecting' || status === 'streaming' || status === 'reconnecting';
  const finished = status === 'completed' && threadId !== null;
  const size = 'h-10 px-3.5 text-[15px] pointer-coarse:h-11 max-sm:min-w-11';
  return createPortal(
    <>
      {live && (
        <Button variant="outline" className={`${size} bg-card`} onClick={onStop} title="Stop planning">
          <SquareIcon aria-hidden="true" className="size-3.5" /> <span className="max-sm:sr-only">Stop planning</span>
        </Button>
      )}
      {finished && (
        // Hidden on phones, where the "Plan a trip" tab beside it does the same and the header has no room.
        <Button variant="outline" className={`${size} bg-card max-sm:hidden`} onClick={onNewTrip} title="Plan a new trip">
          <PlusIcon aria-hidden="true" /> <span className="max-sm:sr-only">New trip</span>
        </Button>
      )}
      {finished && canReplan && (
        <Button variant="outline" className={`${size} bg-card`} onClick={() => setConfirming(true)} title="Re-plan">
          <RefreshCwIcon aria-hidden="true" /> <span className="max-sm:sr-only">Re-plan</span>
        </Button>
      )}
      {finished && (
        <Button className={size} onClick={() => void shareTrip(threadId)} title="Share trip">
          <ShareIcon aria-hidden="true" /> <span className="max-sm:sr-only">Share trip</span>
        </Button>
      )}
      <Dialog open={confirming && finished} onOpenChange={setConfirming}>
        <DialogContent initialFocus={keepRef} onKeyDown={keepTabInside}>
          <DialogTitle>Plan this trip again?</DialogTitle>
          <DialogDescription>The planner opens with this trip&apos;s details filled in. Change anything you like, then press Plan. This trip stays in My trips.</DialogDescription>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setConfirming(false);
                onReplan();
              }}
            >
              Edit and re-plan
            </Button>
            <Button ref={keepRef} onClick={() => setConfirming(false)}>
              Keep this trip
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>,
    slot,
  );
}
