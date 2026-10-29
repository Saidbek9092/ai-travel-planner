/** Id of each page's `<main>`, the target of the "Skip to main content" link in `layout.tsx`. */
export const MAIN_ID = 'main';

/** Id of the empty slot in the header (`layout.tsx`) that `TripActions` renders into. */
export const HEADER_ACTIONS_ID = 'header-actions';

/** Fired by "Plan a trip" so an open dashboard resets to the form (same URL, so no remount). */
export const NEW_TRIP_EVENT = 'ai-travel:new-trip';

const TABBABLE = 'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * Keeps Tab and Shift+Tab cycling inside a modal (`onKeyDown` on its popup). Base UI's focus guards let focus slip out
 * after the first wrap, so the modal wraps it itself.
 */
export function keepTabInside(event: { key: string; shiftKey: boolean; currentTarget: HTMLElement; preventDefault: () => void }) {
  if (event.key !== 'Tab') return;
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>(TABBABLE)];
  const first = items[0];
  const last = items.at(-1);
  if (!first || !last) return;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !event.currentTarget.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !event.currentTarget.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}
