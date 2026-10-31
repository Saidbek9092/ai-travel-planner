'use client';

import { TripRequestSchema, type Interest, type TripRequest } from '@ai-travel/contracts';
import { ArrowRightIcon, CheckIcon, CircleAlertIcon, CircleDotIcon, CloudSunIcon, CoinsIcon, ClockIcon, InfoIcon, PlusIcon } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useEffectEvent, useId, useRef, useState, type ReactNode } from 'react';
import { Notice } from '@/components/Notice';
import { PlaceInput } from '@/components/PlaceInput';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { PlansCard } from '@/components/PlansCard';
import { formatCountdown, spokenWait, useCountdown } from '@/hooks/useCountdown';
import { useUsage } from '@/hooks/useUsage';
import { useHomeCity } from '@/hooks/useHomeCity';
import { useNow } from '@/hooks/useNow';
import { useTripContext } from '@/hooks/useTripContext';
import { MONTH_NAMES, parseTrip, startDateForMonth } from '@/lib/parseTrip';
import { cn, formatUsd } from '@/lib/utils';

const MAX_PROMPT = 1000;
const WARN_AT = 900;
const DEBOUNCE_MS = 300;

const EXAMPLES = [
  {
    title: 'Istanbul',
    country: 'Türkiye',
    days: 4,
    price: '$1,500',
    blurb: 'Street food and the Bosphorus',
    prompt: '4 days in Istanbul from Tashkent, $1,500. Street food and the Bosphorus.',
    image: '/examples/istanbul.jpg',
    credit: 'Photo: Hunanuk, CC0',
  },
  {
    title: 'Paris',
    country: 'France',
    days: 5,
    price: '$2,500',
    blurb: 'Museums and good food, mid-November',
    prompt: '5 days in Paris from Tashkent in November, $2,500. Museums and good food.',
    image: '/examples/paris.jpg',
    credit: 'Photo: Yann Caradec, CC BY-SA 2.0',
  },
  {
    title: 'Tokyo',
    country: 'Japan',
    days: 7,
    price: '$4,000',
    blurb: 'Temples and food markets',
    prompt: '7 days in Tokyo from Tashkent, $4,000. Temples and food markets.',
    image: '/examples/tokyo.jpg',
    credit: 'Photo: Morio, CC BY-SA 3.0',
  },
];

const INTERESTS: { value: Interest; label: string }[] = [
  { value: 'museums', label: 'Museums' },
  { value: 'food', label: 'Food' },
  { value: 'walking', label: 'Walking' },
  { value: 'nightlife', label: 'Nightlife' },
  { value: 'shopping', label: 'Shopping' },
  { value: 'nature', label: 'Nature' },
];

type FieldKey = 'destination' | 'origin' | 'days' | 'budget' | 'when';
type FieldState = 'found' | 'default' | 'missing' | 'invalid';

interface FieldView {
  key: FieldKey;
  label: string;
  /** Text shown for a found or default value. */
  value: string | null;
  state: FieldState;
  /** Initial text of the inline editor. */
  editValue: string;
  placeholder: string;
  /** Text after "Add" in the missing state. */
  addLabel: string;
  /** Short reason in the invalid state, e.g. "1 to 30 days". */
  problem?: string;
  inputMode?: 'text' | 'numeric';
}

type Overrides = Partial<Record<FieldKey, string>>;

interface TripInputFormProps {
  onSubmit: (request: TripRequest) => void;
  disabled: boolean;
  /** Epoch ms when the rate limit lifts; the submit button counts down until then. */
  retryAt: number | null;
  /** Notices above the form card (left column). */
  notices?: ReactNode;
  /** Bottom of the input card, under the Plan button. */
  footer?: ReactNode;
  /** Fills the form (Re-plan): the person can change it, nothing starts until they press Plan. */
  initialRequest?: TripRequest | null;
}

