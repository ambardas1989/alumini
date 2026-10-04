'use client';

import { useCallback, useEffect, useState } from 'react';
import * as api from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { safeFormatDate } from '@/lib/format';
import { useDebounce } from '@/lib/useDebounce';
import { useTranslations } from '@/lib/useTranslations';
import { SkeletonCard } from '@/components/ui/SkeletonCard';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import { EmptyState } from '@/components/ui/EmptyState';
import { Avatar } from '@/components/ui/Avatar';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { SheetModal } from '@/components/ui/SheetModal';
import tabStyles from './Tab.module.css';
import styles from './MembersTab.module.css';

interface MembersTabProps {
  institutionId: string;
}

const PAGE_SIZE = 50;

/** TASKS_11 TASK 09 — ADAPTED onto /admin as a new tab (see page.tsx's own comment) rather than a separate /institution-admin/[institutionId]/members route. */
export function MembersTab({ institutionId }: MembersTabProps) {
  const t = useTranslations('adminDashboard.members');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [members, setMembers] = useState<api.InstitutionMemberRow[]>([]);
  const [total, setTotal] = useState(0);
  const [classrooms, setClassrooms] = useState<api.AdminClassroomEntry[]>([]);

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [classroomId, setClassroomId] = useState('');
  const [role, setRole] = useState('');
  const [verificationStatus, setVerificationStatus] = useState('');
  const [page, setPage] = useState(0);

  const [detailUserId, setDetailUserId] = useState<string | null>(null);
  const [detail, setDetail] = useState<api.InstitutionMemberDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadClassrooms = useCallback(async () => {
    try {
      const yearGroups = await api.getClassrooms(institutionId);
      setClassrooms(yearGroups.flatMap((g) => g.classrooms));
    } catch {
      // Non-fatal — the classroom filter dropdown just stays empty.
    }
  }, [institutionId]);

  useEffect(() => {
    loadClassrooms();
  }, [loadClassrooms]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.listInstitutionMembers(institutionId, {
        classroomId: classroomId || undefined,
        role: (role as 'student' | 'teacher' | 'admin') || undefined,
        verificationStatus: verificationStatus || undefined,
        search: debouncedSearch.trim() || undefined,
        page,
        limit: PAGE_SIZE,
      });
      setMembers(result.members);
      setTotal(result.total);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [institutionId, classroomId, role, verificationStatus, debouncedSearch, page]);

  useEffect(() => {
    setPage(0);
  }, [classroomId, role, verificationStatus, debouncedSearch]);

  useEffect(() => {
    load();
  }, [load]);

  const handleOpenDetail = async (userId: string) => {
    setDetailUserId(userId);
    setDetailLoading(true);
    try {
      setDetail(await api.getInstitutionMemberDetail(institutionId, userId));
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <div className={styles.filterBar}>
        <Input label={t('searchLabel')} placeholder={t('searchPlaceholder')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select label={t('classroomLabel')} value={classroomId} onChange={(e) => setClassroomId(e.target.value)}>
          <option value="">{t('allClassrooms')}</option>
          {classrooms.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select label={t('roleLabel')} value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">{t('roleAll')}</option>
          <option value="student">{t('roleStudent')}</option>
          <option value="teacher">{t('roleTeacher')}</option>
          <option value="admin">{t('roleAdmin')}</option>
        </Select>
        <Select label={t('verificationLabel')} value={verificationStatus} onChange={(e) => setVerificationStatus(e.target.value)}>
          <option value="">{t('verificationAll')}</option>
          <option value="verified">{t('verificationVerified')}</option>
          <option value="pending">{t('verificationPending')}</option>
          <option value="rejected">{t('verificationRejected')}</option>
        </Select>
      </div>

      {loading ? (
        <>
          <SkeletonCard />
          <SkeletonCard />
        </>
      ) : error ? (
        <ErrorMessage message={error} onRetry={load} fullPage />
      ) : members.length === 0 ? (
        <EmptyState icon="🧑‍🎓" title={t('empty.title')} description={t('empty.description')} />
      ) : (
        <>
          {members.map((m) => (
            <button key={`${m.id}:${m.classroom?.id}`} type="button" className={styles.row} onClick={() => handleOpenDetail(m.id)}>
              <Avatar avatarUrl={m.avatarUrl} fullName={m.fullName ?? t('unknownMember')} size="md" />
              <span className={styles.rowText}>
                <span className={styles.rowName}>{m.fullName ?? t('unknownMember')}</span>
                <span className={styles.rowMeta}>
                  {m.email ?? ''} · {m.classroom?.name ?? ''}
                </span>
                <span className={styles.rowMeta}>
                  {t(`roleLabels.${m.role}`)} · <span className={`${styles.statusBadge} ${styles[`status_${m.verificationStatus}`] ?? ''}`}>{t(`verificationLabels.${m.verificationStatus}`)}</span> · {safeFormatDate(m.joinedAt)}
                </span>
              </span>
            </button>
          ))}

          <div className={styles.pagination}>
            <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              {t('prevPage')}
            </Button>
            <span className={styles.pageLabel}>{t('pageLabel', { page: page + 1, totalPages })}</span>
            <Button variant="secondary" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>
              {t('nextPage')}
            </Button>
          </div>
        </>
      )}

      {detailUserId && (
        <SheetModal title={t('detailModal.title')} onClose={() => setDetailUserId(null)}>
          {detailLoading ? (
            <SkeletonCard />
          ) : !detail ? (
            <ErrorMessage message={t('detailModal.loadError')} />
          ) : (
            <>
              <div className={styles.detailHeader}>
                <Avatar avatarUrl={detail.profile.avatar_url} fullName={detail.profile.full_name ?? t('unknownMember')} size="lg" />
                <div>
                  <p className={styles.rowName}>{detail.profile.full_name ?? t('unknownMember')}</p>
                  <p className={styles.rowMeta}>{detail.profile.email ?? ''}</p>
                </div>
              </div>
              {detail.profile.bio && <p className={styles.bio}>{detail.profile.bio}</p>}
              <p className={tabStyles.sectionLabel}>{t('detailModal.membershipsLabel')}</p>
              {detail.memberships.map((m, i) => (
                <div key={i} className={styles.membershipRow}>
                  <span>{m.classroom?.name ?? ''}</span>
                  <span className={styles.rowMeta}>
                    {t(`roleLabels.${m.role}`)} · {t(`verificationLabels.${m.verificationStatus}`)}
                  </span>
                </div>
              ))}
            </>
          )}
        </SheetModal>
      )}
    </>
  );
}
