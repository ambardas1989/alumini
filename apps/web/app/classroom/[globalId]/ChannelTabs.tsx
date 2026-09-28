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
 * TASKS_09 TASK 21 FIX B — matches the mockup exactly: no standalone "+"/ℹ
 * button in the tab bar anymore. Instead, a small ⓘ badge appears AFTER
 * the label of whichever tab is currently active only, and opens the same
 * classroom info panel ClassroomHeader's stats row does. It moves with the
 * active tab rather than sitting in a fixed position.
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
              {isActive && (
                <span
                  className={styles.infoIcon}
                  role="button"
                  aria-label={t('details')}
                  title={t('details')}
                  onClick={(e) => {
                    e.stopPropagation();
                    onInfoClick();
                  }}
                >
                  ⓘ
                </span>
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}
