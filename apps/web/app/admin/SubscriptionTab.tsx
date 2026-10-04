'use client';

import { useCallback, useEffect, useState } from 'react';
import * as api from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { safeFormatDate } from '@/lib/format';
import { useToast } from '@/components/providers/ToastProvider';
import { useTranslations } from '@/lib/useTranslations';
import { SkeletonCard } from '@/components/ui/SkeletonCard';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import { Button } from '@/components/ui/Button';
import tabStyles from './Tab.module.css';
import styles from './SubscriptionTab.module.css';

interface SubscriptionTabProps {
  institutionId: string;
}

const TIER3_FEATURES = [
  'unlimitedClassrooms',
  'unlimitedMembers',
  'institutionAnnouncements',
  'advancedAnalytics',
  'prioritySupport',
  'verifiedBadge',
] as const;

/**
 * TASKS_11 TASK 04 — ADAPTED onto /admin as a new tab (see page.tsx's own
 * comment). No payment processing — this is status display + an upgrade
 * request, same scope PremiumService documents for per-user premium.
 */
export function SubscriptionTab({ institutionId }: SubscriptionTabProps) {
  const t = useTranslations('adminDashboard.subscription');
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subscription, setSubscription] = useState<api.InstitutionSubscription | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [requested, setRequested] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSubscription(await api.getInstitutionSubscription(institutionId));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [institutionId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleUpgradeRequest = async () => {
    setRequesting(true);
    try {
      await api.requestSubscriptionUpgrade(institutionId);
      setRequested(true);
      showToast(t('upgradeRequestedToast'), 'success');
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setRequesting(false);
    }
  };

  if (loading) return <SkeletonCard />;
  if (error) return <ErrorMessage message={error} onRetry={load} fullPage />;
  if (!subscription) return null;

  const isTier3 = subscription.plan === 'tier3';

  return (
    <>
      <div className={styles.planCard}>
        <div className={styles.planHeader}>
          <span className={styles.planName}>{isTier3 ? t('tier3Name') : t('freeName')}</span>
          <span className={`${styles.statusBadge} ${styles[`status_${subscription.status}`] ?? ''}`}>
            {t(`statusLabels.${subscription.status}`)}
          </span>
        </div>

        {subscription.status === 'trial' && subscription.trialEndsAt && (
          <p className={styles.dateLine}>{t('trialEnds', { date: safeFormatDate(subscription.trialEndsAt) })}</p>
        )}
        {subscription.status === 'active' && subscription.currentPeriodEnd && (
          <p className={styles.dateLine}>{t('renews', { date: safeFormatDate(subscription.currentPeriodEnd) })}</p>
        )}

        <div className={styles.limits}>
          <span>{t('maxClassrooms', { count: subscription.maxClassrooms })}</span>
          <span>{t('maxMembers', { count: subscription.maxMembersPerClassroom })}</span>
        </div>
      </div>

      <div className={tabStyles.sectionHeader}>
        <span className={tabStyles.sectionLabel}>{t('featuresSectionLabel')}</span>
      </div>
      <ul className={styles.featureList}>
        {TIER3_FEATURES.map((feature) => (
          <li key={feature} className={styles.featureItem}>
            ✓ {t(`features.${feature}`)}
          </li>
        ))}
      </ul>

      {isTier3 ? (
        <p className={styles.contactLine}>{t('contactSupportLine')}</p>
      ) : requested ? (
        <p className={styles.contactLine}>{t('requestSentLine')}</p>
      ) : (
        <Button variant="primary" size="lg" fullWidth loading={requesting} onClick={handleUpgradeRequest}>
          {t('upgradeButton')}
        </Button>
      )}
    </>
  );
}
