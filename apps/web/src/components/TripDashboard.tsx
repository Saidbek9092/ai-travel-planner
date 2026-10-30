'use client';

import type { MessagePayload, ResultPayload, TripRequest } from '@ai-travel/contracts';
import { RotateCcwIcon } from 'lucide-react';
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { AgentBoard } from '@/components/AgentBoard';
import { AgentChat, ChatSummary } from '@/components/AgentChat';
import { AgentTerminalLogs } from '@/components/AgentTerminalLogs';
import { RunBanners } from '@/components/RunBanners';
import { RunDetails } from '@/components/RunDetails';
import { RunProgress } from '@/components/RunProgress';
import { TopBar } from '@/components/TopBar';
import { TripActions } from '@/components/TripActions';
import { HowItWorks, StartHero } from '@/components/StartExtras';
import { TripInputForm } from '@/components/TripInputForm';
import type { DaySelection } from '@/components/ItineraryTimeline';
import { FinishedOverview, LiveOverview } from '@/components/TripOverview';
import { Notice, notify } from '@/components/Notice';
import { SignInDialog } from '@/components/SignInDialog';
import { Button } from '@/components/ui/button';
import { useAgentStream } from '@/hooks/useAgentStream';
import { useSession } from '@/hooks/useSession';
import { useTripContext } from '@/hooks/useTripContext';
import { useTripHistory } from '@/hooks/useTripHistory';
import { useUsage } from '@/hooks/useUsage';
import { MAIN_ID, NEW_TRIP_EVENT } from '@/lib/dom';
import { env } from '@/lib/env';
import { clearPendingTrip, savePendingTrip, takePendingTrip } from '@/lib/pendingTrip';
import { agentRows, briefLine, decisionSummaries, defaultDay, phaseStates, requestFromResult, timesWord, tripTitle, type TripView } from '@/lib/trip';
import { PassesTable, budgetVerdict } from '@/components/BudgetMeter';

interface TripDashboardProps {
  initialThreadId: string | null;
  initialResult: ResultPayload | null;
  /** The stored chat of a reopened trip. */
  initialMessages?: MessagePayload[];
  /** What the server found for `?trip=`: `null` without one, `unavailable` when the agent didn't answer. */
  tripLookup?: 'found' | 'not-found' | 'unavailable' | null;
  /** Told which trip the dashboard shows now (`null` = the start form), so a trip link for another one can reload it. */
  onThreadChange?: (threadId: string | null) => void;
}

