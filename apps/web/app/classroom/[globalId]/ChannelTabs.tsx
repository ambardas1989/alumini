'use client';

import { ChannelType } from '@alumini/types';
import { brand } from '@/lib/brand';
import { useTranslations } from '@/lib/useTranslations';
import styles from './ChannelTabs.module.css';

interface ChannelTabsProps {
  active: ChannelType;
  onChange: (channel: ChannelType) => void;
  onInfoClick: () => void;
}

const TABS: Array<{ channel: ChannelType; brandKey: 'main' | 'staff' | 'student'; tooltipKey: string }> = [
  { channel: ChannelType.CLASSROOM, brandKey: 'main', tooltipKey: 'classroom' },
  { channel: ChannelType.STAFF_ROOM, brandKey: 'staff', tooltipKey: 'staffRoom' },
  { channel: ChannelType.STUDENT_ALLEY, brandKey: 'student', tooltipKey: 'studentAlley' },
];

/**
 * "+" opens the same classroom info panel (member list, global ID, creation
 * date) as ClassroomHeader's "Details" link — a previous pass removed a
 * standalone "ℹ" that floated BETWEEN tabs (confusing placement) in favour
 * of that header link only; this re-adds a dedicated entry point in the tab
 * bar too, but as the LAST item after Student Alley, not interleaved with
 * the channel tabs — hand-rolled SVG rather than pulling in @tabler/icons
 * for one icon, matching this codebase's established icon convention (see
 * AuthLayout.tsx's own icons).
 */
export function ChannelTabs({ active, onChange, onInfoClick }: ChannelTabsProps) {
  const t = useTranslations('classroom.header');

  return (
    <div className={styles.tabs} role="tablist">
      {TABS.map((tab) => {
        const isActive = tab.channel === active;
        return (
          <div key={tab.channel} className={`${styles.tabWrap} ${isActive ? styles.tabWrapActive : ''}`}>
            <button
              type="button"
              role="tab"
              aria-selected={isActive}
              className={styles.tab}
              title={t(`tabTooltip.${tab.tooltipKey}`)}
              onClick={() => onChange(tab.channel)}
            >
              {brand.channels[tab.brandKey]}
            </button>
          </div>
        );
      })}
      <button type="button" className={styles.infoButton} aria-label={t('details')} title={t('details')} onClick={onInfoClick}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </div>
  );
}
