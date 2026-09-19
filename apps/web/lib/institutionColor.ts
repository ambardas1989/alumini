/** Preset dark colors, hashed by institution id — consistent per institution across renders. */
const INSTITUTION_COLORS = ['#4A1FA8', '#0F766E', '#B45309', '#1D4ED8', '#BE185D'];

export function institutionColor(institutionId: string): string {
  let hash = 0;
  for (let i = 0; i < institutionId.length; i++) {
    hash = (hash * 31 + institutionId.charCodeAt(i)) >>> 0;
  }
  return INSTITUTION_COLORS[hash % INSTITUTION_COLORS.length]!;
}
