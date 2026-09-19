import type { PersonaType } from '@alumini/types';

/** Emoji icon per persona type — shared by app/profile and app/persona (matches app/onboarding's own icon choices). */
export const PERSONA_ICONS: Record<PersonaType, string> = {
  alumni: '🎓',
  teacher: '✏️',
  school_admin: '🏫',
};
