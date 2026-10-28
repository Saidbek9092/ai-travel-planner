'use client';

import type { ProgressPayload } from '@ai-travel/contracts';
import { CheckIcon, ChevronDownIcon, CopyIcon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

/** Collapsible facts about the run: thread, checkpointer, last checkpoint, model, re-plans. */
export function RunDetails({ threadId, progress, replans }: { threadId: string | null; progress: ProgressPayload | null; replans: number }) {
  const [copied, setCopied] = useState(false);
  const run = progress?.run ?? null;
  const copy = async () => {
    if (!threadId) return;
    try {
      await navigator.clipboard.writeText(threadId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked; the id stays visible to copy by hand.
    }
  };
  const rows: [string, React.ReactNode][] = [
    [
      'Thread',
      threadId ? (
        <span className="flex items-center gap-1">
          <code className="truncate font-mono">{threadId}</code>
          <Button size="icon-xs" variant="ghost" onClick={copy} aria-label={copied ? 'Copied' : 'Copy thread id'}>
            {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
          </Button>
        </span>
      ) : (
        '—'
      ),
    ],
    ['Checkpointer', run ? (run.checkpointer === 'postgres' ? 'PostgresSaver' : 'MemorySaver') : '—'],
    ['Last checkpoint', run?.lastCheckpointStep ? `step ${run.lastCheckpointStep}` : '—'],
    ['Model', run?.model ?? '—'],
    ['Re-plans', `${replans} of 2`],
  ];
  return (
    <details className="group rounded-xl border bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between rounded-xl px-4 py-3 text-[15px] font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        Run details
        <ChevronDownIcon className="size-4 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 border-t px-4 py-3 text-[13px]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 font-mono text-ink-2">{value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