export function TripDashboard({ initialThreadId, initialResult, initialMessages = [], tripLookup = null, onThreadChange }: TripDashboardProps) {
  const stream = useAgentStream({ threadId: initialThreadId, result: initialResult, messages: initialMessages });
  const shownThreadId = stream.threadId;
  const reportThread = useEffectEvent((id: string | null) => onThreadChange?.(id));
  useEffect(() => reportThread(shownThreadId), [shownThreadId]);
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

  // Every run costs money, so a guest is asked to sign in first (the agent refuses guests too). The request waits in
  // `pending` and starts by itself once they are signed in; the typed trip stays in the form meanwhile.
  const session = useSession();
  const needsSignIn = env.agentUrl !== null && env.googleClientId !== null && !session;
  // Asked again when the account changes and when a run starts or ends: the plan is counted as the run starts.
  const usage = useUsage(!uiOnly && !needsSignIn, `${session?.user.id ?? ''}:${live}`);
  const [pending, setPending] = useState<{ kind: 'start'; request: TripRequest } | { kind: 'resume' } | null>(null);
  const run = (action: NonNullable<typeof pending>) => {
    if (action.kind === 'start') {
      setActiveDay(null);
      stream.start(action.request);
    } else stream.resume();
  };
  const runNow = useEffectEvent(run);
  useEffect(() => {
    if (!session) return;
    // The person just signed in: run the request that was waiting (in memory, or saved before Google sent the phone away), then release it.
    const saved = takePendingTrip();
    const waiting = pending ?? (saved ? ({ kind: 'start', request: saved } as const) : null);
    if (!waiting) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- `run` sets state through the stream hook
    runNow(waiting);
    setPending(null);
  }, [session, pending]);
  const request = (action: NonNullable<typeof pending>) => {
    if (!needsSignIn) return run(action);
    if (action.kind === 'start') savePendingTrip(action.request);
    setPending(action);
  };
  const start = (tripRequest: TripRequest) => request({ kind: 'start', request: tripRequest });
  const resume = () => request({ kind: 'resume' });
  const replanRequest = lastRequest ?? (result ? requestFromResult(result, new Date().toISOString().slice(0, 10)) : null);
  const startOver = () => (replanRequest ? start(replanRequest) : stream.reset());
  // Re-plan opens the form filled with this trip's details; nothing starts until the person presses Plan.
  const [prefill, setPrefill] = useState<TripRequest | null>(null);
  const [formKey, setFormKey] = useState(0);
  const openForm = (request: TripRequest | null) => {
    setPrefill(request);
    setFormKey((key) => key + 1);
    stream.reset();
    setActiveDay(null);
  };

  // The tab title names the trip, so history, tabs and screen readers can tell trips apart.
  const pageTitle = view === 'finished' && result ? tripTitle(result) : view === 'live' ? (live ? 'Planning your trip' : 'Planning stopped') : null;
  useEffect(() => {
    document.title = pageTitle ? `${pageTitle} · AI Travel Planner` : 'AI Travel Planner';
  }, [pageTitle]);

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
      setPrefill(null);
    };
    window.addEventListener(NEW_TRIP_EVENT, onNewTrip);
    return () => window.removeEventListener(NEW_TRIP_EVENT, onNewTrip);
  }, [reset, setActiveDay]);

  // A started run is remembered as paused until it finishes, so the start page can offer Resume.
  useEffect(() => {
    if (!threadId || finished || !lastRequest) return;
    // Added as "Your trip" when the run starts; named once the Supervisor has read the destination.
    const title = tripTitle({ ...draft });
    const known = history.trips.find((t) => t.threadId === threadId);
    if (!known || known.title !== title) {
      history.add({ threadId, title, createdAt: known?.createdAt ?? Date.now(), status: 'paused' });
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
      notify('success', `Trip ready · ${verdict.text}`, {
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
      onResume={resume}
      onStartOver={startOver}
      onRaiseBudget={(budget) => replanRequest && start({ ...replanRequest, budget })}
      onTryDays={(durationDays) => replanRequest && start({ ...replanRequest, durationDays })}
      onKeep={() => resultHeadingRef.current?.focus()}
    />
  );

  // A trip opened by link that the start page can't show: a stored unfinished one (`failed` result) can be resumed, an id
  // the agent doesn't know says so, and no answer from the agent offers to load it again. (A failed Resume has no result.)
  const linkNotice =
    threadId === null || finished || uiOnly
      ? null
      : status === 'failed' && result
        ? 'unfinished'
        : status === 'idle' && !result
          ? tripLookup === 'not-found'
            ? 'not-found'
            : 'unavailable'
          : null;

  return (
    <>
      {env.googleClientId !== null && <SignInDialog open={pending !== null && !session} onOpenChange={(open) => {
          if (open) return;
          clearPendingTrip();
          setPending(null);
        }} clientId={env.googleClientId} />}
      <TripActions status={status} threadId={threadId} canReplan={replanRequest !== null} onStop={stream.cancel} onReplan={() => openForm(replanRequest)} onNewTrip={() => openForm(null)} />
      <TopBar
        status={tripContext.status}
        data={tripContext.data}
        startDate={draft.startDate ?? result?.startDate ?? null}
        durationDays={draft.durationDays ?? result?.durationDays ?? null}
        origin={origin}
      />
      {view === 'idle' && <StartHero />}
      <main id={MAIN_ID} tabIndex={-1} className="mx-auto flex w-full max-w-[1360px] flex-1 flex-col gap-5 px-4 pt-6 pb-12 outline-none sm:px-8 [@media(min-width:1024px)_and_(max-height:980px)]:pt-2 [@media(min-width:1024px)_and_(max-height:980px)]:pb-3">
        {view === 'idle' && (
          <div className="-mt-20">
            <TripInputForm
              key={formKey}
              initialRequest={prefill}
              disabled={live || uiOnly}
              retryAt={stream.retryAt}
              usage={usage}
              onSubmit={start}
              notices={
                <>
                  {uiOnly && (
                    <Notice tone="info" placement="inline" title="Preview">
                      The planning agent isn&apos;t connected yet.
                    </Notice>
                  )}
                  {linkNotice === 'unfinished' && (
                    <Notice
                      tone="info"
                      placement="inline"
                      title="This trip didn't finish"
                      actions={
                        <Button variant="outline" className="h-9 bg-card pointer-coarse:h-11" onClick={resume}>
                          <RotateCcwIcon aria-hidden="true" /> Resume
                        </Button>
                      }
                    >
                      Pick up where the agents left off.
                    </Notice>
                  )}
                  {linkNotice === 'not-found' && (
                    <Notice tone="warning" placement="inline" title="We couldn't find this trip">
                      The link may be incomplete, or the trip is no longer saved. Plan a new one below.
                    </Notice>
                  )}
                  {linkNotice === 'unavailable' && (
                    <Notice
                      tone="error"
                      placement="inline"
                      title="This trip didn't load"
                      actions={
                        <Button variant="outline" className="h-9 bg-card pointer-coarse:h-11" onClick={() => window.location.reload()}>
                          <RotateCcwIcon aria-hidden="true" /> Try again
                        </Button>
                      }
                    >
                      The planning agent didn&apos;t answer. Check your connection and try again.
                    </Notice>
                  )}
                  {/* A failed start, or a failed Resume of a trip opened from a link (the trip then has a thread id). */}
                  {error && status === 'failed' && !result && !stream.retryAt && (
                    <Notice tone="error" placement="inline" title={threadId ? "Couldn't resume this trip" : "Couldn't start the trip"}>
                      {error}
                    </Notice>
                  )}
                </>
              }
              footer={<HowItWorks embedded />}
            />
          </div>
        )}

        {view === 'live' && (
          <>
            {banners}
            <RunProgress status={status} progress={progress} phases={phases} startedAt={stream.startedAt} brief={briefLine(draft)} />
            <div className={`grid gap-5 lg:grid-cols-12 lg:items-start ${live ? '' : 'grayscale'}`}>
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
