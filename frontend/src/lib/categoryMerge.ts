/**
 * Merge categories across ledgers (e.g. family + linked personals) that share the same
 * bilingual names and type, so filter dropdowns show one row per logical category.
 */

export interface CategoryMergeSource {
  id: string;
  name: string;
  name_zh?: string;
  name_en?: string;
  type: string;
}

export function semanticCategoryKey(c: CategoryMergeSource): string {
  return `${c.type}\t${(c.name_zh || '').trim()}\t${(c.name_en || '').trim()}`;
}

/** Map merge key → all category UUIDs in the cluster + one representative row. */
export function groupCategoriesBySemanticKey(
  categories: CategoryMergeSource[],
): Map<string, { ids: string[]; rep: CategoryMergeSource }> {
  const out = new Map<string, { ids: string[]; rep: CategoryMergeSource }>();
  for (const c of categories) {
    const key = semanticCategoryKey(c);
    const cur = out.get(key);
    if (!cur) {
      out.set(key, { ids: [c.id], rep: c });
    } else {
      cur.ids.push(c.id);
    }
  }
  return out;
}
