'use client';

import { RotateCcwIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-4 p-6">
      <Alert variant="destructive">
        <AlertTitle>Something went wrong</AlertTitle>
        <AlertDescription>The page failed to load. Your trip is safe — try again.</AlertDescription>
      </Alert>
      <Button className="self-start" onClick={reset}>
        <RotateCcwIcon aria-hidden="true" /> Try again
      </Button>
    </main>
  );
}
