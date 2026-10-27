import type { ResultPayload } from '@ai-travel/contracts';
import { AlertTriangleIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn, formatUsd } from '@/lib/utils';

export function BudgetSummary({ result }: { result: ResultPayload }) {
  const { totalCost, budget, durationDays, flights, hotels, transfers, dailyExpensesEstimate, warnings } = result;
  const over = totalCost - budget;
  const scale = Math.max(budget, totalCost) || 1;
  const parts = [
    { label: 'Flights', amount: flights[0]?.price ?? 0 },
    { label: 'Hotel', amount: (hotels[0]?.pricePerNight ?? 0) * durationDays },
    { label: 'Transfers', amount: transfers.reduce((sum, t) => sum + t.priceUsd, 0) },
    { label: 'Daily spend', amount: dailyExpensesEstimate * durationDays },
  ];
  const verdict = over > 0 ? `Over by ${formatUsd(over)}` : over === 0 ? 'Exactly on budget' : `${formatUsd(-over)} under`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-2xl">{formatUsd(totalCost)}</span>
          <span className="text-sm font-normal text-muted-foreground">of {formatUsd(budget)} budget</span>
          <span className={cn('ml-auto text-sm', over > 0 ? 'text-destructive' : 'text-emerald-700')}>{verdict}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div
          role="img"
          aria-label={`${formatUsd(totalCost)} of ${formatUsd(budget)}, ${verdict}`}
          className="relative h-3 overflow-hidden rounded-full bg-muted"
        >
          <div className="flex h-full" style={{ width: `${(totalCost / scale) * 100}%` }}>
            {parts.map((part, i) => (
              <div key={part.label} className="h-full bg-primary" style={{ width: `${totalCost ? (part.amount / totalCost) * 100 : 0}%`, opacity: 1 - i * 0.2 }} />
            ))}
          </div>
          <div className="absolute inset-y-0 w-0.5 bg-foreground" style={{ left: `${(budget / scale) * 100}%` }} />
        </div>
        <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          {parts.map((part) => (
            <div key={part.label}>
              <dt className="text-muted-foreground">{part.label}</dt>
              <dd className="font-mono">{formatUsd(part.amount)}</dd>
            </div>
          ))}
        </dl>
        {warnings.map((warning) => (
          <Alert key={warning} className="border-amber-500 text-amber-900">
            <AlertTriangleIcon aria-hidden="true" />
            <AlertDescription className="text-amber-900">{warning}</AlertDescription>
          </Alert>
        ))}
      </CardContent>
    </Card>
  );
}
