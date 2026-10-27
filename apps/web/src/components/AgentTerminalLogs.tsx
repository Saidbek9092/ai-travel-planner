'use client';

import type { LogPayload } from '@ai-travel/contracts';
import { AlertTriangleIcon, ArrowDownIcon, CircleXIcon } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Button } from '@/components/ui/button';
import type { StreamStatus } from '@/hooks/useAgentStream';
import { useStickToBottom } from '@/hooks/useStickToBottom';
import { AGENT_COLORS, LOG_LEVEL_STYLES } from '@/lib/labels';
import { cn, formatTime } from '@/lib/utils';

interface AgentTerminalLogsProps {
  logs: LogPayload[];
  status: StreamStatus;
}

const LEVEL_ICONS = { info: null, warn: AlertTriangleIcon, error: CircleXIcon } as const;

export function AgentTerminalLogs({ logs, status }: AgentTerminalLogsProps) {
  const reduceMotion = useReducedMotion();
  const { viewportRef, stuck, onScroll, jumpToLatest } = useStickToBottom(logs.length);
  const streaming = status === 'streaming' || status === 'connecting';

  return (
    <div className="relative rounded-xl bg-zinc-950 text-sm">
      <div ref={viewportRef} onScroll={onScroll} className="h-80 overflow-y-auto" tabIndex={0}>
        <div
          role="log"
          aria-live="polite"
          aria-label="Agent logs"
          className="flex flex-col gap-1 p-3 font-mono text-[13px] leading-5"
        >
          {logs.length === 0 && <p className="text-zinc-500">Agent output will appear here.</p>}
          <AnimatePresence initial={false}>
            {logs.map((log, i) => {
              const level = LOG_LEVEL_STYLES[log.level];
              const Icon = LEVEL_ICONS[log.level];
              return (
                <motion.p
                  key={`${i}-${log.timestamp}`}
                  initial={reduceMotion ? false : { opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.15 }}
                  className="break-words"
                >
                  <span className="text-zinc-500">{formatTime(log.timestamp)}</span>{' '}
                  <span className="text-zinc-500">[{log.step}]</span>{' '}
                  <span className={cn('font-semibold', AGENT_COLORS[log.agent])}>{log.agent}</span>{' '}
                  <span className={level.className}>
                    {Icon && <Icon className="mr-1 inline size-3.5 align-text-bottom" aria-hidden="true" />}
                    {level.prefix && <span className="mr-1 font-semibold">{level.prefix}</span>}
                    {log.message}
                  </span>
                </motion.p>
              );
            })}
          </AnimatePresence>
          {streaming && (
            <span
              aria-hidden="true"
              className={cn('inline-block h-4 w-2 bg-zinc-300', !reduceMotion && 'animate-pulse')}
            />
          )}
        </div>
      </div>
      {!stuck && (
        <Button size="sm" variant="secondary" className="absolute right-3 bottom-3 shadow" onClick={jumpToLatest}>
          <ArrowDownIcon aria-hidden="true" /> Jump to latest
        </Button>
      )}
    </div>
  );
}
