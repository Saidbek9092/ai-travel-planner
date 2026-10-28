import { BedDoubleIcon } from 'lucide-react';
import { dayColor } from '@/lib/labels';
import { cn } from '@/lib/utils';

/**
 * A stop pin: numbered and full size for the selected day, small and grey for other days (`muted`),
 * small in the day's colour when every day is shown (`dot`). The number keeps a day from depending on hue alone.
 */
export function StopPin({
  day,
  index,
  name,
  look,
  showLabel,
  onClick,
}: {
  day: number;
  index: number;
  name: string;
  look: 'numbered' | 'dot' | 'muted';
  showLabel: boolean;
  onClick?: () => void;
}) {
  return (
    <span className="relative flex items-center">
      <button
        type="button"
        onClick={onClick}
        aria-label={`${name}, day ${day}, stop ${index + 1}`}
        className={cn(
          'flex items-center justify-center rounded-full font-semibold text-white outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
          look === 'numbered' && 'size-8 text-sm shadow-md ring-[3px] ring-white',
          look === 'dot' && 'size-3.5 ring-2 ring-white',
          look === 'muted' && 'size-3 bg-[#8A97A8] ring-2 ring-white',
        )}
        style={look === 'muted' ? undefined : { backgroundColor: dayColor(day) }}
      >
        {look === 'numbered' && index + 1}
      </button>
      {showLabel && (
        <span className="pointer-events-none absolute left-full ml-1.5 text-[15px] font-semibold whitespace-nowrap text-foreground [text-shadow:0_0_3px_white,0_0_3px_white,0_0_3px_white]">
          {name}
        </span>
      )}
    </span>
  );
}

/** Hotel marker: start and end of every day. */
export function HotelPin({ name, showLabel }: { name: string; showLabel: boolean }) {
  return (
    <span className="relative flex items-center" title={name}>
      <span className="flex size-9 items-center justify-center rounded-lg bg-foreground text-white shadow-md ring-2 ring-white">
        <BedDoubleIcon className="size-4" aria-label={`Hotel: ${name}`} />
      </span>
      {showLabel && (
        <span className="pointer-events-none absolute left-full ml-2 text-[15px] font-semibold text-foreground [text-shadow:0_0_3px_white,0_0_3px_white]">
          Hotel
        </span>
      )}
    </span>
  );
}
