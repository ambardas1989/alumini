'use client';

import { useState } from 'react';
import { appConfig } from '@/lib/brand';
import { useTranslations } from '@/lib/useTranslations';
import { useToast } from '@/components/providers/ToastProvider';
import { Button } from '@/components/ui/Button';
import styles from './VouchMethod.module.css';

interface VouchMethodProps {
  userId: string;
  vouchPoints: number;
}

/**
 * Read-only for the viewer — others vouch for them, this account can't act
 * on its own vouches. The per-voucher list (name/role/timestamp) the task
 * spec describes isn't retrievable through any endpoint this app has:
 * GET /verify/status/:membershipId's latestAttempt gives vouch_points, not
 * the verifications.vouches jsonb array itself — no route ever selects it.
 * Progress is real (from vouch_points); the list below is honest about not
 * having data instead of fabricating names.
 */
export function VouchMethod({ userId, vouchPoints }: VouchMethodProps) {
  const t = useTranslations('verification.methods.vouch');
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);

  const required = appConfig.VOUCH_POINTS_REQUIRED;
  const percent = Math.min(100, (vouchPoints / required) * 100);
  const isComplete = vouchPoints >= required;

  // Slots are an honest approximation, not a literal per-voucher list: points
  // aren't 1:1 with vouch count (a teacher vouch is worth 1.5, see
  // pointsGuide below), and no endpoint exposes who the individual vouchers
  // are (see this file's own doc comment above). Flooring vouchPoints into
  // filled slots keeps the visual close to "N of required" without claiming
  // to know N real people.
  const filledSlots = Math.min(required, Math.floor(vouchPoints));
  const remainingSlots = required - filledSlots;
  const slots = Array.from({ length: required }, (_, i) => i < filledSlots);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/profile/${userId}`);
      setCopied(true);
      showToast(t('linkCopiedToast'), 'success');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast(t('linkCopiedToast'), 'error');
    }
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.track}>
        <div className={`${styles.fill} ${isComplete ? styles.fillComplete : ''}`} style={{ width: `${percent}%` }} />
      </div>
      <p className={styles.pointsLabel}>{t('pointsReceived', { points: vouchPoints, required })}</p>
      {!isComplete && <p className={styles.moreNeeded}>{t('moreNeeded', { remaining: remainingSlots })}</p>}

      <div className={styles.slotsRow} aria-hidden="true">
        {slots.map((filled, i) => (
          <span key={i} className={`${styles.slot} ${filled ? styles.slotFilled : styles.slotEmpty}`}>
            {filled ? '' : '?'}
          </span>
        ))}
      </div>

      <p className={styles.guide}>{t('pointsGuide')}</p>
      <p className={styles.guide}>{t('teacherShortcut')}</p>

      <p className={styles.listNote}>{t('listUnavailable')}</p>

      <Button variant="secondary" size="md" fullWidth onClick={handleCopyLink}>
        {copied ? t('copiedButton') : t('copyLinkButton')}
      </Button>
    </div>
  );
}
