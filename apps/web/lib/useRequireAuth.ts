'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';

/**
 * Auth guard for any protected page — redirects to /auth/login the moment
 * it's clear the visitor isn't logged in.
 *
 * AuthProvider itself already withholds rendering its children until it's
 * finished reading localStorage on mount (see its own `ready` state), so
 * by the time this hook runs at all, `isLoggedIn` is already resolved —
 * there's no separate loading phase to track here. `ready` is returned
 * anyway so a page's render logic reads the same either way regardless of
 * why content isn't shown yet (never logged in vs. mid-redirect).
 */
export function useRequireAuth(): { ready: boolean } {
  const router = useRouter();
  const { isLoggedIn } = useAuth();

  useEffect(() => {
    if (!isLoggedIn) router.replace('/auth/login');
  }, [isLoggedIn, router]);

  return { ready: isLoggedIn };
}
