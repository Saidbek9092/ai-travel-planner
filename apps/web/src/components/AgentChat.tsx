'use client';

import type { AgentName, DecisionTopic, MessagePayload, ProgressPayload } from '@ai-travel/contracts';
import { AlertTriangleIcon, ArrowDownIcon, CircleCheckIcon, CloudDrizzleIcon, InfoIcon, MessageSquareIcon, TerminalIcon } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Fragment, useState, type ReactNode } from 'react';
import { AgentAvatar } from '@/components/AgentAvatar';
import { Button } from '@/components/ui/button';
import type { StreamStatus } from '@/hooks/useAgentStream';
import { useStickToBottom } from '@/hooks/useStickToBottom';
import { env } from '@/lib/env';
import { STATUS_AGENTS, agentDisplayNames, decisionChipLabel, decisionLabels } from '@/lib/labels';
import { draftingDay, type AgentRow } from '@/lib/trip';
import { cn } from '@/lib/utils';

const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const MENTION = new RegExp(`(@(?:${Object.values(agentDisplayNames).join('|')}))`, 'g');

/** Highlights `@Name` tokens (agent display names). */
function MessageText({ text }: { text: string }) {
  return (
    <>
      {text.split(MENTION).map((part, i) =>
        part.startsWith('@') ? (
          <span key={i} className="font-medium text-primary">
            {part}
          </span>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

/** `"Weather prep · Day 3 moved indoors"` → bold head, plain tail. */
function LabelParts({ label }: { label: string }) {
  const [head, ...rest] = label.split(' · ');
  return (
    <>
      <span className="font-semibold">{head}</span>
      {rest.length > 0 && <span className="font-normal"> · {rest.join(' · ')}</span>}
    </>
  );
}

function Pill({ tone, icon, children }: { tone: 'success' | 'warn' | 'info'; icon: ReactNode; children: ReactNode }) {
  return (
    <p
      className={cn(
        'mt-2 inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1 text-[13px] leading-[18px]',
        tone === 'success' && 'border-success/25 bg-success-soft text-success',
        tone === 'warn' && 'border-live/40 bg-live-soft text-live-foreground',
        tone === 'info' && 'border-primary/20 bg-primary-soft text-primary',
      )}
    >
      <span aria-hidden="true" className="shrink-0">
        {icon}
      </span>
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** Decision chip ("Flight confirmed · TAS → IST → CDG · $420") and the callout tag. Never inferred from text. */
function MessageTags({ message, overBudget }: { message: MessagePayload; overBudget: boolean }) {
  const { decision, callout } = message;
  const warn = decision === 'budget' && overBudget;
  return (
    <>
      {decision && (
        <Pill
          tone={warn ? 'warn' : 'success'}
          icon={warn ? <AlertTriangleIcon className="size-4" /> : <CircleCheckIcon className="size-4 fill-success text-success-soft" />}
        >
          <span className="font-semibold">{decisionChipLabel(decision, overBudget)}</span>
          {callout?.tone === 'info' && <span> · {callout.label}</span>}
        </Pill>
      )}
      {callout && !(decision && callout.tone === 'info') && (
        <Pill
          tone={callout.tone}
          icon={
            callout.tone === 'warn' ? (
              <AlertTriangleIcon className="size-4" />
            ) : /weather/i.test(callout.label) ? (
              <CloudDrizzleIcon className="size-4" />
            ) : (
              <InfoIcon className="size-4" />
            )
          }
        >
          <LabelParts label={callout.label} />
        </Pill>
      )}
    </>
  );
}

function MessageItem({ message, grouped, animate, overBudget }: { message: MessagePayload; grouped: boolean; animate: boolean; overBudget: boolean }) {
  return (
    <motion.li
      initial={animate ? { opacity: 0, y: 6 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className={cn('flex gap-3', grouped ? 'mt-2' : 'mt-5 first:mt-0')}
    >
      {grouped ? <span className="w-9 shrink-0" aria-hidden="true" /> : <AgentAvatar agent={message.agent} />}
      <div className="min-w-0 flex-1">
        {grouped ? (
          <span className="sr-only">{agentDisplayNames[message.agent]}:</span>
        ) : (
          <p className="flex items-baseline gap-2 pt-1">
            <span className="text-[15px] font-semibold">{agentDisplayNames[message.agent]}</span>
            <time dateTime={message.timestamp} className="text-[13px] text-muted-foreground">
              {clock.format(new Date(message.timestamp))}
            </time>
          </p>
        )}
        <p className={cn('rounded-xl bg-muted px-4 py-3 text-[15px] leading-[22px]', !grouped && 'mt-2')}>
          <MessageText text={message.text} />
        </p>
        <MessageTags message={message} overBudget={overBudget} />
      </div>
    </motion.li>
  );
}

const WORKING: Record<ProgressPayload['currentStatus'], string> = {
  parsing: 'reading your brief',
  searching: 'searching',
  planning: 'planning',
  auditing: 'checking the budget',
  completed: 'wrapping up',
  failed: 'stopping',
};

/** "••• Itinerary Planner is drafting Day 4" while the run streams. */
function WorkingLine({ progress, animate }: { progress: ProgressPayload | null; animate: boolean }) {
  const agent: AgentName = progress ? STATUS_AGENTS[progress.currentStatus] : 'Supervisor';
  const day = draftingDay(progress?.detail);
  const doing = day !== null && progress?.currentStatus === 'planning' ? `drafting Day ${day}` : progress ? WORKING[progress.currentStatus] : 'reading your brief';
  return (
    // Inside the conversation's live region, which announces its changes.
    <li className="mt-5 flex items-center gap-3">
      <AgentAvatar agent={agent} />
      <p className="inline-flex items-center gap-3 rounded-xl bg-muted px-4 py-2.5 text-[15px] text-ink-2">
        <span className="flex gap-1" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={cn('size-1.5 rounded-full bg-ink-2', animate && 'animate-bounce')}
              style={animate ? { animationDelay: `${i * 120}ms` } : undefined}
            />
          ))}
        </span>
        {agentDisplayNames[agent]} is {doing}
      </p>
    </li>
  );
}

/** The conversation list with stick-to-bottom scrolling. */
function Feed({
  messages,
  status,
  progress,
  overBudget,
}: {
  messages: MessagePayload[];
  status: StreamStatus;
  progress: ProgressPayload | null;
  overBudget: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const streaming = status === 'streaming' || status === 'connecting';
  const { viewportRef, stuck, onScroll, jumpToLatest } = useStickToBottom(messages.length + (progress?.progressPercent ?? 0));
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* The scroller is the live region (a `log` on the list itself would hide its list semantics); focusable to scroll by keyboard. */}
      <div
        ref={viewportRef}
        onScroll={onScroll}
        className="max-h-[70dvh] min-h-32 flex-1 overflow-y-auto px-5 py-6 lg:max-h-none"
        tabIndex={0}
        role="log"
        aria-live="polite"
        aria-label="Conversation"
      >
        {messages.length === 0 && !streaming && (
          <p className="text-[15px] text-muted-foreground">Describe your trip and the agents will walk you through their plan.</p>
        )}
        <ul>
          <AnimatePresence initial={false}>
            {messages.map((message, i) => (
              <MessageItem
                key={`${i}-${message.timestamp}`}
                message={message}
                grouped={i > 0 && messages[i - 1]!.agent === message.agent}
                animate={!reduceMotion}
                overBudget={overBudget}
              />
            ))}
          </AnimatePresence>
          {streaming && <WorkingLine progress={progress} animate={!reduceMotion} />}
        </ul>
      </div>
      {!stuck && (
        <Button size="sm" variant="secondary" className="absolute right-4 bottom-4 shadow" onClick={jumpToLatest}>
          <ArrowDownIcon aria-hidden="true" /> Jump to latest
        </Button>
      )}
    </div>
  );
}

interface AgentChatProps {
  messages: MessagePayload[];
  status: StreamStatus;
  decisionCount: number;
  progress: ProgressPayload | null;
  /** Derived agent statuses for the header avatars. */
  agents: AgentRow[];
  /** The technical view (agent board, run details, terminal) behind the "Technical log" button. */
  technical: ReactNode;
  /** The trip ends over budget: the budget decision reads as a warning, not "approved". */
  overBudget: boolean;
}

/** The primary feed while agents work. */
export function AgentChat({ messages, status, decisionCount, progress, agents, technical, overBudget }: AgentChatProps) {
  const [view, setView] = useState<'chat' | 'log'>('chat');
  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card lg:h-full" aria-labelledby="agent-chat-title">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-5 py-4">
        <h2 id="agent-chat-title" className="text-lg font-semibold">
          Agent Chat
        </h2>
        <ul className="flex gap-1.5" aria-label="Agents">
          {agents.map((row) => (
            <li key={row.agent}>
              <AgentAvatar agent={row.agent} size="sm" status={row.status} />
              <span className="sr-only">
                {agentDisplayNames[row.agent]}: {row.status}
              </span>
            </li>
          ))}
        </ul>
        <span className="text-[13px] text-ink-2">
          {decisionCount} {decisionCount === 1 ? 'decision' : 'decisions'} confirmed
        </span>
        {env.showTechLog && (
          <Button
            variant="outline"
            className="ml-auto h-9 bg-card px-3"
            aria-pressed={view === 'log'}
            onClick={() => setView((v) => (v === 'chat' ? 'log' : 'chat'))}
          >
            {view === 'chat' ? <TerminalIcon aria-hidden="true" /> : <MessageSquareIcon aria-hidden="true" />}
            {view === 'chat' ? 'Technical log' : 'Back to chat'}
          </Button>
        )}
      </header>
      {view === 'chat' || !env.showTechLog ? <Feed messages={messages} status={status} progress={progress} overBudget={overBudget} /> : <div className="p-5">{technical}</div>}
    </section>
  );
}

export interface DecisionSummary {
  topic: DecisionTopic;
  agent: AgentName;
  summary: string;
  /** `false` for a budget the agents could not fit (shown with a warning icon). */
  ok: boolean;
}

/** Finished trip: the closing message, the six confirmed decisions, and tabs to the full chat and the technical log. */
export function ChatSummary({
  messages,
  status,
  decisions,
  progress,
  technical,
  overBudget,
}: {
  messages: MessagePayload[];
  status: StreamStatus;
  decisions: DecisionSummary[];
  progress: ProgressPayload | null;
  technical: ReactNode;
  overBudget: boolean;
}) {
  const [view, setView] = useState<'summary' | 'chat' | 'log'>('summary');
  const last = messages.at(-1);
  return (
    <section className="flex flex-col overflow-hidden rounded-xl border bg-card" aria-labelledby="chat-summary-title">
      <header className="flex items-center justify-between gap-2 border-b px-5 py-4">
        <h2 id="chat-summary-title" className="text-lg font-semibold">
          {view === 'log' ? 'Technical log' : 'Agent Chat'}
        </h2>
        {view === 'summary' ? (
          <span className="text-[13px] text-ink-2">
            {decisions.length} {decisions.length === 1 ? 'decision' : 'decisions'}
          </span>
        ) : (
          <Button variant="link" className="h-auto p-0" onClick={() => setView('summary')}>
            Summary
          </Button>
        )}
      </header>
      {view === 'chat' && <Feed messages={messages} status={status} progress={progress} overBudget={overBudget} />}
      {view === 'log' && <div className="p-4">{technical}</div>}
      {view === 'summary' && (
        <div className="flex flex-col px-5 py-5">
          {last && (
            <ul className="border-b pb-5">
              <MessageItem message={last} grouped={false} animate={false} overBudget={overBudget} />
            </ul>
          )}
          <h3 className={cn('label-mono text-muted-foreground', last && 'mt-5')}>Confirmed by the agents</h3>
          <ul className="mt-3 flex flex-col gap-4">
            {decisions.map((d) => (
              <li key={d.topic} className="flex gap-3">
                {d.ok ? (
                  <CircleCheckIcon className="mt-0.5 size-5 shrink-0 fill-success text-white" aria-hidden="true" />
                ) : (
                  <AlertTriangleIcon className="mt-0.5 size-5 shrink-0 text-live-foreground" aria-hidden="true" />
                )}
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold">
                    {decisionLabels[d.topic]}
                    <span className="sr-only">{d.ok ? ', confirmed' : ', over budget'}</span>
                  </p>
                  <p className="text-sm leading-5 text-ink-2">
                    {d.summary} — {agentDisplayNames[d.agent]}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {messages.length > 0 && (
              <Button variant="outline" className="h-11 bg-card px-4 text-[15px]" onClick={() => setView('chat')}>
                Open full chat
              </Button>
            )}
            {env.showTechLog && (
              <Button variant="link" className="h-11 px-2 text-[15px]" onClick={() => setView('log')}>
                Technical log
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
