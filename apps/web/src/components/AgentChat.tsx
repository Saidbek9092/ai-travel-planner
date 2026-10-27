'use client';

import type { MessagePayload } from '@ai-travel/contracts';
import { AlertTriangleIcon, ArrowDownIcon, CheckCircle2Icon, InfoIcon } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Fragment } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { StreamStatus } from '@/hooks/useAgentStream';
import { useStickToBottom } from '@/hooks/useStickToBottom';
import { AGENT_CHAT_COLORS, agentDisplayNames, decisionLabels } from '@/lib/labels';
import { cn } from '@/lib/utils';

interface AgentChatProps {
  messages: MessagePayload[];
  status: StreamStatus;
  decisionCount: number;
  /** Sub-step of the current run, e.g. "Day 4 of 5". */
  detail?: string | null;
}

const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** Highlights `@Name` tokens. */
function MessageText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(@\w+)/g).map((part, i) =>
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

function TypingIndicator({ animate }: { animate: boolean }) {
  return (
    <div className="flex items-center gap-1 px-1 py-2" role="status" aria-label="Agents are typing">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          aria-hidden="true"
          className={cn('size-1.5 rounded-full bg-muted-foreground/60', animate && 'animate-bounce')}
          style={animate ? { animationDelay: `${i * 120}ms` } : undefined}
        />
      ))}
    </div>
  );
}

export function AgentChat({ messages, status, decisionCount, detail }: AgentChatProps) {
  const reduceMotion = useReducedMotion();
  const { viewportRef, stuck, onScroll, jumpToLatest } = useStickToBottom(messages.length);
  const streaming = status === 'streaming' || status === 'connecting';

  return (
    <section className="relative flex flex-col overflow-hidden rounded-xl border bg-card" aria-labelledby="agent-chat-title">
      <header className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
        <h2 id="agent-chat-title" className="text-sm font-semibold">
          Agent Chat
        </h2>
        <span className="text-xs text-muted-foreground">
          {decisionCount} {decisionCount === 1 ? 'decision' : 'decisions'} confirmed
        </span>
      </header>
      {streaming && detail && (
        <p className="border-b bg-muted/50 px-4 py-1.5 text-xs text-muted-foreground">{detail}</p>
      )}
      <div ref={viewportRef} onScroll={onScroll} className="max-h-80 min-h-24 overflow-y-auto" tabIndex={0}>
        <div role="log" aria-live="polite" aria-label="Conversation" className="flex flex-col gap-3 p-4">
          {messages.length === 0 && !streaming && (
            <p className="text-sm text-muted-foreground">
              Describe your trip and the agents will walk you through their plan.
            </p>
          )}
          <AnimatePresence initial={false}>
            {messages.map((message, i) => {
              const decision = message.decision;
              return (
                <motion.div
                  key={`${i}-${message.timestamp}`}
                  initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.15 }}
                  className={cn('rounded-lg border-l-2 py-1 pl-3', decision ? 'border-primary bg-primary/5' : 'border-transparent')}
                >
                  <p className="flex flex-wrap items-baseline gap-x-2 text-xs">
                    <span className={cn('font-semibold', AGENT_CHAT_COLORS[message.agent])}>
                      {agentDisplayNames[message.agent]}
                    </span>
                    <time dateTime={message.timestamp} className="text-foreground/70">
                      {clock.format(new Date(message.timestamp))}
                    </time>
                  </p>
                  <p className="mt-0.5 text-sm">
                    <MessageText text={message.text} />
                  </p>
                  {decision && (
                    <Badge variant="secondary" className="mt-1.5 border-primary/40 text-primary">
                      <CheckCircle2Icon aria-hidden="true" />
                      Confirmed · {decisionLabels[decision]}
                    </Badge>
                  )}
                  {message.callout && (
                    <Badge
                      variant="outline"
                      className={cn(
                        'mt-1.5 ml-0 h-auto whitespace-normal py-0.5',
                        message.callout.tone === 'warn' && 'border-amber-500/60 bg-amber-50 text-amber-900',
                      )}
                    >
                      {message.callout.tone === 'warn' ? (
                        <AlertTriangleIcon aria-hidden="true" />
                      ) : (
                        <InfoIcon aria-hidden="true" />
                      )}
                      {message.callout.label}
                    </Badge>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
          {streaming && <TypingIndicator animate={!reduceMotion} />}
        </div>
      </div>
      {!stuck && (
        <Button size="sm" variant="secondary" className="absolute right-3 bottom-3 shadow" onClick={jumpToLatest}>
          <ArrowDownIcon aria-hidden="true" /> Jump to latest
        </Button>
      )}
    </section>
  );
}
