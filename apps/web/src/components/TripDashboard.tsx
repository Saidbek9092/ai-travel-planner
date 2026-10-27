'use client';

import type { ResultPayload } from '@ai-travel/contracts';
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { CheckIcon, CopyIcon, InfoIcon, PlaneIcon, RotateCcwIcon, SquareIcon } from 'lucide-react';
import { AgentChat } from '@/components/AgentChat';
import { AgentTerminalLogs } from '@/components/AgentTerminalLogs';
import { BudgetSummary } from '@/components/BudgetSummary';
import { FlightHotelCards } from '@/components/FlightHotelCards';
import { ItineraryTimeline } from '@/components/ItineraryTimeline';
import { TopBar } from '@/components/TopBar';
import { TripInputForm } from '@/components/TripInputForm';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Progress, ProgressLabel, ProgressValue } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useAgentStream } from '@/hooks/useAgentStream';
import { useTripContext } from '@/hooks/useTripContext';
import { env } from '@/lib/env';
import { STATUS_LABELS } from '@/lib/labels';

const MapboxViewer = dynamic(() => import('@/components/MapboxViewer'), {
  ssr: false,
  loading: () => <Skeleton className="h-80 w-full rounded-xl" />,
});

interface TripDashboardProps {
  initialThreadId: string | null;
  initialResult: ResultPayload | null;
}

export function TripDashboard({ initialThreadId, initialResult }: TripDashboardProps) {
  const stream = useAgentStream({ threadId: initialThreadId, result: initialResult });
  const [activeDay, setActiveDay] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const { status, progress, result, logs, messages, decisions, draft, error } = stream;
  const destination = draft.destination ?? result?.destination ?? null;
  const origin = draft.origin ?? result?.origin ?? null;
  const tripContext = useTripContext(destination, origin);
  const uiOnly = env.agentUrl === null;
  const running = status === 'connecting' || status === 'streaming';
  const percent = status === 'completed' ? 100 : (progress?.progressPercent ?? 0);
  const label = progress ? STATUS_LABELS[progress.currentStatus] : STATUS_LABELS.parsing;

  // Hands focus to the result once a run the user started finishes, so keyboard and screen-reader users land on it.
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousStatus = useRef(status);
  useEffect(() => {
    if (previousStatus.current === 'streaming' && status === 'completed') resultHeadingRef.current?.focus();
    previousStatus.current = status;
  }, [status]);

  const unfinished = stream.threadId !== null && status === 'idle' && !result;
  const copyThreadId = async () => {
    if (!stream.threadId) return;
    try {
      await navigator.clipboard.writeText(stream.threadId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked; the id stays visible to copy by hand.
    }
  };

  return (
    <main className="mx-auto grid w-full max-w-7xl flex-1 gap-6 p-4 sm:p-6 lg:grid-cols-12">
      <div className="flex flex-col gap-4 lg:col-span-12 empty:hidden">
        <TopBar
          status={tripContext.status}
          data={tripContext.data}
          startDate={draft.startDate ?? result?.startDate ?? null}
          durationDays={draft.durationDays ?? result?.durationDays ?? null}
          origin={origin}
        />
      </div>

      <div className="flex flex-col gap-4 lg:col-span-5">
        {uiOnly && (
          <Alert>
            <InfoIcon aria-hidden="true" />
            <AlertTitle>Preview</AlertTitle>
            <AlertDescription>The planning agent isn&apos;t connected yet.</AlertDescription>
          </Alert>
        )}

        <TripInputForm
          disabled={running || uiOnly}
          onSubmit={(request) => {
            setActiveDay(null);
            stream.start(request);
          }}
        />

        {(running || status === 'completed') && (
          <Progress value={percent} aria-label="Planning progress">
            <ProgressLabel>
              {label}
              {progress?.detail && <span className="text-muted-foreground"> · {progress.detail}</span>}
            </ProgressLabel>
            <ProgressValue />
          </Progress>
        )}

        {running && (
          <Button variant="destructive" className="self-start" onClick={stream.cancel}>
            <SquareIcon aria-hidden="true" /> Cancel
          </Button>
        )}

        {status === 'aborted' && (
          <Alert>
            <AlertTitle>Run cancelled</AlertTitle>
          </Alert>
        )}

        {unfinished && (
          <Alert>
            <AlertTitle>This trip didn&apos;t finish</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-2">
              Pick up where the agents left off.
              <Button size="sm" variant="outline" onClick={stream.resume}>
                <RotateCcwIcon aria-hidden="true" /> Resume
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertTitle>{stream.threadId ? STATUS_LABELS.failed : "Couldn't start the trip"}</AlertTitle>
            <AlertDescription className="flex flex-col gap-2">
              <span>{error}</span>
              {stream.threadId && (
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-xs">
                    Trip ID: <code className="font-mono">{stream.threadId}</code>
                  </span>
                  <Button size="xs" variant="ghost" onClick={copyThreadId}>
                    {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                </span>
              )}
              {stream.threadId && status === 'failed' && (
                <Button size="sm" variant="outline" className="self-start" onClick={stream.resume}>
                  <RotateCcwIcon aria-hidden="true" /> Resume
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}

        {(messages.length > 0 || running) && (
          <AgentChat
            messages={messages}
            status={status}
            decisionCount={Object.keys(decisions).length}
            detail={progress?.detail}
          />
        )}

        {(logs.length > 0 || running) && (
          <details open={process.env.NODE_ENV !== 'production'} className="group">
            <summary className="cursor-pointer rounded text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring">
              Technical log <span className="font-normal text-muted-foreground">· {logs.length} entries</span>
            </summary>
            <div className="mt-2">
              <AgentTerminalLogs logs={logs} status={status} />
            </div>
          </details>
        )}
      </div>

      <div className="flex flex-col gap-6 lg:col-span-7" aria-live="polite">
        {status === 'idle' && !result && (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-12 text-center text-muted-foreground">
            <PlaneIcon className="size-8" aria-hidden="true" />
            <p>Your trip will appear here once the agents have planned it.</p>
          </div>
        )}
        {running && !result && (
          <div className="flex flex-col gap-4" aria-label="Planning in progress">
            <Skeleton className="h-28 w-full rounded-xl" />
            <Skeleton className="h-48 w-full rounded-xl" />
            <Skeleton className="h-80 w-full rounded-xl" />
          </div>
        )}
        {result && result.status === 'completed' && (
          <>
            <div>
              <h2 ref={resultHeadingRef} tabIndex={-1} className="text-xl font-semibold outline-none">
                {result.durationDays} days in {result.destination}
              </h2>
              <p className="text-sm text-muted-foreground">
                {result.origin ? `${result.origin} → ${result.destination}` : result.destination}
                {result.replans > 0 && ` · re-planned ${result.replans === 1 ? 'once' : `${result.replans} times`} to fit your budget`}
              </p>
            </div>
            <BudgetSummary result={result} />
            <FlightHotelCards
              flights={result.flights}
              hotels={result.hotels}
              transfers={result.transfers}
              durationDays={result.durationDays}
            />
            <MapboxViewer itinerary={result.itinerary} hotel={result.hotels[0] ?? null} activeDay={activeDay} />
            <ItineraryTimeline itinerary={result.itinerary} activeDay={activeDay} onSelectDay={setActiveDay} />
          </>
        )}
      </div>
    </main>
  );
}
