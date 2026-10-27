import { AgentNameSchema } from '@ai-travel/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AGENT_COLORS } from '@/lib/labels';
import { cn } from '@/lib/utils';

// Placeholder until T8 replaces it with <TripDashboard>.
export default function Page() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <h1 className="text-2xl font-semibold tracking-tight">Plan a trip in one sentence</h1>
          </CardTitle>
          <CardDescription>The dashboard is coming soon. These agents will plan your trip:</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ul className="flex flex-wrap gap-2">
            {AgentNameSchema.options.map((agent) => (
              <li key={agent}>
                <Badge variant="outline">{agent}</Badge>
              </li>
            ))}
          </ul>
          <div className="rounded-lg bg-zinc-950 p-3 font-mono text-sm">
            <span className={cn(AGENT_COLORS.FlightAgent)}>FlightAgent</span>{' '}
            <span className="text-zinc-100">Found a $500 flight on the Tashkent -&gt; Tashkent route.</span>
          </div>
          <Button disabled className="self-start">
            Plan my trip
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
