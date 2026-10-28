'use client';

import { TripRequestSchema, type Interest, type TripRequest } from '@ai-travel/contracts';
import { ArrowRightIcon, CheckIcon, CircleDotIcon, CloudSunIcon, CoinsIcon, ClockIcon, InfoIcon, PlusIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Notice } from '@/components/Notice';
import { PlaceInput } from '@/components/PlaceInput';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { formatCountdown, useCountdown } from '@/hooks/useCountdown';
import { useHomeCity } from '@/hooks/useHomeCity';
import { useNow } from '@/hooks/useNow';
import { useTripContext } from '@/hooks/useTripContext';
import { MONTH_NAMES, parseTrip, startDateForMonth } from '@/lib/parseTrip';
import { cn, formatUsd } from '@/lib/utils';

const MAX_PROMPT = 1000;
const WARN_AT = 900;
const DEBOUNCE_MS = 300;

const EXAMPLES = [
  { title: 'Istanbul', price: '$600', blurb: 'A weekend from Tashkent · street food and the Bosphorus', prompt: 'Weekend in Istanbul from Tashkent, $600. Street food and the Bosphorus.' },
  { title: 'Paris', price: '$1,000', blurb: '5 days from Tashkent in mid-November · museums and food', prompt: '5 days in Paris from Tashkent in November, $1,000. Museums and good food.' },
  { title: 'Tokyo', price: '$2,500', blurb: '7 days from Tashkent · temples and food markets', prompt: '7 days in Tokyo from Tashkent, $2,500. Temples and food markets.' },
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
type FieldState = 'found' | 'default' | 'missing';

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
  /** Extra cards under the examples (right column). */
  aside?: ReactNode;
}

