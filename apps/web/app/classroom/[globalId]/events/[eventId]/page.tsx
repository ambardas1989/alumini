'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import styles from '../../page.module.css';

/**
 * TASKS_09 TASK 11 FIX 2 — a direct event deep link
 * (/classroom/[globalId]/events/[eventId]) didn't exist at all before this;
 * clicking one 404'd. Rather than duplicating the main classroom page's
 * loading/membership-check/join-prompt logic here (a second copy that could
 * drift out of sync with it), this redirects straight into that same page
 * with ?eventId= — the query param it already reads (see its own
 * deepLinkedEventId effect) to open the events list with this event
 * highlighted once membership is confirmed. A non-member still lands on
 * the exact same join prompt the main page shows, for the same reason.
 */
export default function EventDeepLinkPage() {
  const params = useParams<{ globalId: string; eventId: string }>();
  const router = useRouter();

  useEffect(() => {
    router.replace(`/classroom/${params.globalId}?eventId=${params.eventId}`);
  }, [params.globalId, params.eventId, router]);

  return (
    <AppShell showNav={false}>
      <div className={styles.centeredLoading}>
        <LoadingSpinner size="lg" />
      </div>
    </AppShell>
  );
}
