/**
 * Bilingual category title for the UI. Matches backend/service.PickCategoryDisplayName:
 * English UI (language starts with "en") prefers name_en, otherwise name_zh.
 */
export function pickCategoryDisplayName(
  lng: string | undefined,
  nameZh?: string | null,
  nameEn?: string | null,
): string {
  const zh = (nameZh ?? '').trim();
  const en = (nameEn ?? '').trim();
  const preferEn = (lng || '').toLowerCase().startsWith('en');
  if (preferEn && en !== '') return en;
  if (zh !== '') return zh;
  return en;
}
