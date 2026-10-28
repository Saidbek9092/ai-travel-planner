import type { AgentName } from '@ai-travel/contracts';
import { AGENT_AVATAR_COLORS, AGENT_ICONS, agentDisplayNames } from '@/lib/labels';
import type { AgentRunStatus } from '@/lib/trip';
import { cn } from '@/lib/utils';

const DOT: Record<AgentRunStatus, string> = {
  done: 'bg-success',
  running: 'bg-live',
  waiting: 'bg-card ring-1 ring-inset ring-muted-foreground/60',
  failed: 'bg-destructive',
};

/** Round agent badge: white icon on the agent's colour, with an optional status dot. Decorative unless `labelled`. */
export function AgentAvatar({
  agent,
  size = 'md',
  status,
  className,
}: {
  agent: AgentName;
  size?: 'sm' | 'md';
  status?: AgentRunStatus;
  className?: string;
}) {
  const Icon = AGENT_ICONS[agent];
  return (
    <span
      className={cn(
        'relative flex shrink-0 items-center justify-center rounded-full text-white',
        size === 'md' ? 'size-9' : 'size-7 ring-2 ring-card',
        className,
      )}
      style={{ backgroundColor: AGENT_AVATAR_COLORS[agent] }}
      title={status ? `${agentDisplayNames[agent]} · ${status}` : agentDisplayNames[agent]}
      aria-hidden="true"
    >
      <Icon className={size === 'md' ? 'size-4' : 'size-3.5'} />
      {status && <span className={cn('absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-card', DOT[status])} />}
    </span>
  );
}
