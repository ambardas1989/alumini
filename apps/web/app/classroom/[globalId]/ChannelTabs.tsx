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

const TABS: Array<{ channel: ChannelType; brandKey: 'main' | 'staff' | 'student' }> = [
  { channel: ChannelType.CLASSROOM, brandKey: 'main' },
  { channel: ChannelType.STAFF_ROOM, brandKey: 'staff' },
  { channel: ChannelType.STUDENT_ALLEY, brandKey: 'student' },
];

export function ChannelTabs({ active, onChange, onInfoClick }: ChannelTabsProps) {
  const t = useTranslations('classroom.header');

  return (
    <div className={styles.tabs} role="tablist">
      {TABS.map((tab) => {
        const isActive = tab.channel === active;
        return (
          // Two sibling buttons, not one nested inside the other (invalid
          // HTML) — same fix as app/page.tsx's verification nudge banner.
          <div key={tab.channel} className={`${styles.tabWrap} ${isActive ? styles.tabWrapActive : ''}`}>
            <button
              type="button"
              role="tab"
              aria-selected={isActive}
              className={styles.tab}
              onClick={() => onChange(tab.channel)}
            >
              {brand.channels[tab.brandKey]}
            </button>
            {isActive && (
              <button
                type="button"
                className={styles.infoIcon}
                aria-label={t('channelInfo')}
                onClick={onInfoClick}
              >
                ℹ
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
