'use client';

import type { ResultPayload, TripRequest } from '@ai-travel/contracts';
import { RotateCcwIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AgentBoard } from '@/components/AgentBoard';
import { AgentChat, ChatSummary } from '@/components/AgentChat';
import { AgentTerminalLogs } from '@/components/AgentTerminalLogs';
import { RunBanners } from '@/components/RunBanners';
import { RunDetails } from '@/components/RunDetails';
import { RunProgress } from '@/components/RunProgress';
import { TopBar } from '@/components/TopBar';
import { TripActions } from '@/components/TripActions';
import { HowItWorks, PickUp, StartHero } from '@/components/StartExtras';
import { TripInputForm } from '@/components/TripInputForm';
import type { DaySelection } from '@/components/ItineraryTimeline';
import { FinishedOverview, LiveOverview } from '@/components/TripOverview';
import { Notice } from '@/components/Notice';
import { Button } from '@/components/ui/button';
import { useAgentStream } from '@/hooks/useAgentStream';
import { useTripContext } from '@/hooks/useTripContext';
import { useTripHistory } from '@/hooks/useTripHistory';
import { NEW_TRIP_EVENT } from '@/lib/dom';
import { env } from '@/lib/env';
import { agentRows, briefLine, decisionSummaries, defaultDay, phaseStates, requestFromResult, timesWord, tripTitle, type TripView } from '@/lib/trip';
import { PassesTable, budgetVerdict } from '@/components/BudgetMeter';

interface TripDashboardProps {
  initialThreadId: string | null;
  initialResult: ResultPayload | null;
}

