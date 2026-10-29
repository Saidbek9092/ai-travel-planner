'use client';

import { RefreshCwIcon, ShareIcon, SquareIcon } from 'lucide-react';
import { useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import type { StreamStatus } from '@/hooks/useAgentStream';
import { HEADER_ACTIONS_ID } from '@/lib/dom';

const noop = () => () => undefined;
const findSlot = () => document.getElementById(HEADER_ACTIONS_ID);

/** Copies the `?trip=` link; the link reopens the finished trip. */
export async function shareTrip(threadId: string) {
  const url = `${window.location.origin}/?trip=${encodeURIComponent(threadId)}`;
  try {
    await navigator.clipboard.writeText(url);
    toast.success('Link copied', { description: 'Anyone with the link can open this trip.' });
  } catch {
    toast.error("Couldn't copy the link", { description: url });
  }
}

interface TripActionsProps {
  status: StreamStatus;
  threadId: string | null;
  canReplan: boolean;
  onStop: () => void;
  onReplan: () => void;
}

/** Header actions: "Stop planning" while a run is live; "Re-plan" and "Share trip" on a finished trip. */
export function TripActions({ status, threadId, canReplan, onStop, onReplan }: TripActionsProps) {
  const slot = useSyncExternalStore(noop, findSlot, () => null);
  const [confirming, setConfirming] = useState(false);
  const keepRef = useRef<HTMLButtonElement>(null);
  if (!slot) return null;
  const live = status === 'connecting' || status === 'streaming' || status === 'reconnecting';
  const finished = status === 'completed' && threadId !== null;
  const size = 'h-10 px-3.5 text-[15px]';
  return createPortal(
    <>
      {live && (
        <Button variant="outline" className={`${size} bg-card`} onClick={onStop}>
          <SquareIcon aria-hidden="true" className="size-3.5" /> <span className="max-sm:sr-only">Stop planning</span>
        </Button>
      )}
      {finished && canReplan && (
        <Button variant="outline" className={`${size} bg-card`} onClick={() => setConfirming(true)}>
          <RefreshCwIcon aria-hidden="true" /> <span className="max-sm:sr-only">Re-plan</span>
        </Button>
      )}
      {finished && (
        <Button className={size} onClick={() => void shareTrip(threadId)}>
          <ShareIcon aria-hidden="true" /> <span className="max-sm:sr-only">Share trip</span>
        </Button>
      )}
      <Dialog open={confirming && finished} onOpenChange={setConfirming}>
        <DialogContent initialFocus={keepRef}>
          <DialogTitle>Plan this trip again?</DialogTitle>
          <DialogDescription>Your current trip will be replaced. Your start details stay the same.</DialogDescription>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setConfirming(false);
                onReplan();
              }}
            >
              Re-plan
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
