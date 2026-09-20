'use client';

import { useRouter } from 'next/navigation';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { useTranslations } from '@/lib/useTranslations';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/PageHeader';
import { PageContainer } from '@/components/layout/PageContainer';
import { ClassroomCreateForm } from '@/components/ClassroomCreateForm';

/**
 * Thin wrapper around ClassroomCreateForm — the form itself moved to
 * components/ClassroomCreateForm.tsx (TASK 08) so the Classes tab can embed
 * it inline without navigating here. This route stays for any existing
 * link/CTA that still points at /classroom/create directly.
 */
export default function CreateClassroomPage() {
  const router = useRouter();
  const { ready } = useRequireAuth();
  const t = useTranslations('classroomCreate');

  if (!ready) return null;

  return (
    <AppShell showNav={false}>
      <PageHeader title={t('title')} showBack />
      <PageContainer>
        <ClassroomCreateForm onDone={(globalId) => router.push(`/classroom/${globalId}`)} />
      </PageContainer>
    </AppShell>
  );
}
