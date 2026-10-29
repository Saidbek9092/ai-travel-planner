'use client';

import { MAIN_ID } from '@/lib/dom';

/**
 * "Skip to main content", the first Tab stop on every page. Next.js keeps pages the user left in the DOM (hidden), so
 * there can be more than one `<main id="main">`: focus the visible one rather than trust the `#main` jump.
 */
export function SkipLink() {
  return (
    <a
      href={`#${MAIN_ID}`}
      onClick={(event) => {
        const main = [...document.querySelectorAll<HTMLElement>(`main#${MAIN_ID}`)].find((el) => el.getClientRects().length > 0);
        if (!main) return;
        event.preventDefault();
        main.focus();
      }}
      // Above the viewport until focused.
      className="fixed top-3 left-3 z-[60] -translate-y-20 rounded-lg bg-card px-4 py-2.5 font-medium shadow-lg ring-3 ring-ring/50 outline-none focus:translate-y-0"
    >
      Skip to main content
    </a>
  );
}
