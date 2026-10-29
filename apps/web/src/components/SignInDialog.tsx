'use client';

import { GoogleSignInButton } from '@/components/AccountMenu';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { keepTabInside } from '@/lib/dom';

/** Shown when a guest presses "Plan my trip": the trip waits while they sign in, then planning starts by itself. */
export function SignInDialog({ open, onOpenChange, clientId }: { open: boolean; onOpenChange: (open: boolean) => void; clientId: string }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onKeyDown={keepTabInside}>
        <DialogTitle>Sign in to plan your trip</DialogTitle>
        <DialogDescription>
          Sign in with Google and the five agents start right away. Your trip details are kept, and the finished trip is saved to your account.
        </DialogDescription>
        <div className="flex justify-center py-2">
          <GoogleSignInButton clientId={clientId} alwaysWide />
        </div>
      </DialogContent>
    </Dialog>
  );
}
