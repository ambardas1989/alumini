/** One accordion method's status, derived in page.tsx from membership + latestAttempt. */
export type MethodStatus = 'idle' | 'inProgress' | 'complete';

/** Shared props every method's expanded content receives from page.tsx. */
export interface MethodProps {
  classroomId: string;
  /** Called when this method's own action results in the membership becoming fully verified. */
  onVerified: () => void;
}
