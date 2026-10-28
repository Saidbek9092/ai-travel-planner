'use client';

import type { ResultPayload, TripRequest } from '@ai-travel/contracts';
import { InfoIcon, RotateCcwIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AgentBoard } from '@/components/AgentBoard';
import { AgentChat, ChatSummary } from '@/components/AgentChat';
import { AgentTerminalLogs } from '@/components/AgentTerminalLogs';
import { RunBanners } from '@/components/RunBanners';
import { RunDetails } from '@/components/RunDetails';
import { RunProgress } from '@/components/RunProgress';
import { TopBar } from '@/components/TopBar';
import { TripActions } from '@/components/TripActions';
import { TripInputForm } from '@/components/TripInputForm';
import { FinishedOverview, LiveOverview } from '@/components/TripOverview';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useAgentStream } from '@/hooks/useAgentStream';
import { useTripContext } from '@/hooks/useTripContext';
import { useTripHistory } from '@/hooks/useTripHistory';
import { NEW_TRIP_EVENT } from '@/lib/dom';
import { env } from '@/lib/env';
import { agentRows, briefLine, decisionSummaries, phaseStates, requestFromResult, timesWord, tripTitle, type TripView } from '@/lib/trip';
import { PassesTable, budgetVerdict } from '@/components/BudgetMeter';

interface TripDashboardProps {
  initialThreadId: string | null;
  initialResult: ResultPayload | null;
}