export function TripDashboard({ initialThreadId, initialResult }: TripDashboardProps) {
  const stream = useAgentStream({ threadId: initialThreadId, result: initialResult });
  // `null` = not chosen yet: Day 1, or today's day if the trip is under way. The choice lives in the URL (`?day=2`, `?day=all`).
  const [chosenDay, setChosenDay] = useState<DaySelection | null>(null);
  const setActiveDay = useCallback((day: DaySelection | null) => {
    setChosenDay(day);
    const url = new URL(window.location.href);
    if (day === null) url.searchParams.delete('day');
    else url.searchParams.set('day', String(day));
    window.history.replaceState(window.history.state, '', url);
  }, []);
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get('day');
    const n = Number(raw);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the URL is only readable after hydration
    if (raw === 'all') setChosenDay('all');
    else if (Number.isInteger(n) && n >= 1) setChosenDay(n);
  }, []);
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
  const hasRun = logs.length > 0 || messages.length > 0 || !!draft.destination;
  // A fresh run keeps the (disabled) form until the stream opens, so a 400/429 leaves the prompt in place.
  const view: 'idle' | 'live' | 'finished' = finished ? 'finished' : hasRun || (live && status !== 'connecting') ? 'live' : 'idle';
  const overBudget = (finished ? result.totalCost > result.budget : (draft.totalCost ?? 0) > (draft.budget ?? Infinity)) && !!decisions.budget;

  const itinerary = trip.itinerary ?? [];
  const selectedDay: DaySelection =
    chosenDay === 'all' || (chosenDay !== null && itinerary.some((d) => d.day === chosenDay))
      ? chosenDay
      : defaultDay(itinerary, new Date().toISOString().slice(0, 10));

  const start = (request: TripRequest) => {
    setActiveDay(null);
    stream.start(request);
  };
  const replanRequest = lastRequest ?? (result ? requestFromResult(result, new Date().toISOString().slice(0, 10)) : null);
  const startOver = () => (replanRequest ? start(replanRequest) : stream.reset());

  // Switching between the form, the live run and the result starts at the top of the page, not where the last view was scrolled to.
  const previousView = useRef(view);
  useEffect(() => {
    if (previousView.current !== view) window.scrollTo({ top: 0 });
    previousView.current = view;
  }, [view]);

  // "Plan a trip" in the header resets an open dashboard to the form.
  const { reset } = stream;
  useEffect(() => {
    const onNewTrip = () => {
      reset();
      setActiveDay(null);
    };
    window.addEventListener(NEW_TRIP_EVENT, onNewTrip);
    return () => window.removeEventListener(NEW_TRIP_EVENT, onNewTrip);
  }, [reset, setActiveDay]);

  // A started run is remembered as paused until it finishes, so the start page can offer Resume.
  useEffect(() => {
    if (!threadId || finished || !lastRequest) return;
    if (!history.trips.some((t) => t.threadId === threadId)) {
      history.add({ threadId, title: tripTitle({ ...draft }), createdAt: Date.now(), status: 'paused' });
    }
  }, [threadId, finished, lastRequest, history, draft]);

  // When a run the user watched finishes: focus the result, toast, and remember it in "My trips".
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousStatus = useRef(status);
  const { add } = history;
  useEffect(() => {
    const wasLive = previousStatus.current === 'streaming' || previousStatus.current === 'reconnecting';
    previousStatus.current = status;
    if (!wasLive || status !== 'completed' || !result) return;
    resultHeadingRef.current?.focus();
    add({ threadId: result.threadId, title: tripTitle(result), createdAt: Date.now(), status: 'done' });
    if (!result.suggestions) {
      const verdict = budgetVerdict(result.totalCost, result.budget);
      toast.success(`Trip ready · ${verdict.text}`, {
        description: result.replans > 0 ? `Re-planned ${timesWord(result.replans)} to fit your budget.` : 'Every decision is confirmed.',
      });
    }
  }, [status, result, add]);

  // LOG packets always stream (the chat is built from them); in development they also print to the console.
  const printed = useRef(0);
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    if (logs.length < printed.current) printed.current = 0;
    for (const log of logs.slice(printed.current)) console.debug('[agent log]', log);
    printed.current = logs.length;
  }, [logs]);

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
      result={result}
      reconnect={stream.reconnect}
      lastProgress={progress}
      onResume={stream.resume}
      onStartOver={startOver}
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
      {view === 'idle' && <StartHero />}
      <main className="mx-auto flex w-full max-w-[1360px] flex-1 flex-col gap-5 px-4 pt-6 pb-12 sm:px-8 [@media(min-width:1024px)_and_(max-height:880px)]:pt-2 [@media(min-width:1024px)_and_(max-height:880px)]:pb-3">
        {view === 'idle' && (
          <div className="-mt-20">
            <TripInputForm
              disabled={live || uiOnly}
              retryAt={stream.retryAt}
              onSubmit={start}
              notices={
                <>
                  {uiOnly && (
                    <Notice tone="info" placement="inline" title="Preview">
                      The planning agent isn&apos;t connected yet.
                    </Notice>
                  )}
                  {unfinished && (
                    <Notice
                      tone="info"
                      placement="inline"
                      title="This trip didn't finish"
                      actions={
                        <Button size="sm" variant="outline" onClick={stream.resume}>
                          <RotateCcwIcon aria-hidden="true" /> Resume
                        </Button>
                      }
                    >
                      Pick up where the agents left off.
                    </Notice>
                  )}
                  {error && !threadId && !stream.retryAt && (
                    <Notice tone="error" placement="inline" title="Couldn't start the trip">
                      {error}
                    </Notice>
                  )}
                </>
              }
              aside={<PickUp disabled={live || uiOnly} onResume={stream.resumeTrip} />}
              footer={<HowItWorks embedded />}
            />
          </div>
        )}

        {view === 'live' && (
          <>
            {banners}
            <RunProgress status={status} progress={progress} phases={phases} startedAt={stream.startedAt} brief={briefLine(draft)} />
            <div className={`grid gap-5 lg:grid-cols-12 lg:items-start ${live ? '' : 'opacity-60'}`}>
              <div className="flex flex-col lg:sticky lg:top-20 lg:col-span-7 lg:h-[calc(100dvh-11rem)] lg:min-h-[480px]">
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
              <div className="min-w-0 lg:col-span-5">
                <LiveOverview trip={trip} decisions={decisions} progress={progress} selectedDay={selectedDay} onSelectDay={setActiveDay} />
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
              selectedDay={selectedDay}
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
