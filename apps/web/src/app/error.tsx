'use client';

import { RotateCcwIcon } from 'lucide-react';
import { Notice } from '@/components/Notice';
import { Button } from '@/components/ui/button';
import { MAIN_ID } from '@/lib/dom';

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id={MAIN_ID} tabIndex={-1} className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-4 p-6 outline-none">
      <Notice tone="error" title="This page didn't load">
        Your trip is safe. Try again.
      </Notice>
      <Button className="self-start" onClick={reset}>
        <RotateCcwIcon aria-hidden="true" /> Try again
      </Button>
    </main>
  );
}
