import { useCallback, useEffect, useRef, useState } from 'react';

/** Auto-scroll a feed to the bottom unless the user scrolled up; `jumpToLatest` re-sticks it. */
export function useStickToBottom(changeKey: number) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(true);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport && stuck) viewport.scrollTop = viewport.scrollHeight;
  }, [changeKey, stuck]);

  const onScroll = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    setStuck(viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 24);
  }, []);

  const jumpToLatest = useCallback(() => {
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
    setStuck(true);
  }, []);

  return { viewportRef, stuck, onScroll, jumpToLatest };
}
