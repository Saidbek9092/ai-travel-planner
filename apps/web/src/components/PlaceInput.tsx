'use client';

import type { PlaceSuggestion } from '@ai-travel/contracts';
import { FlagIcon, Loader2Icon, MapPinIcon, MapIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { Input } from '@/components/ui/input';
import { usePlaceSearch } from '@/hooks/usePlaceSearch';
import { cn } from '@/lib/utils';

const ICONS = { country: FlagIcon, region: MapIcon, city: MapPinIcon } as const;

interface PlaceInputProps {
  id: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  /** Enter / pick: save the text. */
  onCommit: (value: string) => void;
  /** Escape: leave without saving. */
  onCancel: () => void;
  /** Focus left the input and the list: save what is typed. */
  onBlurCommit: (value: string) => void;
}

/** Text input with a searchable list of cities and countries. Typing a name that is not listed still works. */
export function PlaceInput({ id, value, placeholder, onChange, onCommit, onCancel, onBlurCommit }: PlaceInputProps) {
  const listId = useId();
  const [open, setOpen] = useState(true);
  const [active, setActive] = useState(-1);
  const { places, loading } = usePlaceSearch(value);
  const showList = open && value.trim().length >= 2;
  const activeId = active >= 0 && active < places.length ? `${listId}-${active}` : undefined;

  const pick = (place: PlaceSuggestion) => {
    onChange(place.label);
    onCommit(place.label);
  };

  return (
    <div className="relative">
      <Input
        id={id}
        autoFocus
        role="combobox"
        autoComplete="off"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        value={value}
        placeholder={placeholder}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && places.length > 0) {
            event.preventDefault();
            setOpen(true);
            setActive((current) => (current + 1) % places.length);
          } else if (event.key === 'ArrowUp' && places.length > 0) {
            event.preventDefault();
            setActive((current) => (current <= 0 ? places.length - 1 : current - 1));
          } else if (event.key === 'Enter') {
            event.preventDefault();
            const place = places[active];
            if (showList && place) pick(place);
            else onCommit(value);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            if (showList && places.length > 0) setOpen(false);
            else onCancel();
          }
        }}
        onBlur={() => onBlurCommit(value)}
      />
      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Matching places"
          // Keep focus in the input so a click on a row does not blur (and so save) the field first.
          onMouseDown={(event) => event.preventDefault()}
          className="absolute top-full right-0 left-0 z-30 mt-1 max-h-64 min-w-60 overflow-auto rounded-xl border bg-card p-1 shadow-lg"
        >
          {places.map((place, index) => {
            const Icon = ICONS[place.kind];
            return (
              <li
                key={place.label}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                onClick={() => pick(place)}
                onMouseMove={() => setActive(index)}
                className={cn('flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm', index === active && 'bg-primary-soft')}
              >
                <Icon className="size-4 shrink-0 text-ink-2" aria-hidden="true" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-semibold">{place.name}</span>
                  {place.detail && <span className="truncate text-[12px] text-ink-2">{place.detail}</span>}
                </span>
              </li>
            );
          })}
          {places.length === 0 && (
            <li role="presentation" className="flex items-center gap-2 px-2.5 py-2 text-sm text-ink-2">
              {loading ? <Loader2Icon className="size-4 animate-spin" aria-hidden="true" /> : null}
              {loading ? 'Searching…' : 'No match. Press Enter to use what you typed.'}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
