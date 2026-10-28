'use client';

import type { LogPayload } from '@ai-travel/contracts';
import { AlertTriangleIcon, ArrowDownIcon, CheckIcon, CircleXIcon, CopyIcon } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
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

function asText(log: LogPayload): string {
  const prefix = LOG_LEVEL_STYLES[log.level].prefix;
  return `${formatTime(log.timestamp)}  #${log.step}  ${log.agent}  ${prefix ? `${prefix} ` : ''}${log.message}`;
}

/** Dark terminal of `LOG` packets with auto-scroll toggle and copy. */
export function AgentTerminalLogs({ logs, status }: AgentTerminalLogsProps) {
  const reduceMotion = useReducedMotion();
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const { viewportRef, stuck, onScroll, jumpToLatest } = useStickToBottom(logs.length, autoScroll);
  const streaming = status === 'streaming' || status === 'connecting';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(logs.map(asText).join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: nothing to do.
    }
  };

  return (
    <section aria-labelledby="terminal-title" className="relative overflow-hidden rounded-xl bg-foreground text-white">
      <header className="flex items-center gap-3 border-b border-white/10 px-4 py-2.5">
        <h3 id="terminal-title" className="text-[13px] font-semibold">
          Agent logs <span className="font-mono font-normal text-white/60">· {logs.length} LOG packets</span>
        </h3>
        <Button
          size="xs"
          variant="ghost"
          className="ml-auto text-white/80 hover:bg-white/10 hover:text-white"
          aria-pressed={autoScroll}
          onClick={() => setAutoScroll((on) => !on)}
        >
          Auto-scroll {autoScroll ? 'on' : 'off'}
        </Button>
        <Button size="xs" variant="ghost" className="text-white/80 hover:bg-white/10 hover:text-white" onClick={copy} disabled={logs.length === 0}>
          {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </header>
      <div ref={viewportRef} onScroll={onScroll} className="h-80 overflow-y-auto" tabIndex={0} aria-label="Technical log, scrollable">
        <div role="log" aria-live="polite" aria-label="Technical log" className="flex flex-col py-2 font-mono text-[13px] leading-5">
          {logs.length === 0 && <p className="px-4 text-white/50">Agent output will appear here.</p>}
          <AnimatePresence initial={false}>
            {logs.map((log, i) => {
              const level = LOG_LEVEL_STYLES[log.level];
              const Icon = LEVEL_ICONS[log.level];
              const newest = i === logs.length - 1;
              if (log.kind === 'checkpoint') {
                return (
                  <motion.p
                    key={`${i}-${log.timestamp}`}
                    initial={reduceMotion ? false : { opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.15 }}
                    className="px-4 py-0.5 text-white/45"
                  >
                    {formatTime(log.timestamp)} <span className="inline-block w-8">—</span> checkpoint · {log.message}
                  </motion.p>
                );
              }
              return (
                <motion.p
                  key={`${i}-${log.timestamp}`}
                  initial={reduceMotion ? false : { opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.15 }}
                  className={cn('px-4 py-0.5 break-words', newest && 'bg-white/[0.06]')}
                >
                  <span className="text-white/45">{formatTime(log.timestamp)}</span>{' '}
                  <span className="inline-block w-8 text-white/45">#{log.step}</span>{' '}
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
            <span aria-hidden="true" className={cn('mx-4 mt-1 inline-block h-4 w-2 bg-white/70', !reduceMotion && 'animate-pulse')} />
          )}
        </div>
      </div>
      {!stuck && autoScroll && (
        <Button size="sm" variant="secondary" className="absolute right-3 bottom-3 shadow" onClick={jumpToLatest}>
          <ArrowDownIcon aria-hidden="true" /> Jump to latest
        </Button>
      )}
    </section>
  );
}
