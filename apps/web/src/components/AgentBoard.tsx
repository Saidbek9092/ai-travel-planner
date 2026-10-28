import type { ProgressPayload } from '@ai-travel/contracts';
import { AgentAvatar } from '@/components/AgentAvatar';
import { AgentStatusChip } from '@/components/Tags';
import { agentDisplayNames } from '@/lib/labels';
import type { AgentRow } from '@/lib/trip';
import { cn, formatTime } from '@/lib/utils';

/** The latest line per agent; the Planner's running line comes from `progress.detail`. */
function latestText(row: AgentRow, progress: ProgressPayload | null): string {
  if (row.status === 'running' && row.agent === 'Planner' && progress?.detail) return `Building ${progress.detail.toLowerCase()}`;
  if (row.status === 'waiting' && !row.latest) return 'Waiting for its turn';
  return row.latest?.message ?? '—';
}

/** One row per agent: step, latest log line, derived status chip, update time. Compact list below `sm`. */
export function AgentBoard({ rows, progress }: { rows: AgentRow[]; progress: ProgressPayload | null }) {
  const pass = progress?.pass ?? 1;
  return (
    <section aria-labelledby="agent-board-title" className="@container rounded-xl border bg-card">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b px-4 py-3">
        <h3 id="agent-board-title" className="text-[15px] font-semibold">
          Agent board
        </h3>
        <span className="font-mono text-xs text-muted-foreground">LangGraph · 5 nodes · pass {pass}</span>
      </header>
      <table className="w-full text-left text-[13px]">
        <thead className="@max-xl:sr-only">
          <tr className="label-mono text-muted-foreground">
            <th scope="col" className="py-2 pl-4 font-normal">
              Step
            </th>
            <th scope="col" className="py-2 font-normal">
              Agent
            </th>
            <th scope="col" className="py-2 font-normal">
              Latest
            </th>
            <th scope="col" className="py-2 font-normal">
              Status
            </th>
            <th scope="col" className="py-2 pr-4 text-right font-normal">
              Updated
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.agent} className={cn('border-t align-top', row.status === 'running' && 'bg-live-soft/50')}>
              <td className="py-2.5 pl-4 font-mono text-muted-foreground">{String(i + 1).padStart(2, '0')}</td>
              <td className="py-2.5 pr-3">
                <span className="flex items-center gap-2 font-medium @xl:whitespace-nowrap">
                  <AgentAvatar agent={row.agent} size="sm" />
                  {agentDisplayNames[row.agent]}
                </span>
                <span className="mt-1 block font-normal text-muted-foreground @xl:hidden">{latestText(row, progress)}</span>
              </td>
              <td className="py-2.5 pr-3 text-ink-2 @max-xl:hidden">
                {latestText(row, progress)}
                {row.rerun && <span className="ml-2 rounded-full bg-primary-soft px-2 py-0.5 text-xs font-medium text-primary">pass {pass}</span>}
              </td>
              <td className="py-2.5 pr-3 @max-xl:pr-4 @max-xl:text-right">
                <AgentStatusChip status={row.status} />
              </td>
              <td className="py-2.5 pr-4 text-right font-mono text-muted-foreground @max-xl:hidden">
                {row.latest ? formatTime(row.latest.timestamp) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
