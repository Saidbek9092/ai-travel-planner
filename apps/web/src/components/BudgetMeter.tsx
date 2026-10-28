import type { BudgetPass } from '@ai-travel/contracts';
import { CircleAlertIcon, CheckIcon } from 'lucide-react';
import { PendingTag } from '@/components/Tags';
import type { BudgetParts } from '@/lib/trip';
import { cn, formatUsd } from '@/lib/utils';

interface BudgetMeterProps {
  totalCost: number;
  budget: number;
  parts: BudgetParts;
  /** Kept in the props for callers; the passes table itself lives in the technical view (`PassesTable`). */
  passes: BudgetPass[];
  /** The Budget Auditor has approved (or given up on) the total. */
  final: boolean;
  /** `card` in the live overview; `compact` next to the finished trip's title. */
  variant?: 'card' | 'compact';
}

const SEGMENTS = [
  { key: 'flight', label: 'Flights', className: 'bg-budget-flights' },
  { key: 'hotel', label: 'Hotel', className: 'bg-budget-hotel' },
  { key: 'transfers', label: 'Transfers', className: 'bg-budget-transfers' },
  { key: 'daily', label: 'Daily spend', className: 'bg-budget-daily' },
] as const satisfies readonly { key: keyof BudgetParts; label: string; className: string }[];

/** "$100 under" / "Within $15" / "Over by $84" */
export function budgetVerdict(totalCost: number, budget: number): { text: string; over: boolean } {
  const diff = budget - totalCost;
  if (diff < 0) return { text: `Over by ${formatUsd(-diff)}`, over: true };
  if (diff <= budget * 0.02) return { text: `Within ${formatUsd(diff)}`, over: false };
  return { text: `${formatUsd(diff)} to spare`, over: false };
}

/** Stacked bar in one hue with stepped lightness; rescales past 100 % with a tick at the budget. */
function Bar({ totalCost, budget, parts, className }: { totalCost: number; budget: number; parts: BudgetParts; className?: string }) {
  const scale = Math.max(budget, totalCost) || 1;
  const left = Math.max(0, budget - totalCost);
  return (
    <div className={cn('relative flex h-2.5 gap-0.5 overflow-hidden rounded-full', className)} aria-hidden="true">
      {SEGMENTS.map(({ key, className: color }) =>
        parts[key] > 0 ? <span key={key} className={cn('h-full first:rounded-l-full', color)} style={{ width: `${(parts[key] / scale) * 100}%` }} /> : null,
      )}
      {left > 0 && <span className="h-full flex-1 rounded-r-full bg-budget-left" />}
      {totalCost > budget && <span className="absolute inset-y-0 w-0.5 bg-foreground" style={{ left: `${(budget / scale) * 100}%` }} />}
    </div>
  );
}

/** "What changed on re-plan": one column per search pass. */
export function PassesTable({ passes }: { passes: BudgetPass[] }) {
  const rows: [string, (p: BudgetPass) => string][] = [
    ['Flight', (p) => p.flightLabel],
    ['Hotel', (p) => p.hotelLabel],
    ['Transfers', (p) => formatUsd(p.transfers)],
    ['Daily', (p) => formatUsd(p.daily)],
    ['Total', (p) => formatUsd(p.totalCost)],
  ];
  return (
    <section aria-labelledby="passes-title" className="rounded-xl border bg-card px-4 py-3 text-[13px]">
      <h3 id="passes-title" className="text-[15px] font-semibold">
        What changed on re-plan
      </h3>
      <table className="mt-2 w-full text-left">
        <thead>
          <tr className="label-mono text-muted-foreground">
            <th scope="col" className="py-1 font-normal">
              Item
            </th>
            {passes.map((p) => (
              <th key={p.pass} scope="col" className="py-1 text-right font-normal">
                Pass {p.pass}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} className={cn('border-t', label === 'Total' && 'font-semibold')}>
              <th scope="row" className="py-1 font-normal text-ink-2">
                {label}
              </th>
              {passes.map((p) => (
                <td key={p.pass} className="py-1 text-right font-mono">
                  {value(p)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function BudgetMeter({ totalCost, budget, parts, final, variant = 'card' }: BudgetMeterProps) {
  const verdict = budgetVerdict(totalCost, budget);
  const label = `${formatUsd(totalCost)} of ${formatUsd(budget)}, ${final ? verdict.text : 'final check pending'}`;

  if (variant === 'compact') {
    return (
      <section aria-label={`Budget: ${label}`} className="rounded-xl border bg-card px-5 py-3">
        <div className="flex items-center gap-x-4">
          <span
            className={cn('flex size-10 shrink-0 items-center justify-center rounded-full text-white', verdict.over ? 'bg-destructive' : 'bg-success')}
            aria-hidden="true"
          >
            {verdict.over ? <CircleAlertIcon className="size-5" /> : <CheckIcon className="size-5" strokeWidth={3} />}
          </span>
          <div className="min-w-0">
            <p className="flex items-baseline gap-2">
              <span className="text-2xl leading-7 font-semibold tracking-tight">{formatUsd(totalCost)}</span>
              <span className="text-[15px] text-ink-2">of {formatUsd(budget)}</span>
            </p>
            <p className={cn('text-sm leading-[18px] font-semibold whitespace-nowrap', verdict.over ? 'text-destructive' : 'text-success')}>
              {verdict.over ? `Over budget by ${formatUsd(totalCost - budget)}` : `Budget approved · ${verdict.text}`}
            </p>
          </div>
          <Bar totalCost={totalCost} budget={budget} parts={parts} className="ml-auto w-36 shrink-0" />
        </div>
      </section>
    );
  }

  return (
    <section aria-label={`Budget: ${label}`} className="rounded-xl border bg-card px-5 pt-4 pb-[15px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-baseline gap-2">
          <span className="text-[30px] leading-9 font-semibold tracking-tight">{formatUsd(totalCost)}</span>
          <span className="text-[15px] text-ink-2">of {formatUsd(budget)}</span>
        </p>
        {final ? (
          <span
            className={cn(
              'inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-xs font-medium',
              verdict.over ? 'bg-destructive-soft text-destructive' : 'bg-success-soft text-success',
            )}
          >
            {verdict.over ? <CircleAlertIcon className="size-3.5" aria-hidden="true" /> : <CheckIcon className="size-3.5" aria-hidden="true" />}
            {verdict.over ? verdict.text : `Approved · ${verdict.text}`}
          </span>
        ) : (
          <PendingTag>Final check pending</PendingTag>
        )}
      </div>
      <Bar totalCost={totalCost} budget={budget} parts={parts} className="mt-3 h-[9px]" />
      <dl className="mt-3 grid grid-cols-2 gap-x-8 text-[15px] leading-6">
        {SEGMENTS.map(({ key, label: name, className }) => (
          <div key={key} className="flex items-center gap-2">
            <span className={cn('size-2.5 shrink-0 rounded-sm', className)} aria-hidden="true" />
            <dt className="flex-1 text-ink-2">{name}</dt>
            <dd className="font-mono">{formatUsd(parts[key])}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