export function TripDashboard({ initialThreadId, initialResult }: TripDashboardProps) {
  const stream = useAgentStream({ threadId: initialThreadId, result: initialResult });
  const [activeDay, setActiveDay] = useState<number | null>(null);
  const history = useTripHistory();
  const { status, progress, result, logs, messages, decisions, draft, error, threadId, lastRequest } = stream;
  const uiOnly = env.agentUrl === null;
  const live = status === 'connecting' || status === 'streaming' || status === 'reconnecting';
  const finished = result?.status === 'completed';

  // The Trip Overview reads the result when it is in, the draft before that.
  const trip: TripView = finished ? result : draft;
  const destination = draft.destination ?? result?.destination ?? null;
  const origin = draft.origin ?? result?.origin ?? null;
  const tripContext = useTripContext(destination || null, origin);
  const rows = useMemo(() => agentRows(logs, stream.passStart, progress, status), [logs, stream.passStart, progress, status]);
  const phases = useMemo(() => phaseStates(decisions, trip, progress, finished), [decisions, trip, progress, finished]);
  const estimates = [...(trip.flights ?? []), ...(trip.hotels ?? [])].some((o) => o.source === 'mock');
  const hasRun = logs.length > 0 || messages.length > 0 || !!draft.destination;
  // A fresh run keeps the (disabled) form until the stream opens, so a 400/429 leaves the prompt in place.
  const view: 'idle' | 'live' | 'finished' = finished ? 'finished' : hasRun || (live && status !== 'connecting') ? 'live' : 'idle';
  const overBudget = (finished ? result.totalCost > result.budget : (draft.totalCost ?? 0) > (draft.budget ?? Infinity)) && !!decisions.budget;

  const start = (request: TripRequest) => {
    setActiveDay(null);
    stream.start(request);
  };
  const replanRequest = lastRequest ?? (result ? requestFromResult(result, new Date().toISOString().slice(0, 10)) : null);
  const startOver = () => (replanRequest ? start(replanRequest) : stream.reset());

  // "Plan a trip" in the header resets an open dashboard to the form.
  const { reset } = stream;
  useEffect(() => {
    const onNewTrip = () => {
      reset();
      setActiveDay(null);
    };
    window.addEventListener(NEW_TRIP_EVENT, onNewTrip);
    return () => window.removeEventListener(NEW_TRIP_EVENT, onNewTrip);
  }, [reset]);

  // When a run the user watched finishes: focus the result, toast, and remember it in "My trips".
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousStatus = useRef(status);
  const { add } = history;
  useEffect(() => {
    const wasLive = previousStatus.current === 'streaming' || previousStatus.current === 'reconnecting';
    previousStatus.current = status;
    if (!wasLive || status !== 'completed' || !result) return;
    resultHeadingRef.current?.focus();
    add({ threadId: result.threadId, title: tripTitle(result), createdAt: Date.now() });
    if (!result.suggestions) {
      const verdict = budgetVerdict(result.totalCost, result.budget);
      toast.success(`Trip ready · ${verdict.text}`, {
        description: result.replans > 0 ? `Re-planned ${timesWord(result.replans)} to fit your budget.` : 'Every decision is confirmed.',
      });
    }
  }, [status, result, add]);

  const technical = (
    <div className="flex flex-col gap-4">
      <AgentBoard rows={rows} progress={progress} />
      {!uiOnly && <RunDetails threadId={threadId} progress={progress} replans={result?.replans ?? Math.max(0, (progress?.pass ?? 1) - 1)} />}
      {result && result.passes.length > 1 && <PassesTable passes={result.passes} />}
      <AgentTerminalLogs logs={logs} status={status} />
    </div>
  );

  const banners = (
    <RunBanners
      status={status}
      threadId={threadId}
      logs={logs}
      result={result}
      error={error}
      reconnect={stream.reconnect}
      lastProgress={progress}
      estimates={estimates}
      onResume={stream.resume}
      onStartOver={startOver}
      onReconnect={stream.reconnectNow}
      onRaiseBudget={(budget) => replanRequest && start({ ...replanRequest, budget })}
      onTryDays={(durationDays) => replanRequest && start({ ...replanRequest, durationDays })}
    />
  );

  const unfinished = threadId !== null && status === 'idle' && !result;

  return (
    <>
      <TripActions status={status} threadId={threadId} canReplan={replanRequest !== null} onStop={stream.cancel} onReplan={startOver} />
      <TopBar
        status={tripContext.status}
        data={tripContext.data}
        startDate={draft.startDate ?? result?.startDate ?? null}
        durationDays={draft.durationDays ?? result?.durationDays ?? null}
        origin={origin}
      />
      <main className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-6 px-4 pt-6 pb-12 sm:px-6 lg:px-[72px]">
        {view === 'idle' && (
          <div className="grid gap-6 lg:grid-cols-12 lg:items-start">
            <section aria-labelledby="plan-title" className="flex flex-col gap-4 rounded-xl border bg-card p-5 sm:p-6 lg:col-span-5">
              <div>
                <h1 id="plan-title" className="text-xl font-semibold">
                  Plan a trip
                </h1>
                <p className="text-sm text-ink-2">One sentence is enough. Five agents search, plan and check the budget while you watch.</p>
              </div>
              {uiOnly && (
                <Alert>
                  <InfoIcon aria-hidden="true" />
                  <AlertTitle>Preview</AlertTitle>
                  <AlertDescription>The planning agent isn&apos;t connected yet.</AlertDescription>
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
              {error && !threadId && (
                <Alert variant="destructive">
                  <AlertTitle>Couldn&apos;t start the trip</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <TripInputForm disabled={live || uiOnly} retryAt={stream.retryAt} onSubmit={start} />
            </section>
            <div className="lg:col-span-7">
              <LiveOverview trip={draft} decisions={decisions} progress={progress} activeDay={activeDay} onSelectDay={setActiveDay} />
            </div>
          </div>
        )}

        {view === 'live' && (
          <>
            {banners}
            <RunProgress status={status} progress={progress} phases={phases} startedAt={stream.startedAt} brief={briefLine(draft)} />
            <div className={`grid gap-5 lg:grid-cols-[minmax(0,749fr)_minmax(0,525fr)] lg:items-start ${live ? '' : 'opacity-60'}`}>
              <div className="flex flex-col gap-6">
                <AgentChat
                  messages={messages}
                  status={status}
                  decisionCount={Object.keys(decisions).length}
                  progress={progress}
                  agents={rows}
                  technical={technical}
                  overBudget={overBudget}
                />
              </div>
              <div>
                <LiveOverview trip={trip} decisions={decisions} progress={progress} activeDay={activeDay} onSelectDay={setActiveDay} />
              </div>
            </div>
          </>
        )}

        {view === 'finished' && result && (
          <>
            {banners}
            <FinishedOverview
              result={result}
              decisions={decisions}
              activeDay={activeDay}
              onSelectDay={setActiveDay}
              headingRef={resultHeadingRef}
              chat={
                <ChatSummary
                  messages={messages}
                  status={status}
                  decisions={decisionSummaries(result)}
                  progress={progress}
                  technical={technical}
                  overBudget={result.totalCost > result.budget}
                />
              }
            />
          </>
        )}
      </main>
    </>
  );
}
