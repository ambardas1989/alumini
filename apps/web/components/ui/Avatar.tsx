import styles from './Avatar.module.css';

export type AvatarSize = 'sm' | 'md' | 'lg' | 'xl';

interface AvatarProps {
  avatarUrl?: string | null;
  fullName: string;
  size?: AvatarSize;
}

const SIZE_PX: Record<AvatarSize, number> = { sm: 24, md: 32, lg: 48, xl: 64 };

// Small, deterministic hash → a stable index into a fixed palette, so the
// same name always gets the same background colour across renders/pages.
const PALETTE = ['#7A55D8', '#2563EB', '#16A34A', '#D97706', '#DC2626', '#0EA5E9', '#DB2777', '#7A62B8'];

function hashToColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length]!;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function Avatar({ avatarUrl, fullName, size = 'md' }: AvatarProps) {
  const px = SIZE_PX[size];

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={fullName}
        className={styles.avatar}
        style={{ width: px, height: px }}
      />
    );
  }

  return (
    <div
      className={styles.avatar}
      style={{ width: px, height: px, background: hashToColor(fullName), fontSize: px * 0.4 }}
      aria-label={fullName}
      role="img"
    >
      {initials(fullName)}
    </div>
  );
}