/** The start page's input: one sentence, the fields the agents understood from it, interests and examples. */
export function TripInputForm({ onSubmit, disabled, retryAt, notices, aside }: TripInputFormProps) {
  const waitSeconds = useCountdown(retryAt);
  const { homeCity, setHomeCity } = useHomeCity();
  const [prompt, setPrompt] = useState('');
  const [settled, setSettled] = useState('');
  const [overrides, setOverrides] = useState<Overrides>({});
  const [editing, setEditing] = useState<FieldKey | null>(null);
  const [interests, setInterests] = useState<Interest[]>([]);
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
    { key: 'days', label: 'How long', value: validDays ? `${validDays} ${validDays === 1 ? 'day' : 'days'}` : null, state: validDays ? 'found' : 'missing', editValue: daysText ?? '', placeholder: 'Days, 1–30', addLabel: 'days', inputMode: 'numeric' },
    { key: 'budget', label: 'Budget, all-in', value: validBudget ? formatUsd(validBudget) : null, state: validBudget ? 'found' : 'missing', editValue: budgetText ?? '', placeholder: 'USD, total', addLabel: 'a budget', inputMode: 'numeric' },
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
    ...(validDays ? [] : ['how long']),
    ...(validBudget ? [] : ['your budget']),
  ];
  const helper =
    missing.length === 0
      ? 'Ready. The five agents start as soon as you press Plan.'
      : `Tell us ${missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(', ')} and ${missing.at(-1)}`} to start.`;

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

  const toggleInterest = (interest: Interest) =>
    setInterests((current) => (current.includes(interest) ? current.filter((i) => i !== interest) : [...current, interest]));

  const submit = () => {
    if (disabled || waitSeconds > 0 || missing.length > 0) return;
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

  const canPlan = missing.length === 0 && !disabled && waitSeconds === 0;

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] lg:items-start"
    >
      <div className="flex min-w-0 flex-col gap-6">
        {notices}
      <div className="flex flex-col gap-6 rounded-2xl border bg-card p-6 shadow-sm">
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
            placeholder="e.g. 5 days in Paris from Tashkent in mid-November, $1,000 all-in. Museums and good food."
            className="min-h-[100px] resize-none rounded-xl bg-card px-5 py-4 text-[20px] leading-snug md:text-[20px]"
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
            <span className="text-[13px] text-ink-2">Click any item to change it</span>
          </div>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {fields.map((field) => (
              <UnderstoodField
                key={field.key}
                field={field}
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
                  className={cn('h-10 rounded-full bg-card px-4 text-[14px]', on && 'border-primary bg-primary-soft text-primary')}
                >
                  {on && <CheckIcon aria-hidden="true" />} {label}
                </Button>
              );
            })}
          </div>
        </fieldset>

        <div className="flex flex-wrap items-center justify-between gap-4 border-t pt-5">
          <p id={`${promptId}-helper`} className="flex items-center gap-2 text-sm text-ink-2" aria-live="polite">
            <InfoIcon className="size-4 shrink-0" aria-hidden="true" /> {helper}
          </p>
          <Button type="submit" disabled={!canPlan} aria-describedby={`${promptId}-helper`} className="h-12 px-6 text-[16px] disabled:bg-border disabled:text-ink-2 disabled:opacity-100">
            {waitSeconds > 0 ? `Plan in ${formatCountdown(waitSeconds)}` : 'Plan my trip'} <ArrowRightIcon aria-hidden="true" />
          </Button>
        </div>
        {waitSeconds > 0 && (
          <Notice tone="info" placement="inline" title={`You can plan another trip in ${formatCountdown(waitSeconds)}`}>
            Lots of trips are being planned right now. Your prompt is kept.
          </Notice>
        )}
      </div>

      </div>

      <div className="flex min-w-0 flex-col gap-6">
        <section aria-labelledby={`${promptId}-examples`} className="flex flex-col gap-4 rounded-2xl border bg-card p-6 shadow-sm">
          <div>
            <h2 id={`${promptId}-examples`} className="text-lg font-semibold">
              Not sure where to start?
            </h2>
            <p className="text-sm text-ink-2">Pick one: it fills the form, and you can edit it after.</p>
          </div>
          <ul className="flex flex-col gap-3">
            {EXAMPLES.map((example) => (
              <li key={example.title}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => fill(example.prompt)}
                  className="group flex w-full flex-col gap-1 rounded-xl border bg-card p-4 text-left outline-none transition-colors hover:border-primary hover:bg-primary-soft/40 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-[17px] font-semibold">{example.title}</span>
                    <span className="font-mono text-sm font-semibold">{example.price}</span>
                  </span>
                  <span className="text-[13px] text-ink-2">{example.blurb}</span>
                  <span className="flex items-center gap-1 pt-1 text-[13px] font-semibold text-primary">
                    Use this <ArrowRightIcon className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
        {aside}
      </div>
    </form>
  );
}

function UnderstoodField({
  field,
  editing,
  disabled,
  onEdit,
  onClose,
  onChange,
}: {
  field: FieldView;
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
        aria-label={state === 'missing' ? `Add ${field.addLabel}` : `${field.label}: ${field.value}. Edit`}
        className={cn(
          'flex h-full min-h-[60px] w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50',
          state === 'found' && 'border-success/40 bg-success-soft',
          state === 'default' && 'bg-card',
          state === 'missing' && 'border-dashed border-muted-foreground/50 bg-transparent hover:bg-card',
        )}
      >
        {state === 'found' ? (
          <CheckIcon className="size-5 shrink-0 text-success" aria-hidden="true" />
        ) : state === 'default' ? (
          <CircleDotIcon className="size-5 shrink-0 text-ink-2" aria-hidden="true" />
        ) : (
          <PlusIcon className="size-5 shrink-0 rounded-full border border-dashed border-muted-foreground p-0.5 text-ink-2" aria-hidden="true" />
        )}
        <span className="flex min-w-0 flex-col">
          <span className="text-[12px] text-ink-2">{field.label}</span>
          <span className={cn('truncate font-semibold', state === 'missing' && 'text-ink-2')}>
            {state === 'missing' ? `Add ${field.addLabel}` : field.value}
          </span>
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
