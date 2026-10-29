'use client';

import { LogOutIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { notify } from '@/components/Notice';
import { Button } from '@/components/ui/button';
import { useSession } from '@/hooks/useSession';
import { signInWithGoogle, signOut } from '@/lib/auth';
import { env } from '@/lib/env';

const GSI_SCRIPT = 'https://accounts.google.com/gsi/client';

interface GoogleIdentity {
  accounts: {
    id: {
      initialize: (config: { client_id: string; callback: (response: { credential: string }) => void }) => void;
      renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
    };
  };
}

let scriptPromise: Promise<GoogleIdentity> | null = null;

/** Loads Google Identity Services once. */
function loadGoogle(): Promise<GoogleIdentity> {
  const ready = (window as unknown as { google?: GoogleIdentity }).google;
  if (ready) return Promise.resolve(ready);
  scriptPromise ??= new Promise<GoogleIdentity>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GSI_SCRIPT;
    script.async = true;
    script.onload = () => resolve((window as unknown as { google: GoogleIdentity }).google);
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error('Google sign-in could not load'));
    };
    document.head.append(script);
  });
  return scriptPromise;
}

async function onCredential(credential: string) {
  const result = await signInWithGoogle(credential);
  if (!result.ok) {
    notify('error', 'Could not sign in', { description: result.message });
    return;
  }
  notify('success', `Signed in as ${result.user.email}`, {
    ...(result.claimed > 0 && { description: `${result.claimed} ${result.claimed === 1 ? 'trip' : 'trips'} from this browser ${result.claimed === 1 ? 'is' : 'are'} now in your account.` }),
  });
}

/** Google's own button (their branding rules), icon-only on phones so the header does not overflow. */
export function GoogleSignInButton({ clientId, alwaysWide = false }: { clientId: string; alwaysWide?: boolean }) {
  const slot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    loadGoogle()
      .then((google) => {
        if (cancelled || !slot.current) return;
        google.accounts.id.initialize({ client_id: clientId, callback: (response) => void onCredential(response.credential) });
        const wide = alwaysWide || window.matchMedia('(min-width: 640px)').matches;
        google.accounts.id.renderButton(slot.current, wide ? { type: 'standard', theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill' } : { type: 'icon', theme: 'outline', size: 'large', shape: 'circle' });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [clientId, alwaysWide]);
  // Reserve the button's height so the header does not jump when Google's script draws it.
  return <div ref={slot} className="flex h-10 min-w-10 items-center pointer-coarse:h-11" aria-label="Sign in with Google" />;
}

/** Header: "Sign in with Google" for a guest, the account and "Sign out" once signed in. Hidden when sign-in is not set up. */
export function AccountMenu() {
  const session = useSession();
  if (env.agentUrl === null || env.googleClientId === null) return null;

  if (!session) return <GoogleSignInButton clientId={env.googleClientId} />;

  const { user } = session;
  return (
    <div className="flex items-center gap-2">
      {user.picture ? (
        // eslint-disable-next-line @next/next/no-img-element -- Google profile photo, a small remote avatar
        <img src={user.picture} alt="" referrerPolicy="no-referrer" width={32} height={32} className="size-8 rounded-full" />
      ) : (
        <span className="flex size-8 items-center justify-center rounded-full bg-muted text-sm font-semibold" aria-hidden="true">
          {(user.name ?? user.email).slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="max-w-40 truncate text-[14px] text-ink-2 max-lg:sr-only">{user.name ?? user.email}</span>
      <Button
        variant="outline"
        className="h-10 pointer-coarse:h-11"
        aria-label="Sign out"
        onClick={() => {
          signOut();
          notify('success', 'Signed out');
        }}
      >
        <LogOutIcon aria-hidden="true" />
        <span className="max-sm:sr-only">Sign out</span>
      </Button>
    </div>
  );
}