/** The start page's input: one sentence, the fields the agents understood from it, interests and examples. */
export function TripInputForm({ onSubmit, disabled, retryAt, notices, footer, initialRequest = null }: TripInputFormProps) {
  const waitSeconds = useCountdown(retryAt);
  const usage = useUsage();
  const outOfPlans = usage !== null && usage.remaining === 0;
  const { homeCity, setHomeCity } = useHomeCity();
  const [prompt, setPrompt] = useState(initialRequest?.prompt ?? '');
  const [settled, setSettled] = useState(initialRequest?.prompt ?? '');
  const [overrides, setOverrides] = useState<Overrides>({});
  const [editing, setEditing] = useState<FieldKey | null>(null);
  const [interests, setInterests] = useState<Interest[]>(initialRequest?.interests ?? []);
  const promptId = useId();

  // Parsed fields follow the text after a short pause; examples settle at once.
  useEffect(() => {
    const timer = setTimeout(() => setSettled(prompt), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [prompt]);

  const parsed = parseTrip(settled);
  const monthName = parsed.month !== null ? MONTH_NAMES[parsed.month] : null;
  const destination = overrides.destination ?? parsed.destination;
  const originText = overrides.origin ?? parsed.origin ?? (homeCity || null);
  const daysText = overrides.days ?? (parsed.durationDays !== null ? String(parsed.durationDays) : null);
  const budgetText = overrides.budget ?? (parsed.budget !== null ? String(parsed.budget) : null);
  const whenText = overrides.when ?? monthName ?? 'Flexible';

  const days = daysText ? Number(daysText) : null;
  const budget = budgetText ? Number(budgetText) : null;
  const validDays = days !== null && Number.isInteger(days) && days >= 1 && days <= 30 ? days : null;
  const validBudget = budget !== null && Number.isFinite(budget) && budget > 0 ? budget : null;
  // A value that was given (typed or read from the sentence) but can't be used says why, instead of turning back into "Add".
  const daysInvalid = daysText !== null && validDays === null;
  const budgetInvalid = budgetText !== null && validBudget === null;

  const fields: FieldView[] = [
    { key: 'destination', label: 'Destination', value: destination, state: destination ? 'found' : 'missing', editValue: destination ?? '', placeholder: 'e.g. Paris', addLabel: 'a place' },
    {
      key: 'origin',
      label: 'From · home city',
      value: originText,
      state: overrides.origin || parsed.origin ? 'found' : originText ? 'default' : 'missing',
      editValue: originText ?? '',
      placeholder: 'Your home city',
      addLabel: 'a city',
    },
    {
      key: 'days',
      label: 'How long',
      value: validDays ? `${validDays} ${validDays === 1 ? 'day' : 'days'}` : daysInvalid ? (Number.isFinite(days) ? `${days} days` : daysText) : null,
      state: validDays ? 'found' : daysInvalid ? 'invalid' : 'missing',
      editValue: daysText ?? '',
      placeholder: 'Days, 1–30',
      addLabel: 'days',
      inputMode: 'numeric',
      problem: '1 to 30 days',
    },
    {
      key: 'budget',
      label: 'Budget, all-in',
      value: validBudget ? formatUsd(validBudget) : budgetInvalid ? budgetText : null,
      state: validBudget ? 'found' : budgetInvalid ? 'invalid' : 'missing',
      editValue: budgetText ?? '',
      placeholder: 'USD, total',
      addLabel: 'budget',
      inputMode: 'numeric',
      problem: 'Over $0, in USD',
    },
    {
      key: 'when',
      label: 'When',
      value: whenText,
      state: overrides.when || monthName ? 'found' : 'default',
      editValue: overrides.when ?? monthName ?? '',
      placeholder: 'Month, e.g. March',
      addLabel: 'a month',
    },
  ];

  const missing = [
    ...(destination ? [] : ['where']),
    ...(validDays || daysInvalid ? [] : ['how long']),
    ...(validBudget || budgetInvalid ? [] : ['your budget']),
  ];
  const problems = [
    ...(daysInvalid ? ['A trip can be 1 to 30 days long.'] : []),
    ...(budgetInvalid ? ['The budget must be a number of US dollars above $0.'] : []),
  ];
  const ready = !!destination && validDays !== null && validBudget !== null;
  const helper = ready
    ? waitSeconds > 0
      ? 'Ready. You can press Plan when the timer runs out.'
      : 'Ready. The five agents start as soon as you press Plan.'
    : [...problems, missing.length > 0 ? `Tell us ${missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(', ')} and ${missing.at(-1)}`} to start.` : '']
        .filter(Boolean)
        .join(' ');

  const change = (key: FieldKey, value: string) => {
    setOverrides((current) => {
      const next = { ...current };
      if (value.trim()) next[key] = value.trim();
      else delete next[key];
      return next;
    });
    if (key === 'origin' && value.trim()) setHomeCity(value);
  };

  const fill = (text: string) => {
    setPrompt(text);
    setSettled(text);
    setOverrides({});
    setEditing(null);
  };

  // Picking an example scrolls to the Plan button and draws the eye to it. `nudge` also keys the button, which restarts the animation.
  const planButton = useRef<HTMLButtonElement>(null);
  const [nudge, setNudge] = useState(0);
  useEffect(() => {
    if (nudge === 0) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    planButton.current?.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    planButton.current?.focus({ preventScroll: true });
  }, [nudge]);

  const toggleInterest = (interest: Interest) =>
    setInterests((current) => (current.includes(interest) ? current.filter((i) => i !== interest) : [...current, interest]));

  // ⌘/Ctrl+Enter right after typing: read the latest text first (the fields follow it after a pause), then submit.
  const submitQueued = useRef(false);
  const submit = () => {
    if (prompt !== settled) {
      submitQueued.current = true;
      setSettled(prompt);
      return;
    }
    if (disabled || waitSeconds > 0 || !ready || outOfPlans) return;
    const month = overrides.when ? MONTH_NAMES.findIndex((m) => m.toLowerCase().startsWith(overrides.when!.toLowerCase().slice(0, 3))) : parsed.month;
    const request = TripRequestSchema.safeParse({
      prompt: destination && overrides.destination ? `${prompt.trim()} (destination: ${destination})` : prompt.trim() || `${validDays} days in ${destination}, ${formatUsd(validBudget ?? 0)}`,
      ...(originText ? { origin: originText } : {}),
      ...(validBudget ? { budget: validBudget } : {}),
      ...(validDays ? { durationDays: validDays } : {}),
      ...(month !== null && month >= 0 ? { startDate: startDateForMonth(month) } : {}),
      when: whenText,
      ...(interests.length > 0 ? { interests } : {}),
    });
    if (request.success) onSubmit(request.data);
  };
  const submitWhenSettled = useEffectEvent(() => {
    if (!submitQueued.current || settled !== prompt) return;
    submitQueued.current = false;
    submit();
  });
  useEffect(() => {
    submitWhenSettled();
  }, [settled]);

  const canPlan = ready && !disabled && waitSeconds === 0 && !outOfPlans;

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)]"
    >
      <div className="flex min-w-0 flex-col gap-6">
        {notices}
      <div className="flex flex-col gap-6 rounded-2xl border bg-card p-6 shadow-sm [@media(min-width:1024px)_and_(max-height:980px)]:gap-4 [@media(min-width:1024px)_and_(max-height:980px)]:p-5">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4">
            <label htmlFor={promptId} className="text-lg font-semibold">
              Describe your trip
            </label>
            <span className="text-[13px] text-ink-2">Write it the way you&apos;d tell a friend</span>
          </div>
          <Textarea
            id={promptId}
            rows={3}
            maxLength={MAX_PROMPT}
            value={prompt}
            disabled={disabled}
            aria-describedby={`${promptId}-hint`}
            placeholder="e.g. 5 days in Paris from Tashkent in mid-November, $2,500 all-in. Museums and good food."
            className="min-h-[100px] resize-none rounded-xl bg-card px-5 py-4 text-[20px] leading-snug [@media(min-width:1024px)_and_(max-height:980px)]:min-h-[80px] md:text-[20px]"
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <p id={`${promptId}-hint`} className="text-[13px] text-ink-2" aria-live="polite">
            {prompt.length >= WARN_AT ? `${MAX_PROMPT - prompt.length} characters left.` : ''}
          </p>
        </div>

        <section aria-labelledby={`${promptId}-understood`} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4">
            <h2 id={`${promptId}-understood`} className="font-mono text-[11px] font-medium tracking-[0.14em] text-ink-2 uppercase">
              What the agents understood
            </h2>
            <span id={`${promptId}-understood-hint`} className="text-[13px] text-ink-2">
              Click any item to change it
            </span>
          </div>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 [@media(min-width:1024px)_and_(max-height:980px)]:grid-cols-5 [@media(min-width:1024px)_and_(max-height:980px)]:gap-2">
            {fields.map((field) => (
              <UnderstoodField
                key={field.key}
                field={field}
                describedBy={`${promptId}-understood-hint`}
                editing={editing === field.key}
                disabled={disabled}
                onEdit={() => setEditing(field.key)}
                onClose={() => setEditing(null)}
                onChange={(value) => change(field.key, value)}
              />
            ))}
          </ul>
        </section>

        {destination && <DestinationPreview destination={destination} origin={originText} />}

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-3 text-sm">
            <span className="font-semibold">Interests</span> <span className="text-ink-2">· optional</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {INTERESTS.map(({ value, label }) => {
              const on = interests.includes(value);
              return (
                <Button
                  key={value}
                  type="button"
                  variant="outline"
                  aria-pressed={on}
                  disabled={disabled}
                  onClick={() => toggleInterest(value)}
                  className={cn('h-10 rounded-full bg-card px-4 text-[14px] pointer-coarse:h-11', on && 'border-primary bg-primary-soft text-primary')}
                >
                  {on && <CheckIcon aria-hidden="true" />} {label}
                </Button>
              );
            })}
          </div>
        </fieldset>

        {usage && <PlansCard usage={usage} />}

        <div className="flex flex-wrap items-center justify-between gap-4 border-t pt-5">
          <p
            id={`${promptId}-helper`}
            className={cn('flex items-center gap-2 text-sm', problems.length > 0 ? 'text-destructive' : 'text-ink-2')}
            aria-live="polite"
          >
            {problems.length > 0 ? (
              <CircleAlertIcon className="size-4 shrink-0" aria-hidden="true" />
            ) : (
              <InfoIcon className="size-4 shrink-0" aria-hidden="true" />
            )}{' '}
            {helper}
          </p>
          <Button
            key={nudge}
            ref={planButton}
            type="submit"
            disabled={!canPlan}
            aria-describedby={`${promptId}-helper`}
            className={cn('h-12 px-6 text-[16px] disabled:bg-border disabled:text-ink-2 disabled:opacity-100', nudge > 0 && canPlan && 'plan-attention')}
          >
            {waitSeconds > 0 ? `Plan in ${formatCountdown(waitSeconds)}` : 'Plan my trip'} <ArrowRightIcon aria-hidden="true" />
          </Button>
        </div>
        {waitSeconds > 0 && (
          <Notice
            tone="info"
            placement="inline"
            title={
              <>
                You can plan another trip in{' '}
                {/* The clock ticks every second; screen readers get a coarse time that changes at most once a minute. */}
                <span aria-hidden="true">{formatCountdown(waitSeconds)}</span>
                <span className="sr-only">{spokenWait(waitSeconds)}</span>
              </>
            }
          >
            {waitSeconds > 3600
              ? "That's today's limit of trips from this connection. Your prompt is kept."
              : 'Lots of trips are being planned right now. Your prompt is kept.'}
          </Notice>
        )}
        {footer}
      </div>

      </div>

      <div className="flex min-w-0 flex-col lg:relative">
        {/* On large screens the card is pinned to the row (the form card sets its height) and its list scrolls. */}
        <section aria-labelledby={`${promptId}-examples`} className="flex flex-col gap-4 rounded-2xl border bg-card p-6 shadow-sm lg:absolute lg:inset-0">
          <div className="shrink-0">
            <h2 id={`${promptId}-examples`} className="text-lg font-semibold">
              Not sure where to start?
            </h2>
            <p className="text-sm text-ink-2">Pick one: it fills the form, and you can edit it after.</p>
          </div>
          {/* Only this list scrolls, so the photos never make the whole page taller. The padding keeps focus rings from being clipped. */}
          <ul className="-mx-1 flex min-h-0 flex-col gap-3 overflow-y-auto px-1 py-1">
            {EXAMPLES.map((example, index) => (
              <li key={example.title}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    fill(example.prompt);
                    setNudge((n) => n + 1);
                  }}
                  className="group flex w-full flex-col overflow-hidden rounded-xl border bg-card text-left outline-none transition-colors hover:border-primary focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
                >
                  <span className="relative block h-36 w-full overflow-hidden bg-muted">
                    {/* Decorative here: the card's text names the place. The first photo is above the fold on desktop. */}
                    <Image
                      src={example.image}
                      alt=""
                      loading={index === 0 ? 'eager' : 'lazy'}
                      fill
                      sizes="(min-width: 1024px) 440px, 100vw"
                      className="object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                    <span className="absolute right-2 bottom-2 rounded-full bg-card px-2.5 py-1 font-mono text-sm font-semibold shadow-sm">{example.price}</span>
                  </span>
                  <span className="flex flex-col gap-1 p-4">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-[17px] font-semibold">
                        {example.title} <span className="text-[13px] font-normal text-ink-2">· {example.country}</span>
                      </span>
                      <span className="text-[13px] font-medium text-ink-2">{example.days} days</span>
                    </span>
                    <span className="text-[13px] text-ink-2">From Tashkent · {example.blurb}</span>
                    <span className="flex items-center justify-between gap-2 pt-1">
                      <span className="flex items-center gap-1 text-[13px] font-semibold text-primary">
                        Use this <ArrowRightIcon className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                      </span>
                      <span className="text-[11px] text-ink-2">{example.credit}</span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </form>
  );
}

function UnderstoodField({
  field,
  describedBy,
  editing,
  disabled,
  onEdit,
  onClose,
  onChange,
}: {
  field: FieldView;
  /** Id of the "Click any item to change it" hint. */
  describedBy: string;
  editing: boolean;
  disabled: boolean;
  onEdit: () => void;
  onClose: () => void;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(field.editValue);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputId = useId();

  const close = (save: boolean) => {
    if (save) onChange(draft);
    onClose();
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  if (editing) {
    return (
      <li className="col-span-2 flex flex-col gap-1 rounded-xl border border-primary bg-card p-3 sm:col-span-1">
        <label htmlFor={inputId} className="text-[13px] font-semibold text-ink-2">
          {field.label}
        </label>
        {field.key === 'destination' || field.key === 'origin' ? (
          <PlaceInput
            id={inputId}
            value={draft}
            placeholder={field.placeholder}
            onChange={setDraft}
            onCommit={(value) => {
              onChange(value);
              close(false);
            }}
            onCancel={() => close(false)}
            onBlurCommit={(value) => {
              onChange(value);
              onClose();
            }}
            onDismiss={onClose}
          />
        ) : (
          <Input
            id={inputId}
            autoFocus
            value={draft}
            inputMode={field.inputMode}
            className="h-9 pointer-coarse:h-11"
            placeholder={field.placeholder}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                close(true);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                close(false);
              }
            }}
            onBlur={() => close(true)}
          />
        )}
      </li>
    );
  }

  const { state } = field;
  return (
    <li>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => {
          setDraft(field.editValue);
          onEdit();
        }}
        // The visible label and value are the accessible name (WCAG 2.5.3); the hint says it can be changed.
        aria-describedby={describedBy}
        className={cn(
          'flex h-full min-h-[60px] w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50',
          state === 'found' && 'border-success/40 bg-success-soft',
          state === 'default' && 'bg-card',
          state === 'missing' && 'border-dashed border-muted-foreground/50 bg-transparent hover:bg-card',
          state === 'invalid' && 'border-destructive/50 bg-destructive-soft',
        )}
      >
        {state === 'found' ? (
          <CheckIcon className="size-5 shrink-0 text-success" aria-hidden="true" />
        ) : state === 'invalid' ? (
          <CircleAlertIcon className="size-5 shrink-0 text-destructive" aria-hidden="true" />
        ) : state === 'default' ? (
          <CircleDotIcon className="size-5 shrink-0 text-ink-2" aria-hidden="true" />
        ) : (
          <PlusIcon className="size-5 shrink-0 rounded-full border border-dashed border-muted-foreground p-0.5 text-ink-2" aria-hidden="true" />
        )}
        <span className="flex min-w-0 flex-col">
          <span className="text-[12px] text-ink-2">{field.label}</span>
          {/* Wraps instead of cutting off ("Add a pla…") in the narrow phone columns. */}
          <span className={cn('line-clamp-2 font-semibold [overflow-wrap:anywhere]', state === 'missing' && 'text-ink-2')}>
            {state === 'missing' ? `Add ${field.addLabel}` : field.value}
          </span>
          {state === 'invalid' && field.problem && <span className="text-[12px] font-medium text-destructive">{field.problem}</span>}
        </span>
      </button>
    </li>
  );
}

/** Weather, currency and local time of a recognised destination (from the agent's trip-context lookup). */
function DestinationPreview({ destination, origin }: { destination: string; origin: string | null }) {
  const { status, data } = useTripContext(destination, origin);
  const now = useNow(30_000, data !== null);
  if (status !== 'ready' || !data) return null;

  const time =
    data.timeZone && now
      ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: data.timeZone }).format(now)
      : null;
  const items = [
    data.weather && { icon: CloudSunIcon, label: 'Weather', text: `${Math.round(data.weather.temperatureC)}°C · ${data.weather.condition}` },
    data.currency && {
      icon: CoinsIcon,
      label: 'Currency',
      text: data.exchangeRate ? `${data.currency.code} · $1 = ${data.exchangeRate.rate.toFixed(2)} ${data.currency.code}` : data.currency.code,
    },
    time ? { icon: ClockIcon, label: 'Local time', text: time } : null,
  ].filter((item): item is NonNullable<typeof item> => !!item);
  if (items.length === 0) return null;

  return (
    <section aria-label={`About ${data.location}`} className="flex flex-col gap-2 rounded-xl border bg-card p-4">
      <h2 className="font-semibold">{data.location}</h2>
      <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {items.map(({ icon: Icon, label, text }) => (
          <li key={label} className="flex items-center gap-2">
            <Icon className="size-4 text-ink-2" aria-hidden="true" />
            <span className="sr-only">{label}: </span>
            {text}
          </li>
        ))}
      </ul>
    </section>
  );
}
