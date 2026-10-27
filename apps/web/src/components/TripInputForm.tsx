'use client';

import { TripRequestSchema, type TripRequest } from '@ai-travel/contracts';
import { ChevronDownIcon, SendIcon } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

const MAX_PROMPT = 1000;

const EXAMPLES = [
  'Weekend in Istanbul, $600',
  '7 days in Tokyo, $2,500',
  '5 days in Paris from Tashkent, $1,000 budget',
];

interface FormValues {
  prompt: string;
  origin: string;
  budget: string;
  durationDays: string;
  startDate: string;
}

/** Drops empty optional fields and coerces numbers, so the payload never holds `""` or `NaN`. */
export function toRequest(values: FormValues): Record<string, unknown> {
  const request: Record<string, unknown> = { prompt: values.prompt };
  if (values.origin.trim()) request.origin = values.origin.trim();
  if (values.budget.trim()) request.budget = Number(values.budget);
  if (values.durationDays.trim()) request.durationDays = Number(values.durationDays);
  if (values.startDate) request.startDate = values.startDate;
  return request;
}

interface TripInputFormProps {
  onSubmit: (request: TripRequest) => void;
  disabled: boolean;
}

export function TripInputForm({ onSubmit, disabled }: TripInputFormProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const {
    control,
    handleSubmit,
    setValue,
    setError,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: { prompt: '', origin: '', budget: '', durationDays: '', startDate: '' },
  });
  const promptLength = useWatch({ control, name: 'prompt' }).length;

  const submit = handleSubmit((values) => {
    const parsed = TripRequestSchema.safeParse(toRequest(values));
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === 'string' && key in values) {
          setError(key as keyof FormValues, { message: issue.message });
          if (key !== 'prompt') setDetailsOpen(true);
        }
      }
      return;
    }
    if (parsed.data.startDate && parsed.data.startDate < new Date().toISOString().slice(0, 10)) {
      setError('startDate', { message: 'Pick a start date that is today or later.' });
      setDetailsOpen(true);
      return;
    }
    onSubmit(parsed.data);
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <FieldGroup>
        <Controller
          name="prompt"
          control={control}
          render={({ field }) => (
            <Field data-invalid={!!errors.prompt}>
              <FieldLabel htmlFor="prompt">Describe your trip</FieldLabel>
              <Textarea
                {...field}
                id="prompt"
                rows={4}
                maxLength={MAX_PROMPT}
                disabled={disabled}
                aria-invalid={!!errors.prompt}
                aria-describedby="prompt-count prompt-error"
                placeholder="5 days in Paris from Tashkent, $1,000 budget"
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    void submit();
                  }
                }}
              />
              <div className="flex justify-between gap-2 text-xs text-muted-foreground">
                <span id="prompt-error">
                  {errors.prompt && <FieldError errors={[{ message: promptMessage(promptLength, errors.prompt.message) }]} />}
                </span>
                <span id="prompt-count">
                  {promptLength} / {MAX_PROMPT}
                </span>
              </div>
            </Field>
          )}
        />
      </FieldGroup>

      <ul className="flex flex-wrap gap-2" aria-label="Example prompts">
        {EXAMPLES.map((example) => (
          <li key={example}>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => setValue('prompt', example, { shouldValidate: false })}
            >
              {example}
            </Button>
          </li>
        ))}
      </ul>

      <div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={detailsOpen}
          aria-controls="trip-details"
          onClick={() => setDetailsOpen((open) => !open)}
        >
          Details <ChevronDownIcon className={detailsOpen ? 'rotate-180' : ''} aria-hidden="true" />
        </Button>
        <div id="trip-details" hidden={!detailsOpen} className="mt-2 grid gap-4 sm:grid-cols-2">
          <DetailField name="origin" label="From" control={control} error={errors.origin?.message} disabled={disabled} />
          <DetailField name="durationDays" label="Days" type="number" min={1} max={30} control={control} error={errors.durationDays?.message} disabled={disabled} />
          <DetailField name="budget" label="Budget, USD" type="number" min={1} control={control} error={errors.budget?.message} disabled={disabled} />
          <DetailField name="startDate" label="Start date" type="date" control={control} error={errors.startDate?.message} disabled={disabled} />
        </div>
      </div>

      <Button type="submit" disabled={disabled} className="self-start">
        <SendIcon aria-hidden="true" /> Plan my trip
      </Button>
    </form>
  );
}

function promptMessage(length: number, fallback?: string): string {
  return length < 3 ? 'Describe your trip in at least a few words.' : (fallback ?? 'Check your description.');
}

function DetailField({
  name,
  label,
  control,
  error,
  disabled,
  ...inputProps
}: {
  name: Exclude<keyof FormValues, 'prompt'>;
  label: string;
  control: ReturnType<typeof useForm<FormValues>>['control'];
  error?: string;
  disabled: boolean;
} & Omit<React.ComponentProps<'input'>, 'name'>) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field }) => (
        <Field data-invalid={!!error}>
          <FieldLabel htmlFor={name}>{label}</FieldLabel>
          <Input {...field} {...inputProps} id={name} disabled={disabled} aria-invalid={!!error} aria-describedby={error ? `${name}-error` : undefined} />
          {error && <FieldError id={`${name}-error`} errors={[{ message: error }]} />}
        </Field>
      )}
    />
  );
}
