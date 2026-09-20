'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as api from '@/lib/api';
import type { ClassroomMember } from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { useTranslations } from '@/lib/useTranslations';
import { useToast } from '@/components/providers/ToastProvider';
import { Avatar } from '@/components/ui/Avatar';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { SheetModal } from '@/components/ui/SheetModal';
import styles from './MemberListModal.module.css';

interface MemberListModalProps {
  classroomId: string;
  members: ClassroomMember[];
  currentUserId: string;
  viewerIsVerified: boolean;
  /** classroom.createdBy — the one member who gets the 'creator' badge alongside their role. */
  creatorId?: string | null;
  onClose: () => void;
}

type Filter = 'all' | 'verified' | 'pending';

const ROLE_VARIANT: Record<string, BadgeVariant> = {
  student: 'student',
  teacher: 'teacher',
  admin: 'admin',
};

export function MemberListModal({
  classroomId,
  members,
  currentUserId,
  viewerIsVerified,
  creatorId,
  onClose,
}: MemberListModalProps) {
  const router = useRouter();
  const t = useTranslations('classroom.memberList');
  const tStatus = useTranslations('status');
  const { showToast } = useToast();
  const [filter, setFilter] = useState<Filter>('all');
  const [vouchedIds, setVouchedIds] = useState<Set<string>>(new Set());
  const [vouchingId, setVouchingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (filter === 'all') return members;
    return members.filter((m) => m.verificationStatus === filter);
  }, [members, filter]);

  const handleVouch = async (member: ClassroomMember) => {
    setVouchingId(member.userId);
    try {
      await api.vouch(member.userId, classroomId);
      setVouchedIds((prev) => new Set(prev).add(member.userId));
      showToast(t('vouchSent', { name: member.fullName ?? '' }), 'success');
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setVouchingId(null);
    }
  };

  return (
    <SheetModal title={t('title', { count: members.length })} onClose={onClose}>
      <div className={styles.filters} role="tablist">
        {(['all', 'verified', 'pending'] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={filter === option}
            className={`${styles.filterTab} ${filter === option ? styles.filterTabActive : ''}`}
            onClick={() => setFilter(option)}
          >
            {t(`filter.${option}`)}
          </button>
        ))}
      </div>

      <ul className={styles.list}>
        {filtered.map((member) => {
          const isSelf = member.userId === currentUserId;
          const canVouch =
            viewerIsVerified && !isSelf && member.verificationStatus === 'pending';
          const alreadyVouched = vouchedIds.has(member.userId);

          return (
            <li key={member.userId} className={styles.row}>
              <Avatar avatarUrl={member.avatarUrl} fullName={member.fullName ?? '?'} size="md" />
              <div className={styles.info}>
                <p className={styles.name}>
                  {member.fullName}
                  {isSelf && <span className={styles.youTag}>{t('you')}</span>}
                </p>
                <div className={styles.badgeRow}>
                  {member.userId === creatorId && <Badge variant="creator" label={tStatus('creator')} size="sm" />}
                  <Badge variant={ROLE_VARIANT[member.role] ?? 'student'} label={tStatus(member.role)} size="sm" />
                  <Badge
                    variant={member.verificationStatus as BadgeVariant}
                    label={tStatus(member.verificationStatus)}
                    size="sm"
                  />
                </div>
              </div>
              <div className={styles.actions}>
                {canVouch && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={alreadyVouched}
                    loading={vouchingId === member.userId}
                    onClick={() => handleVouch(member)}
                  >
                    {alreadyVouched ? t('vouched') : t('vouchFor', { name: member.fullName ?? '' })}
                  </Button>
                )}
                {!isSelf && (
                  <Button variant="ghost" size="sm" onClick={() => router.push(`/messages?userId=${member.userId}`)}>
                    {t('message')}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </SheetModal>
  );
}
