'use client';

import { ChannelType } from '@alumini/types';
import { brand } from '@/lib/brand';
import styles from './ChannelTabs.module.css';

interface ChannelTabsProps {
  active: ChannelType;
  onChange: (channel: ChannelType) => void;
}

const TABS: Array<{ channel: ChannelType; brandKey: 'main' | 'staff' | 'student' }> = [
  { channel: ChannelType.CLASSROOM, brandKey: 'main' },
  { channel: ChannelType.STAFF_ROOM, brandKey: 'staff' },
  { channel: ChannelType.STUDENT_ALLEY, brandKey: 'student' },
];

// FIX 3: the standalone "ℹ" icon that used to float between tabs (shown
// only on the active tab) was removed — it looked out of place and wasn't
// an obviously tappable target there. The classroom-info panel it opened
// is now reached via the "Details" link in ClassroomHeader instead (below
// the stats row), which is the more conventional/discoverable location.
export function ChannelTabs({ active, onChange }: ChannelTabsProps) {
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
              onClick={() => onChange(tab.channel)}
            >
              {brand.channels[tab.brandKey]}
            </button>
          </div>
        );
      })}
    </div>
  );
}
